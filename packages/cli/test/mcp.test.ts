import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test, type TestContext} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket, WebSocketServer} from 'ws';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  AgentCipher,
  AgentClient,
  AgentEndpoint,
  LocalHost,
  connectionUrl,
  createAgentConfig,
  encodeBase64,
  requestUrl,
  type AgentConfig,
  type Envelope,
  type StoredReceipt,
} from '@code3d/agent';
import {createLocalBridge} from '../bld/bridge.js';

const origin = 'https://app.code3d.test';
const main = fileURLToPath(new URL('../bld/main.js', import.meta.url));
// Native browser WebSocket supplies Origin. Node's test adapter supplies the same header.
globalThis.WebSocket = class extends WebSocket {
  constructor(url: string | URL) {
    super(url, {origin});
  }
} as unknown as typeof globalThis.WebSocket;

function toolData(result: Record<string, unknown>): Record<string, unknown> {
  const text = (result.content as {type: string; text?: string}[]).find(
    content => content.type === 'text',
  );
  assert.ok(text?.text);
  return JSON.parse(text.text) as Record<string, unknown>;
}

async function configuration(): Promise<AgentConfig> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => listener.close(() => resolve()));
  return createAgentConfig({
    port: address.port,
    origin,
    sessionId: crypto.randomUUID(),
    name: 'Euler',
  });
}

async function until(
  predicate: () => boolean | Promise<boolean>,
  timeout = 5000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for local connection.');
    await delay(20);
  }
}

