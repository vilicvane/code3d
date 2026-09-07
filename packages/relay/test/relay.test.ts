import assert from 'node:assert/strict';
import {once} from 'node:events';
import {test, type TestContext} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {
  AgentClient,
  AgentEndpoint,
  AgentError,
  RelayHost,
  createAgentConfig,
  createHostIdentity,
  maxRelayMessageBytes,
  sessionIdForToken,
  type AgentConfig,
  type AgentResponse,
  type HostState,
  type RequestHandler,
} from '@code3d/agent';
import {createRelay} from '../bld/server.js';

async function listen(relay: ReturnType<typeof createRelay>, port = 0) {
  relay.server.listen(port, '127.0.0.1');
  await once(relay.server, 'listening');
  const address = relay.server.address();
  assert.ok(address && typeof address !== 'string');
  return {port: address.port, url: `http://127.0.0.1:${address.port}`};
}

async function application(
  t: TestContext,
  url: string,
  handler: RequestHandler,
  identity?: Awaited<ReturnType<typeof createHostIdentity>>,
) {
  const hostIdentity = identity ?? (await createHostIdentity());
  const grants = new Map<string, AgentEndpoint>();
  const states: HostState[] = [];
  let host!: RelayHost;
  await new Promise<void>(resolve => {
    host = new RelayHost({
      relay: url,
      ...hostIdentity,
      stateChanged(state) {
        states.push(state);
        if (state === 'online') resolve();
      },
      handle(agentId, envelope) {
        const endpoint = grants.get(agentId);
        if (!endpoint)
          throw new AgentError('unknown_agent', 'Agent is not authorized.');
        return endpoint.handle(envelope);
      },
    });
  });
  t.after(() => {
    host.close();
    for (const endpoint of grants.values()) endpoint.close();
  });
  return {
    host,
    states,
    identity: hostIdentity,
    async grant(name = 'Agent'): Promise<AgentConfig> {
      const config = createAgentConfig({
        relay: url,
        sessionId: hostIdentity.sessionId,
        name,
      });
      grants.set(config.agentId, await AgentEndpoint.create(config, handler));
      return config;
    },
    revoke(agentId: string) {
      grants.get(agentId)?.close();
      grants.delete(agentId);
    },
  };
}
const read = {operation: 'fs.read', path: '/model.ts'} as const;
const saved: AgentResponse = {
  ok: true,
  data: {accepted: true, saved: true, content: 'private model contents'},
};

test(
  'stateless relay routes multiple agents and projects; App authenticates and revokes grants',
  {timeout: 10_000},
  async t => {
    const relay = createRelay();
    const {url} = await listen(relay);
    t.after(() => relay.close());
    let calls = 0;
    const app = await application(t, url, async () => {
      calls++;
      return saved;
    });
    const second = await application(t, url, async () => ({
      ok: true,
      data: 'other project',
    }));
    const alice = await app.grant('Alice');
    const bob = await app.grant('Bob');
    const other = await second.grant();
    const responses = await Promise.all(
      [alice, bob, other].map(
        async config =>
          (
            await (
              await AgentClient.create(config)
            ).request(read, {requestId: 'same-id'})
          ).response,
      ),
    );
    assert.deepEqual(responses, [
      saved,
      saved,
      {ok: true, data: 'other project'},
    ]);
    assert.equal(calls, 2);
    const impostor = await AgentClient.create({...alice, key: bob.key});
    await assert.rejects(() => impostor.request(read), {code: 'relay_error'});
    const crossProject = await AgentClient.create({
      ...alice,
      sessionId: other.sessionId,
    });
    await assert.rejects(() => crossProject.request(read), {
      code: 'relay_error',
    });
    app.revoke(alice.agentId);
    await assert.rejects(
      () => AgentClient.create(alice).then(client => client.request(read)),
      {code: 'relay_error'},
    );
    assert.deepEqual(
      (await (await AgentClient.create(bob)).request(read)).response,
      saved,
    );
    assert.equal(calls, 3);
  },
);

test(
  'knowing the public session ID cannot replace its App connection',
  {timeout: 10_000},
  async t => {
    const relay = createRelay();
    const {url} = await listen(relay);
    t.after(() => relay.close());
    const app = await application(t, url, async () => saved);
    const token = app.identity.sessionId;
    const socket = new WebSocket(
      url.replace(/^http/, 'ws') + '/sessions/' + token + '/host',
    );
    await new Promise<void>(resolve => {
      socket.onopen = () => resolve();
    });
    const closed = new Promise<CloseEvent>(resolve => {
      socket.onclose = resolve;
    });
    socket.send(JSON.stringify({type: 'host', token}));
    assert.equal((await closed).code, 1008);
    const untrusted = await application(
      t,
      url,
      async () => ({ok: true, data: 'impostor'}),
      {token, sessionId: await sessionIdForToken(token)},
    );
    assert.notEqual(untrusted.identity.sessionId, app.identity.sessionId);
    const client = await AgentClient.create(await app.grant());
    assert.deepEqual((await client.request(read)).response, saved);
  },
);

