#!/usr/bin/env node
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, open, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Command, CommanderError, InvalidArgumentError} from 'commander';
import {runServe} from './serve.js';
import {
  AgentClient,
  AgentTransportError,
  AgentError,
  decodeBase64,
  maxMessageBytes,
  parseAgentConfig,
  type AgentResponse,
} from '@code3d/agent';

type Options = {requestId?: string; timeout: number; outputDir?: string};
const argv = process.argv.slice(2);
const configFile =
  argv[0] && !argv[0].startsWith('-') ? argv.shift() : undefined;
const program = new Command();
let activeRequestId: string | undefined;
let remoteResult: AgentResponse | undefined;
let recoveryRequestId: string | undefined;

program
  .name('c3d')
  .description('Send one JSON request from stdin to the open Code3D App.')
  .usage('<config-file> [options] [serve]')
  .version(
    JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ).version as string,
  )
  .option(
    '--request-id <id>',
    'Stable ID for retrying the same request',
    requestIdentifier,
  )
  .option(
    '--timeout <ms>',
    'Request deadline in milliseconds',
    milliseconds,
    120_000,
  )
  .option(
    '--output-dir <directory>',
    'Parent directory for returned artifacts (default: system temp)',
  )
  .showSuggestionAfterError(false)
  .exitOverride()
  .configureOutput({writeErr: () => {}});

program
  .command('serve')
  .description('Listen for the Code3D App while this session keeps stdin open')
  .action(async () => {
    await runServe(await configuration());
  });

program.action(async () => {
  if (process.stdin.isTTY)
    throw new AgentError(
      'input_required',
      'Pipe one JSON request to c3d, or redirect a request file into stdin. Use serve to start the local service.',
    );
  await invoke(await readJson('-', maxMessageBytes));
});

try {
  if (!configFile && !argv.length) program.help();
  await program.parseAsync(argv, {from: 'user'});
} catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) {
    process.exitCode = 0;
  } else {
    const code =
      error instanceof AgentError
        ? error.code
        : error instanceof CommanderError
          ? 'usage_error'
          : 'cli_error';
    const message =
      error instanceof AgentError || error instanceof CommanderError
        ? error.message
        : 'CLI operation failed.';
    const result = {
      ...(activeRequestId ? {requestId: activeRequestId} : {}),
      ok: false,
      error: {
        code,
        message,
        ...(error instanceof AgentError && error.details !== undefined
          ? {details: error.details}
          : {}),
      },
      ...(error instanceof AgentTransportError
        ? {recovery: recovery(error)}
        : {}),
      ...(remoteResult
        ? {remoteResult: withoutArtifactData(remoteResult)}
        : {}),
    };
    emit(result);
    process.exitCode = activeRequestId ? 3 : 2;
  }
}

async function invoke(request: unknown): Promise<void> {
  const config = await configuration();
  const options = program.opts<Options>();
  const client = await AgentClient.create(config);
  activeRequestId = options.requestId ?? randomUUID();
  // Receipt lookup is the stable recovery contract. Application payloads remain
  // untouched, including operations and fields introduced by a newer App.
  const lookup = request as {operation?: unknown; requestId?: unknown} | null;
  recoveryRequestId =
    lookup?.operation === 'result' &&
    typeof lookup.requestId === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(lookup.requestId)
      ? lookup.requestId
      : activeRequestId;
  process.stderr.write(
    JSON.stringify({requestId: activeRequestId, phase: 'request'}) + '\n',
  );
  const {response} = await client.request(request, {
    requestId: activeRequestId,
    timeoutMs: options.timeout,
  });
  remoteResult = response;
  await outputResult(response, options);
  process.exitCode = response.ok ? 0 : 1;
}

