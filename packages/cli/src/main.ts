#!/usr/bin/env node
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, open, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Command, CommanderError, InvalidArgumentError, Option} from 'commander';
import {
  AgentClient,
  AgentError,
  decodeBase64,
  maxMessageBytes,
  parseAgentConfig,
  parseApplyInput,
  parseRequest,
  renderViewNames,
  type RenderViewName,
  type AgentRequest,
  type AgentResponse,
} from '@code3d/agent';

type Options = {requestId?: string; timeout: number; outputDir?: string};
const argv = process.argv.slice(2);
const configFile =
  argv[0] && !argv[0].startsWith('-') ? argv.shift() : undefined;
const program = new Command();
let activeRequestId: string | undefined;
let remoteResult: AgentResponse | undefined;

program
  .name('c3d')
  .description('Read and modify a Code3D project through its App session.')
  .usage('<config-file> [options] <command>')
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
  .command('context')
  .description(
    'Read the App current file and user selection without moving cursors',
  )
  .action(async () => {
    await invoke({operation: 'context'});
  });

const fs = program
  .command('fs')
  .description('Read the project filesystem owned by the App');
fs.command('list')
  .argument('[path]', 'Absolute project directory', '/')
  .action(async (path: string) => {
    await invoke({operation: 'fs.list', path});
  });
fs.command('read')
  .argument('<path>', 'Absolute project file')
  .action(async (path: string) => {
    await invoke({operation: 'fs.read', path});
  });
fs.command('stat')
  .argument('<path>', 'Absolute project path')
  .action(async (path: string) => {
    await invoke({operation: 'fs.stat', path});
  });

program
  .command('apply')
  .description(
    'Apply full file contents, a cursor, and optional observation outputs',
  )
  .option('--input <file>', 'Apply JSON file, or - to read stdin')
  .option('--render', 'Return a rendered image for the applied context')
  .addOption(
    new Option(
      '--view <direction>',
      'Render from a named view (implies --render)',
    ).choices([...renderViewNames]),
  )
  .option(
    '--type',
    'Return static type information at the agent cursor without evaluating the model',
  )
  .option('--topology', 'Return topology for the applied context')
  .action(
    async (options: {
      input?: string;
      render?: boolean;
      view?: RenderViewName;
      topology?: boolean;
      type?: boolean;
    }) => {
      const input = parseApplyInput(
        options.input === undefined
          ? {}
          : await readJson(options.input, maxMessageBytes),
      );
      await invoke({
        operation: 'apply',
        input: {
          ...input,
          ...(options.view
            ? {render: {view: options.view}}
            : options.render === undefined
              ? {}
              : {
                  render:
                    typeof input.render === 'object'
                      ? input.render
                      : options.render,
                }),
          ...(options.type === undefined ? {} : {type: options.type}),
          ...(options.topology === undefined
            ? {}
            : {
                topology:
                  typeof input.topology === 'object'
                    ? input.topology
                    : options.topology,
              }),
        },
      });
    },
  );

program
  .command('result')
  .description(
    'Recover the outcome of an earlier request without executing it again',
  )
  .argument('<request-id>', 'ID of the original request')
  .action(async (requestId: string) => {
    await invoke({operation: 'result', requestId});
  });

try {
  if (!argv.length) program.help();
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
    emit({
      ...(activeRequestId ? {requestId: activeRequestId} : {}),
      ok: false,
      error: {code, message},
      ...(remoteResult
        ? {remoteResult: withoutArtifactData(remoteResult)}
        : {}),
    });
    process.exitCode = activeRequestId ? 3 : 2;
  }
}

async function invoke(request: AgentRequest): Promise<void> {
  request = parseRequest(request);
  if (!configFile)
    throw new AgentError(
      'invalid_config',
      'Supply the App-provided JSON configuration as the first argument.',
    );
  const config = parseAgentConfig(await readJson(configFile, 64 * 1024));
  const options = program.opts<Options>();
  const client = await AgentClient.create(config);
  activeRequestId = options.requestId ?? randomUUID();
  process.stderr.write(
    JSON.stringify({requestId: activeRequestId, phase: 'request'}) + '\n',
  );
  const {response} = await client.request(request, {
    requestId: activeRequestId,
    timeoutMs: options.timeout,
  });
  remoteResult = response;
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
  process.exitCode = response.ok ? 0 : 1;
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