test(
  'relay restart loses only connections; App reconnects and retains an executed request receipt',
  {timeout: 15_000},
  async t => {
    let relay = createRelay();
    const {url, port} = await listen(relay);
    t.after(() => relay.close());
    let calls = 0;
    const app = await application(t, url, async () => {
      calls++;
      return saved;
    });
    const client = await AgentClient.create(await app.grant());
    assert.deepEqual(
      (
        await client.request(
          {operation: 'apply', input: {}},
          {requestId: 'before-restart'},
        )
      ).response,
      saved,
    );
    await relay.close();
    relay = createRelay();
    await listen(relay, port);
    for (
      let attempt = 0;
      attempt < 100 &&
      app.states.filter(state => state === 'online').length < 2;
      attempt++
    )
      await delay(50);
    assert.equal(app.host.status, 'online');
    assert.deepEqual(
      (await client.request({operation: 'result', requestId: 'before-restart'}))
        .response,
      saved,
    );
    assert.deepEqual(
      (
        await client.request(
          {operation: 'apply', input: {}},
          {requestId: 'before-restart'},
        )
      ).response,
      saved,
    );
    assert.equal(calls, 1);
  },
);

test(
  'lost HTTP response does not cancel an accepted mutation and result queries reach the App',
  {timeout: 10_000},
  async t => {
    const relay = createRelay();
    const {url} = await listen(relay);
    t.after(() => relay.close());
    let started!: () => void;
    const running = new Promise<void>(resolve => {
      started = resolve;
    });
    let finish!: (result: AgentResponse) => void;
    const completed = new Promise<AgentResponse>(resolve => {
      finish = resolve;
    });
    let calls = 0;
    const app = await application(t, url, async () => {
      calls++;
      started();
      return completed;
    });
    const client = await AgentClient.create(await app.grant());
    const abort = new AbortController();
    const first = client.request(
      {operation: 'apply', input: {}},
      {requestId: 'lost', signal: abort.signal},
    );
    const rejected = assert.rejects(first, {code: 'request_aborted'});
    await running;
    abort.abort();
    await rejected;
    const pending = (
      await client.request({operation: 'result', requestId: 'lost'})
    ).response;
    assert.ok(!pending.ok && pending.error.code === 'result_pending');
    finish(saved);
    assert.deepEqual(
      (
        await client.request(
          {operation: 'apply', input: {}},
          {requestId: 'lost'},
        )
      ).response,
      saved,
    );
    assert.equal(calls, 1);
  },
);

test(
  'offline, timeout and bounded transport capacity are explicit HTTP failures',
  {timeout: 10_000},
  async t => {
    const relay = createRelay({requestTimeoutMs: 150, maxPending: 1});
    const {url} = await listen(relay);
    t.after(() => relay.close());
    const config = createAgentConfig({
      relay: url,
      sessionId: (await createHostIdentity()).sessionId,
      name: 'Offline',
    });
    await assert.rejects(
      () => AgentClient.create(config).then(client => client.request(read)),
      /HTTP 503/,
    );
    let started!: () => void;
    const running = new Promise<void>(resolve => {
      started = resolve;
    });
    let finish!: (response: AgentResponse) => void;
    const app = await application(t, url, () => {
      started();
      return new Promise(resolve => {
        finish = resolve;
      });
    });
    const client = await AgentClient.create(await app.grant());
    const timeout = assert.rejects(() => client.request(read), /HTTP 504/);
    await running;
    await assert.rejects(() => client.request(read), /HTTP 429/);
    await timeout;
    finish(saved);
  },
);

test(
  'client headers cannot bypass IP limits unless proxy trust is explicitly enabled',
  {timeout: 10_000},
  async t => {
    for (const trustProxy of [false, true]) {
      const relay = createRelay({
        trustProxy,
        traffic: {ip: {requestsPerSecond: 0.001, requestBurst: 1}},
      });
      const {url} = await listen(relay);
      t.after(() => relay.close());
      const request = (ip: string) =>
        fetch(url + '/unknown', {headers: {'x-real-ip': ip}});
      assert.equal((await request('192.0.2.1')).status, 404);
      const second = await request('192.0.2.2');
      assert.equal(second.status, trustProxy ? 404 : 429);
      const limited = await request('192.0.2.2');
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal(limited.headers.get('connection'), 'close');
      if (trustProxy) {
        assert.equal((await request('2001:db8:1:2::1')).status, 404);
        assert.equal((await request('2001:db8:1:2::2')).status, 429);
        assert.equal((await request('192.0.2.3, 192.0.2.4')).status, 400);
        assert.equal((await fetch(url + '/unknown')).status, 400);
      }
    }
  },
);