function recovery(error: AgentTransportError) {
  const command = `npx --yes @code3d/cli ${shellArgument(resolve(configFile!))}`;
  const start = `${command} serve`;
  const queryStdin =
    JSON.stringify({operation: 'result', requestId: recoveryRequestId}) + '\n';
  const query = `printf '%s\\n' ${shellArgument(queryStdin.trimEnd())} | ${command}`;
  const action =
    error.code === 'service_unavailable'
      ? 'start_service'
      : error.code === 'app_disconnected'
        ? 'connect_app'
        : 'query_result';
  return {
    action,
    requestId: recoveryRequestId,
    ...(action === 'start_service'
      ? {
          command: start,
          argv: ['npx', '--yes', '@code3d/cli', resolve(configFile!), 'serve'],
        }
      : {}),
    ...(error.delivery === 'unknown' ||
    action === 'query_result' ||
    recoveryRequestId !== activeRequestId
      ? {
          queryCommand: query,
          queryStdin,
          queryArgv: ['npx', '--yes', '@code3d/cli', resolve(configFile!)],
        }
      : {}),
    message:
      action === 'start_service'
        ? `Start ${start} using this agent session's managed process tool with stdin or PTY kept open, then ${recoveryRequestId !== activeRequestId ? `run ${query}` : 'retry with the original request ID'}. Do not detach it or restart the agent session.`
        : action === 'connect_app'
          ? `The service is running. Keep the Code3D project open and allow its local-network connection. Do not restart a working service.${error.delivery === 'unknown' ? ` After reconnecting, run ${query} before another change.` : ' Retry with the original request ID after connection.'}`
          : `The outcome is unknown. Check the managed service and App connection, then run ${query}. Retry only identical input with the original request ID; never assume the change was rolled back.`,
  };
}

function shellArgument(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

async function configuration() {
  if (!configFile)
    throw new AgentError(
      'invalid_config',
      'Supply the App-provided JSON configuration as the first argument.',
    );
  return parseAgentConfig(await readJson(configFile, 64 * 1024));
}

async function outputResult(
  response: AgentResponse,
  options: Options,
): Promise<void> {
  if (!response.ok || !response.artifacts?.length) {
    emit({requestId: activeRequestId, ...response});
  } else {
    const parent =
      options.outputDir === undefined ? tmpdir() : resolve(options.outputDir);
    await mkdir(parent, {recursive: true});
    const directory = await mkdtemp(join(parent, 'c3d-'));
    const artifacts = [];
    for (const [index, artifact] of response.artifacts.entries()) {
      // Artifact names are labels supplied by the App, never local filesystem paths.
      const extension =
        artifact.mimeType === 'image/png'
          ? '.png'
          : artifact.mimeType === 'image/jpeg'
            ? '.jpg'
            : artifact.mimeType === 'application/json'
              ? '.json'
              : '.bin';
      const path = join(directory, String(index + 1) + extension);
      await writeFile(path, decodeBase64(artifact.base64, 'Artifact data'), {
        flag: 'wx',
        mode: 0o600,
      });
      artifacts.push({name: artifact.name, mimeType: artifact.mimeType, path});
    }
    emit({
      requestId: activeRequestId,
      ok: true,
      data: response.data,
      artifacts,
    });
  }
}

function withoutArtifactData(response: AgentResponse): unknown {
  return response.ok
    ? {
        ok: true,
        data: response.data,
        ...(response.artifacts
          ? {
              artifacts: response.artifacts.map(({name, mimeType}) => ({
                name,
                mimeType,
              })),
            }
          : {}),
      }
    : response;
}

function emit(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + '\n');
}

function milliseconds(value: string): number {
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > 2_147_483_647
  )
    throw new InvalidArgumentError(
      'Timeout must be an integer between 1 and 2147483647.',
    );
  return number;
}

function requestIdentifier(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw new InvalidArgumentError(
      'Request ID must contain 1–128 letters, digits, underscores or hyphens.',
    );
  return value;
}

async function readJson(path: string, limit: number): Promise<unknown> {
  let bytes: Buffer;
  try {
    if (path === '-') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        const buffer = Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        if (size > limit)
          throw new AgentError(
            'message_too_large',
            'JSON input exceeds the size limit.',
          );
        chunks.push(buffer);
      }
      bytes = Buffer.concat(chunks);
    } else {
      const handle = await open(path, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile())
          throw new AgentError(
            'invalid_input',
            'JSON input must be a regular file.',
          );
        if (stat.size > limit)
          throw new AgentError(
            'message_too_large',
            'JSON input exceeds the size limit.',
          );
        bytes = Buffer.alloc(limit + 1);
        let size = 0;
        while (size < bytes.length) {
          const {bytesRead} = await handle.read(
            bytes,
            size,
            bytes.length - size,
          );
          if (!bytesRead) break;
          size += bytesRead;
        }
        if (size > limit)
          throw new AgentError(
            'message_too_large',
            'JSON input exceeds the size limit.',
          );
        bytes = bytes.subarray(0, size);
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError(
      'input_unreadable',
      'Could not read the JSON input file.',
    );
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', {fatal: true}).decode(bytes),
    ) as unknown;
  } catch {
    throw new AgentError('invalid_json', 'Input must contain UTF-8 JSON.');
  }
}