async function mcp(t: TestContext, config: AgentConfig) {
  const directory = await mkdtemp(join(tmpdir(), 'code3d-mcp-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const file = join(directory, 'project.json');
  await writeFile(file, JSON.stringify(config), {mode: 0o600});
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [main, file, 'mcp'],
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => {
    stderr += String(chunk);
  });
  const client = new Client({name: 'code3d-test', version: '1.0.0'});
  t.after(() => client.close());
  await client.connect(transport);
  return {client, transport, stderr: () => stderr};
}

test(
  'real MCP stdio maps tools, requires mutation IDs, returns images and preserves App receipts across restart',
  {timeout: 30_000},
  async t => {
    const config = await configuration();
    let service = await mcp(t, config);
    const tools = (await service.client.listTools()).tools;
    assert.deepEqual(
      tools.map(tool => tool.name),
      ['context', 'fs_list', 'fs_read', 'fs_stat', 'apply', 'result'],
    );
    assert.ok(
      tools
        .find(tool => tool.name === 'apply')!
        .inputSchema.required!.includes('requestId'),
    );
    const offline = await service.client.callTool({
      name: 'context',
      arguments: {},
    });
    assert.equal(offline.isError, true);
    assert.equal(toolData(offline).ok, false);
    const receipts: StoredReceipt[] = [];
    let executions = 0;
    const bytes = new Uint8Array([137, 80, 78, 71, 255, 254, 251]);
    const endpoint = await AgentEndpoint.create(
      config,
      async request => {
        executions++;
        if (request.operation === 'context')
          return {ok: true, data: {file: '/model.ts', cursor: null}};
        if (request.operation === 'fs.read')
          return {
            ok: true,
            data: {
              content:
                request.path === '/large.ts'
                  ? 'x'.repeat(8 * 1024 * 1024)
                  : 'source',
              version: 'v1',
            },
          };
        return {
          ok: true,
          data: {
            accepted: true,
            saved: true,
            observation: {topology: {models: []}, type: {text: 'Model'}},
          },
          artifacts: [
            {
              name: 'render.png',
              mimeType: 'image/png',
              base64: encodeBase64(bytes),
            },
            {
              name: 'source.bin',
              mimeType: 'application/octet-stream',
              base64: encodeBase64(bytes),
            },
          ],
        };
      },
      {
        journal: {
          load: async () => receipts,
          write: async receipt => {
            const index = receipts.findIndex(
              item => item.requestId === receipt.requestId,
            );
            if (index < 0) receipts.push(receipt);
            else receipts[index] = receipt;
          },
        },
      },
    );
    t.after(() => endpoint.close());
    const host = new LocalHost({
      config,
      handle: envelope => endpoint.handle(envelope),
    });
    t.after(() => host.close());
    await until(() => host.status === 'online');
    const context = await service.client.callTool({
      name: 'context',
      arguments: {},
    });
    assert.equal((toolData(context).data as {file: string}).file, '/model.ts');
    const large = await service.client.callTool({
      name: 'fs_read',
      arguments: {path: '/large.ts'},
    });
    assert.equal(
      (toolData(large).data as {content: string}).content.length,
      8 * 1024 * 1024,
    );
    assert.equal(large.structuredContent, undefined);
    const apply = {
      requestId: 'edit-1',
      files: [{path: '/model.ts', version: 'v1', content: 'new source'}],
      cursor: {file: '/model.ts', regex: '(new source)'},
      render: {view: 'top'},
      type: true,
      topology: true,
    };
    const result = await service.client.callTool({
      name: 'apply',
      arguments: apply,
    });
    assert.equal(toolData(result).requestId, 'edit-1');
    assert.equal(toolData(result).ok, true);
    const image = (result.content as {type: string; data?: string}[]).find(
      content => content.type === 'image',
    )!;
    assert.match(image.data!, /^[A-Za-z0-9+/]*={0,2}$/);
    assert.equal(image.data, Buffer.from(bytes).toString('base64'));
    assert.deepEqual(Buffer.from(image.data!, 'base64'), Buffer.from(bytes));
    assert.equal(result.isError, undefined);
    await service.client.callTool({name: 'apply', arguments: apply});
    assert.equal(executions, 3);
    const conflict = await service.client.callTool({
      name: 'apply',
      arguments: {...apply, files: []},
    });
    assert.equal(
      (toolData(conflict).error as {code: string}).code,
      'request_conflict',
    );
    const invalid = await service.client.callTool({
      name: 'apply',
      arguments: {
        requestId: 'bad-lines',
        cursor: {file: '/model.ts', regex: '(x)', lines: [4, 2]},
      },
    });
    assert.equal(toolData(invalid).requestId, 'bad-lines');
    assert.equal(
      (toolData(invalid).error as {code: string}).code,
      'invalid_input',
    );
    const missing = await service.client.callTool({
      name: 'apply',
      arguments: {},
    });
    assert.equal(missing.isError, true);
    assert.equal(executions, 3);
    assert.ok(!service.stderr().includes(config.key));
    await service.client.close();
    await until(() => host.status !== 'online');
    service = await mcp(t, config);
    await until(() => host.status === 'online');
    const recovered = await service.client.callTool({
      name: 'result',
      arguments: {requestId: 'edit-1'},
    });
    assert.equal(toolData(recovered).ok, true);
    await service.client.callTool({name: 'apply', arguments: apply});
    assert.equal(executions, 3);
    host.close();
    endpoint.close();
    await until(
      async () =>
        !(
          (await fetch(`http://127.0.0.1:${config.port}/health`).then(
            response => response.json(),
          )) as {connected: boolean}
        ).connected,
    );
    const revoked = await service.client.callTool({
      name: 'context',
      arguments: {},
    });
    assert.equal(revoked.isError, true);
  },
);

test(
  'local bridge rejects foreign origins, hosts, keys, occupied ports and reflected/replayed App proofs',
  {timeout: 15_000},
  async t => {
    const config = await configuration();
    const bridge = await createLocalBridge(config);
    t.after(() => bridge.close());
    assert.equal(
      (bridge.server.address() as {address: string}).address,
      '127.0.0.1',
    );
    await assert.rejects(() => createLocalBridge(config), {
      code: 'port_in_use',
    });
    for (const headers of [
      {origin: 'https://evil.example'},
      {origin, host: 'evil.example'},
    ]) {
      const socket = new WebSocket(connectionUrl(config), {headers});
      t.after(() => socket.terminate());
      socket.on('error', () => {});
      const [, response] = await once(socket, 'unexpected-response');
      assert.equal(response.statusCode, 403);
      socket.terminate();
    }
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${config.port}/health`, {
          headers: {origin},
        })
      ).status,
      403,
    );
    const cipher = await AgentCipher.create(config);
    let previous: Envelope | undefined;
    for (const attack of ['reflection', 'valid', 'replay']) {
      const socket = new WebSocket(connectionUrl(config), {origin});
      t.after(() => socket.terminate());
      await once(socket, 'open');
      const challenge = once(socket, 'message');
      socket.send(
        JSON.stringify({type: 'hello', challenge: crypto.randomUUID()}),
      );
      const [raw] = await challenge;
      const envelope = JSON.parse(String(raw)).envelope as Envelope;
      const opened = await cipher.open('bridge-proof', envelope);
      const proof =
        attack === 'reflection'
          ? envelope
          : attack === 'replay'
            ? previous!
            : await cipher.seal('app-proof', opened.requestId, opened.value);
      const outcome = once(socket, attack === 'valid' ? 'message' : 'close');
      socket.send(JSON.stringify({type: 'authenticate', envelope: proof}));
      const [response] = await outcome;
      if (attack === 'valid') {
        previous = proof;
        assert.equal(JSON.parse(String(response)).type, 'ready');
        socket.close();
        await once(socket, 'close');
      } else assert.equal(response, 1008);
    }
    assert.equal(bridge.connected, false);
  },
);

test(
  'App refuses an old bridge proof replayed by another process on its port',
  {timeout: 10_000},
  async t => {
    const config = await configuration();
    const cipher = await AgentCipher.create(config);
    const oldProof = await cipher.seal('bridge-proof', crypto.randomUUID(), {
      appChallenge: crypto.randomUUID(),
      bridgeChallenge: crypto.randomUUID(),
    });
    const http = createHttpServer();
    const websocket = new WebSocketServer({server: http});
    t.after(async () => {
      for (const socket of websocket.clients) socket.terminate();
      websocket.close();
      await new Promise<void>(resolve => http.close(() => resolve()));
    });
    http.listen(config.port, '127.0.0.1');
    await once(http, 'listening');
    let rejected = false;
    let authentications = 0;
    websocket.on('connection', socket => {
      socket.on('close', code => {
        rejected = code === 1008;
      });
      socket.on('message', raw => {
        const message = JSON.parse(String(raw));
        if (message.type === 'hello')
          socket.send(JSON.stringify({type: 'challenge', envelope: oldProof}));
        else if (message.type === 'authenticate') {
          authentications++;
          socket.send(JSON.stringify({type: 'ready'}));
        }
      });
    });
    const host = new LocalHost({
      config,
      handle: async () => assert.fail('Untrusted process reached the App'),
    });
    t.after(() => host.close());
    await until(() => rejected);
    assert.equal(authentications, 0);
    assert.notEqual(host.status, 'online');
    host.close();
  },
);

test(
  'App starts before the bridge and reconnects; encrypted large changes and invalid caller keys stay isolated',
  {timeout: 20_000},
  async t => {
    const config = await configuration();
    const content = 'x'.repeat(8 * 1024 * 1024);
    let calls = 0;
    const endpoint = await AgentEndpoint.create(config, async request => {
      calls++;
      assert.equal(request.operation, 'apply');
      if (request.operation === 'apply')
        assert.equal(request.input.files?.[0]?.content?.length, content.length);
      return {ok: true, data: {content}};
    });
    t.after(() => endpoint.close());
    const host = new LocalHost({
      config,
      handle: envelope => endpoint.handle(envelope),
    });
    t.after(() => host.close());
    await until(() => host.status === 'offline');
    const bridge = await createLocalBridge(config);
    t.after(() => bridge.close());
    await until(() => host.status === 'online');
    const wrong = await AgentClient.create({
      ...config,
      key: createAgentConfig(config).key,
    });
    await assert.rejects(() => wrong.request({operation: 'context'}), {
      code: 'bridge_error',
    });
    assert.equal(calls, 0);
    const client = await AgentClient.create(config);
    const result = await client.request(
      {
        operation: 'apply',
        input: {files: [{path: '/model.ts', version: 'v1', content}]},
      },
      {requestId: 'large'},
    );
    assert.equal(result.response.ok, true);
    assert.equal(calls, 1);
    await bridge.close();
    await until(() => host.status === 'offline');
    host.close();
    const replacement = await createLocalBridge(config);
    t.after(() => replacement.close());
    await delay(700);
    assert.equal(replacement.connected, false);
  },
);

test(
  'MCP cancellation preserves the caller-chosen ID and an accepted change can be recovered',
  {timeout: 10_000},
  async t => {
    const config = await configuration();
    const {client} = await mcp(t, config);
    let start!: () => void;
    const started = new Promise<void>(resolve => {
      start = resolve;
    });
    let finish!: () => void;
    const finished = new Promise<void>(resolve => {
      finish = resolve;
    });
    let calls = 0;
    let saved = false;
    const endpoint = await AgentEndpoint.create(config, async () => {
      calls++;
      start();
      await finished;
      saved = true;
      return {ok: true, data: {accepted: true, saved: true}};
    });
    t.after(() => {
      finish();
      endpoint.close();
    });
    const host = new LocalHost({
      config,
      handle: envelope => endpoint.handle(envelope),
    });
    t.after(() => host.close());
    await until(() => host.status === 'online');
    const controller = new AbortController();
    const request = {
      requestId: 'cancelled-edit',
      files: [{path: '/model.ts', version: 'v1', content: 'accepted source'}],
    };
    const pending = client.callTool(
      {name: 'apply', arguments: request},
      undefined,
      {signal: controller.signal},
    );
    const rejected = assert.rejects(() => pending);
    await started;
    controller.abort();
    await rejected;
    finish();
    await until(() => saved);
    const result = await client.callTool({
      name: 'result',
      arguments: {requestId: request.requestId},
    });
    assert.equal(toolData(result).ok, true);
    await client.callTool({name: 'apply', arguments: request});
    assert.equal(calls, 1);
  },
);

test(
  'incomplete HTTP uploads share the request capacity and release it on disconnect',
  {timeout: 10_000},
  async t => {
    const config = await configuration();
    const bridge = await createLocalBridge(config);
    t.after(() => bridge.close());
    const endpoint = await AgentEndpoint.create(config, async () => ({
      ok: true,
      data: {file: '/model.ts'},
    }));
    t.after(() => endpoint.close());
    const host = new LocalHost({
      config,
      handle: envelope => endpoint.handle(envelope),
    });
    t.after(() => host.close());
    await until(() => host.status === 'online');
    let seen = 0;
    bridge.server.on('request', () => {
      seen++;
    });
    const uploads = Array.from({length: 32}, () => {
      const request = httpRequest(requestUrl(config), {
        method: 'POST',
        agent: false,
      });
      request.on('error', () => {});
      request.write('{');
      return request;
    });
    t.after(() => {
      for (const request of uploads) request.destroy();
    });
    await until(() => seen === 32);
    const rejected = await fetch(requestUrl(config), {
      method: 'POST',
      body: '{}',
    });
    assert.equal(rejected.status, 429);
    for (const request of uploads) request.destroy();
    await delay(50);
    const client = await AgentClient.create(config);
    assert.equal(
      (await client.request({operation: 'context'})).response.ok,
      true,
    );
  },
);

test(
  'native stdio EOF exits the MCP process naturally and releases its port',
  {timeout: 10_000},
  async t => {
    const config = await configuration();
    const directory = await mkdtemp(join(tmpdir(), 'code3d-mcp-eof-'));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const file = join(directory, 'project.json');
    await writeFile(file, JSON.stringify(config), {mode: 0o600});
    const child = spawn(process.execPath, [main, file, 'mcp'], {
      stdio: 'pipe',
      timeout: 5000,
    });
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.stdin.end();
    const [code, signal] = await once(child, 'exit');
    assert.equal(code, 0, stderr);
    assert.equal(signal, null);
    assert.equal(stdout, '');
    assert.match(stderr, /Code3D MCP listening/);
    assert.ok(!stderr.includes(config.key));
    const replacement = await createLocalBridge(config);
    await replacement.close();
  },
);