test(
  'HTTP upload byte quotas reject before App execution and expose retry guidance',
  {timeout: 10_000},
  async t => {
    const relay = createRelay({traffic: {session: {dailyMiB: 0.002}}});
    const {url} = await listen(relay);
    t.after(() => relay.close());
    let calls = 0;
    const app = await application(t, url, async () => {
      calls++;
      return saved;
    });
    const client = await AgentClient.create(await app.grant());
    await assert.rejects(
      () =>
        client.request({
          operation: 'apply',
          input: {
            files: [
              {path: '/large.ts', version: null, content: 'x'.repeat(16384)},
            ],
          },
        }),
      /HTTP 429.*Retry after \d+ seconds using the original request ID/,
    );
    assert.equal(calls, 0);
    assert.equal((await fetch(url + '/health')).status, 200);
  },
);

test(
  'opaque uploads cannot amplify escaped bytes or exceed forwarding capacity',
  {timeout: 10_000},
  async t => {
    for (const sample of [
      {
        body: Buffer.alloc(512),
        traffic: {session: {dailyMiB: 0.002}},
        status: 429,
      },
      {
        body: Buffer.alloc(1024, 255),
        traffic: {session: {dailyMiB: 0.002}},
        status: 429,
      },
      {
        body: Buffer.alloc(Math.floor(maxRelayMessageBytes / 6) + 1),
        status: 413,
      },
      {body: Buffer.alloc(256, 97), maxBufferedBytes: 256, status: 429},
    ]) {
      const relay = createRelay(sample);
      const {url} = await listen(relay);
      t.after(() => relay.close());
      const identity = await createHostIdentity();
      const socket = new WebSocket(
        url.replace('http', 'ws') + '/sessions/' + identity.sessionId + '/host',
      );
      t.after(() => socket.close());
      await once(socket, 'open');
      const ready = once(socket, 'message');
      socket.send(JSON.stringify({type: 'host', token: identity.token}));
      await ready;
      let forwarded = 0;
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data as string) as {
          type: string;
          id: string;
        };
        if (message.type === 'request') {
          forwarded++;
          socket.send(
            JSON.stringify({
              type: 'response',
              id: message.id,
              status: 200,
              body: '{}',
            }),
          );
        }
      });
      const response = await fetch(
        url + '/sessions/' + identity.sessionId + '/agents/test/requests',
        {
          method: 'POST',
          body: sample.body,
          signal: AbortSignal.timeout(5000),
        },
      );
      assert.equal(response.status, sample.status);
      if (sample.status === 429)
        assert.ok(Number(response.headers.get('retry-after')) > 0);
      assert.equal(
        forwarded,
        0,
        'unmetered or oversized expansion must never reach the App',
      );
    }
  },
);

test(
  'App WebSocket response bytes are limited without claiming accepted work was undone',
  {timeout: 10_000},
  async t => {
    const relay = createRelay({traffic: {session: {dailyMiB: 0.004}}});
    const {url} = await listen(relay);
    t.after(() => relay.close());
    let calls = 0;
    const app = await application(t, url, async () => {
      calls++;
      return {ok: true, data: 'x'.repeat(16384)};
    });
    const client = await AgentClient.create(await app.grant());
    await assert.rejects(
      () => client.request(read),
      /HTTP 429.*application result is not confirmed.*Retry after/,
    );
    assert.equal(calls, 1);
  },
);

test(
  'reconnecting the App and replacing an agent cannot reset its session byte quota',
  {timeout: 10_000},
  async t => {
    const relay = createRelay({traffic: {session: {dailyMiB: 0.01}}});
    const {url} = await listen(relay);
    t.after(() => relay.close());
    let calls = 0;
    const handler: RequestHandler = async () => {
      calls++;
      return saved;
    };
    const app = await application(t, url, handler);
    const request = {
      operation: 'fs.read',
      path: '/' + 'x'.repeat(5000) + '.ts',
    } as const;
    const client = await AgentClient.create(await app.grant());
    assert.deepEqual((await client.request(request)).response, saved);
    app.host.close();
    const restored = await application(t, url, handler, app.identity);
    const other = await AgentClient.create(await restored.grant());
    await assert.rejects(() => other.request(request), /HTTP 429/);
    assert.equal(calls, 1);
  },
);
