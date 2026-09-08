import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket, WebSocketServer} from 'ws';
import {runCli, startServe} from './process.ts';
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
// Native browser WebSocket supplies Origin. Node's test adapter supplies the same header.
globalThis.WebSocket = class extends WebSocket {
  constructor(url: string | URL) {
    super(url, {origin});
  }
} as unknown as typeof globalThis.WebSocket;

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

async function fixture(t: TestContext, config: AgentConfig) {
  const directory = await mkdtemp(join(tmpdir(), 'code3d-serve-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const file = join(directory, "project's config.json");
  await writeFile(file, JSON.stringify(config), {mode: 0o600});
  return {
    file,
    directory,
    call: async (args: string[], input = '') => {
      const result = await runCli(
        [file, '--output-dir', directory, ...args],
        input,
      );
      return {...result, value: JSON.parse(result.stdout)};
    },
  };
}

test(
  'serve supports independent CLI commands, artifacts and receipt recovery across process restart',
  {timeout: 30_000},
  async t => {
    const config = await configuration();
    const f = await fixture(t, config);
    const missing = await f.call(['--request-id', 'absent-service', 'apply']);
    assert.equal(missing.code, 3);
    assert.equal(missing.value.error.code, 'service_unavailable');
    assert.equal(missing.value.error.details.delivery, 'not_sent');
    assert.match(
      missing.value.recovery.command,
      /npx --yes @code3d\/cli .* serve$/,
    );
    assert.ok(!missing.stdout.includes(config.key));
    assert.deepEqual(missing.value.recovery.argv, [
      'npx',
      '--yes',
      '@code3d/cli',
      f.file,
      'serve',
    ]);
    assert.ok(
      missing.value.recovery.command.includes("project'\\''s config.json"),
    );
    let service = await startServe(t, f.file);
    const offline = await f.call(['context']);
    assert.equal(offline.code, 3);
    assert.equal(offline.value.error.code, 'app_disconnected');
    assert.equal(offline.value.error.details.delivery, 'not_sent');
    assert.equal(offline.value.recovery.action, 'connect_app');
    assert.equal(offline.value.recovery.command, undefined);
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
            data: {content: 'x'.repeat(8 * 1024 * 1024), version: 'v1'},
          };
        return {
          ok: true,
          data: {accepted: true, saved: true},
          artifacts: [
            {
              name: 'render.png',
              mimeType: 'image/png',
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
    assert.equal((await f.call(['context'])).value.data.file, '/model.ts');
    assert.equal(
      (await f.call(['fs', 'read', '/large.ts'])).value.data.content.length,
      8 * 1024 * 1024,
    );
    const input = JSON.stringify({
      files: [{path: '/model.ts', version: 'v1', content: 'new source'}],
      cursor: {file: '/model.ts', regex: '(new source)'},
      render: {view: 'top'},
      type: true,
      topology: true,
    });
    const args = ['--request-id', 'edit-1', 'apply', '--input', '-'];
    const result = await f.call(args, input);
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.value.requestId, 'edit-1');
    assert.deepEqual(
      new Uint8Array(await readFile(result.value.artifacts[0].path)),
      bytes,
    );
    assert.equal(result.value.artifacts[0].base64, undefined);
    await f.call(args, input);
    assert.equal(executions, 3);
    assert.equal(
      (await f.call(args, '{}')).value.error.code,
      'request_conflict',
    );
    assert.ok(!service.stdout().includes(config.key));
    await service.stop();
    await until(() => host.status !== 'online');
    const stopped = await f.call(['result', 'edit-1']);
    assert.equal(stopped.value.recovery.requestId, 'edit-1');
    service = await startServe(t, f.file);
    await until(() => host.status === 'online');
    assert.equal((await f.call(['result', 'edit-1'])).value.ok, true);
    await f.call(args, input);
    assert.equal(executions, 3);
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
  'CLI timeout and App disconnect preserve the original mutation ID and recover accepted work',
  {timeout: 15_000},
  async t => {
    const config = await configuration();
    const f = await fixture(t, config);
    await startServe(t, f.file);
    let start!: () => void;
    let started = new Promise<void>(resolve => {
      start = resolve;
    });
    let finish!: () => void;
    let finished = new Promise<void>(resolve => {
      finish = resolve;
    });
    let calls = 0;
    const endpoint = await AgentEndpoint.create(config, async () => {
      calls++;
      start();
      await finished;
      return {ok: true, data: {accepted: true, saved: true}};
    });
    t.after(() => {
      finish();
      endpoint.close();
    });
    let host = new LocalHost({
      config,
      handle: envelope => endpoint.handle(envelope),
    });
    t.after(() => host.close());
    await until(() => host.status === 'online');
    const pending = f.call([
      '--request-id',
      'timed-edit',
      '--timeout',
      '300',
      'apply',
    ]);
    await started;
    const timed = await pending;
    assert.equal(timed.code, 3);
    assert.equal(timed.value.error.details.delivery, 'unknown');
    assert.match(timed.value.recovery.queryCommand, /result 'timed-edit'$/);
    finish();
    assert.equal((await f.call(['result', 'timed-edit'])).value.ok, true);
    await f.call(['--request-id', 'timed-edit', 'apply']);
    assert.equal(calls, 1);
    started = new Promise<void>(resolve => {
      start = resolve;
    });
    finished = new Promise<void>(resolve => {
      finish = resolve;
    });
    const disconnected = f.call(['--request-id', 'disconnected-edit', 'apply']);
    await started;
    host.close();
    const lost = await disconnected;
    assert.equal(lost.value.error.code, 'app_disconnected');
    assert.equal(lost.value.error.details.delivery, 'unknown');
    assert.match(
      lost.value.recovery.queryCommand,
      /result 'disconnected-edit'$/,
    );
    finish();
    host = new LocalHost({
      config,
      handle: envelope => endpoint.handle(envelope),
    });
    await until(() => host.status === 'online');
    assert.equal(
      (await f.call(['result', 'disconnected-edit'])).value.ok,
      true,
    );
    assert.equal(calls, 2);
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

for (const signal of [undefined, 'SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  test(
    `serve exits naturally on ${signal ?? 'stdin EOF'} and releases its port`,
    {
      timeout: 10_000,
      skip: process.platform === 'win32' && signal !== undefined,
    },
    async t => {
      const config = await configuration();
      const f = await fixture(t, config);
      const service = await startServe(t, f.file);
      await service.stop(signal);
      assert.ok(!service.stdout().includes(config.key));
      const events = service
        .stdout()
        .trim()
        .split('\n')
        .map(line => JSON.parse(line));
      assert.equal(events.at(-1).event, 'stopped');
      assert.equal(events.at(-1).reason, signal ?? 'stdin_closed');
      const replacement = await createLocalBridge(config);
      await replacement.close();
    },
  );
}

test(
  'serve exits naturally when stdin is already closed at launch',
  {timeout: 10_000},
  async t => {
    const config = await configuration();
    const f = await fixture(t, config);
    const result = await runCli([f.file, 'serve'], '', 5000);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.signal, null);
    const last = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
    assert.equal(last.event, 'stopped');
    assert.equal(last.reason, 'stdin_closed');
    const replacement = await createLocalBridge(config);
    await replacement.close();
  },
);
