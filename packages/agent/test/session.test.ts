import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  AgentCipher,
  AgentClient,
  AgentEndpoint,
  AgentError,
  createAgentConfig,
  encodeBase64,
  maxMessageBytes,
  parseAgentConfig,
  parseApplyInput,
  parseResponse,
  readBoundedBody,
  type AgentRequest,
  type AgentResponse,
} from '../bld/index.js';
import {deferred, relay} from './relay.ts';

const settings = {
  relay: 'https://relay.example',
  sessionId: 'session',
  name: 'Local agent',
};
const read: AgentRequest = {operation: 'fs.read', path: '/model.ts'};
const saved: AgentResponse = {ok: true, data: {status: 'saved', version: 'v2'}};

test('encrypted messages authenticate the agent, session, direction, request and payload', async () => {
  const config = createAgentConfig(settings);
  const cipher = await AgentCipher.create(config);
  const sealed = await cipher.seal('request', 'r1', read);
  assert.deepEqual(await cipher.open('request', sealed), {
    requestId: 'r1',
    value: read,
  });
  assert.notEqual(
    (await cipher.seal('request', 'r1', read)).nonce,
    sealed.nonce,
  );
  assert.ok(!JSON.stringify(sealed).includes('/model.ts'));
  const wrongCiphers = await Promise.all(
    [
      {...config, sessionId: 'another-session'},
      {...config, agentId: 'another-agent'},
      {...config, key: createAgentConfig(settings).key},
    ].map(config => AgentCipher.create(config)),
  );
  const invalid = [
    ...wrongCiphers.map(other => () => other.open('request', sealed)),
    () => cipher.open('response', sealed),
    () => cipher.open('request', {...sealed, requestId: 'r2'}),
    () =>
      cipher.open('request', {
        ...sealed,
        ciphertext:
          (sealed.ciphertext[0] === 'A' ? 'B' : 'A') +
          sealed.ciphertext.slice(1),
      }),
  ];
  for (const attempt of invalid)
    await assert.rejects(attempt, {code: 'authentication_failed'});
});

test('configuration never accepts remote plaintext transport or embeds credentials in URLs', () => {
  const config = createAgentConfig(settings);
  assert.notEqual(config.key, config.accessToken);
  for (const relay of [
    'http://remote.example',
    'https://user:secret@relay.example',
    'https://relay.example?token=secret',
  ])
    assert.throws(() => parseAgentConfig({...config, relay}), {
      code: 'invalid_config',
    });
  assert.throws(
    () => parseAgentConfig({...config, key: 'private-invalid-key'}),
    error => {
      assert.ok(error instanceof AgentError);
      assert.ok(!error.message.includes('private-invalid-key'));
      return true;
    },
  );
});

test('apply validates the batch before it reaches the application', () => {
  assert.throws(() => parseApplyInput({files: [{path: '/a.ts', content: ''}]}));
  assert.throws(() =>
    parseApplyInput({files: [{path: '/a.ts', version: null, content: null}]}),
  );
  assert.throws(() =>
    parseApplyInput({
      files: [
        {path: '/a.ts', version: 'old', content: 'a'},
        {path: '/a.ts', version: 'old', content: 'b'},
      ],
    }),
  );
  for (const path of ['a.ts', '/../a.ts', '/a//b.ts', '/a\\b.ts', '/a\0.ts'])
    assert.throws(() =>
      parseApplyInput({files: [{path, version: null, content: ''}]}),
    );
  assert.throws(() =>
    parseApplyInput({cursor: {file: '/a.ts', regex: '(a)', lines: [3, 1]}}),
  );
  assert.deepEqual(
    parseApplyInput({cursor: {file: '/a.ts', regex: '()', arguments: '[]'}}),
    {cursor: {file: '/a.ts', regex: '()', arguments: '[]'}},
  );
});

test('concurrent retries run once, conflicting reuse fails, and results are queryable', async () => {
  const config = createAgentConfig(settings);
  const cipher = await AgentCipher.create(config);
  const started = deferred<void>();
  const finish = deferred<AgentResponse>();
  let calls = 0;
  const endpoint = await AgentEndpoint.create(config, async () => {
    calls++;
    started.resolve();
    return finish.promise;
  });
  async function send(id: string, request: AgentRequest) {
    const envelope = await endpoint.handle(
      await cipher.seal('request', id, request),
    );
    return parseResponse((await cipher.open('response', envelope)).value);
  }
  const first = send('change', {operation: 'apply', input: {}});
  await started.promise;
  const retry = send('change', {operation: 'apply', input: {}});
  assert.deepEqual(
    await send('query1', {operation: 'result', requestId: 'change'}),
    {
      ok: false,
      error: {code: 'result_pending', message: 'The request is still running.'},
    },
  );
  const conflict = await send('change', read);
  assert.ok(!conflict.ok && conflict.error.code === 'request_conflict');
  finish.resolve(saved);
  assert.deepEqual(await Promise.all([first, retry]), [saved, saved]);
  assert.equal(calls, 1);
  assert.deepEqual(
    await send('query2', {operation: 'result', requestId: 'change'}),
    saved,
  );
  assert.deepEqual(
    await send('change', {operation: 'apply', input: {}}),
    saved,
  );
  assert.equal(calls, 1);
  endpoint.close();
  await assert.rejects(() => send('late', read), {code: 'session_closed'});
});

test('receipts retain failures and reject new work at capacity without forgetting old outcomes', async () => {
  const config = createAgentConfig(settings);
  const cipher = await AgentCipher.create(config);
  let calls = 0;
  const endpoint = await AgentEndpoint.create(
    config,
    async () => {
      calls++;
      throw new Error('private source');
    },
    {requests: 1, bytes: maxMessageBytes},
  );
  const send = async (id: string, request: AgentRequest) =>
    parseResponse(
      (
        await cipher.open(
          'response',
          await endpoint.handle(await cipher.seal('request', id, request)),
        )
      ).value,
    );
  const result = await send('first', read);
  assert.ok(!result.ok && result.error.code === 'application_error');
  assert.ok(!JSON.stringify(result).includes('private source'));
  assert.deepEqual(await send('first', read), result);
  const full = await send('second', read);
  assert.ok(!full.ok && full.error.code === 'session_capacity');
  assert.deepEqual(
    await send('query', {operation: 'result', requestId: 'first'}),
    result,
  );
  assert.equal(calls, 1);
});

test('HTTP transport separates agent identities and only carries ciphertext and routing credentials', async t => {
  let calls = 0;
  const server = await relay(t, async () => {
    calls++;
    return saved;
  });
  const alice = await server.grant('Alice');
  const bob = await server.grant('Bob');
  const clients = await Promise.all(
    [alice, bob].map(config => AgentClient.create(config)),
  );
  const responses = await Promise.all(
    clients.map(client => client.request(read, {requestId: 'same-id'})),
  );
  assert.ok(responses.every(result => result.response.ok));
  assert.equal(calls, 2);
  assert.notEqual(server.received[0].url, server.received[1].url);
  for (const received of server.received) {
    assert.ok(!received.body.includes('model.ts'));
    assert.ok(!JSON.stringify(received).includes(alice.key));
    assert.ok(!JSON.stringify(received).includes(bob.key));
  }
  const impostor = await AgentClient.create({
    ...alice,
    accessToken: bob.accessToken,
  });
  await assert.rejects(() => impostor.request(read), {code: 'relay_error'});
  assert.equal(calls, 2);
});

test('a timed-out apply can be queried or retried without a second execution', async t => {
  const started = deferred<void>();
  const finish = deferred<AgentResponse>();
  let calls = 0;
  const server = await relay(t, async () => {
    calls++;
    started.resolve();
    return finish.promise;
  });
  const client = await AgentClient.create(await server.grant());
  const abort = new AbortController();
  const first = client.request(
    {operation: 'apply', input: {}},
    {requestId: 'saved-but-lost', signal: abort.signal},
  );
  const rejected = assert.rejects(first, {code: 'request_aborted'});
  await started.promise;
  abort.abort();
  await rejected;
  finish.resolve(saved);
  assert.deepEqual(
    (
      await client.request(
        {operation: 'apply', input: {}},
        {requestId: 'saved-but-lost'},
      )
    ).response,
    saved,
  );
  assert.deepEqual(
    (await client.request({operation: 'result', requestId: 'saved-but-lost'}))
      .response,
    saved,
  );
  assert.equal(calls, 1);
});

test('client rejects a valid response belonging to another request', async t => {
  const server = await relay(t, async () => saved);
  const config = await server.grant();
  const cipher = await AgentCipher.create(config);
  server.transform(() => cipher.seal('response', 'another-request', saved));
  await assert.rejects(
    () => AgentClient.create(config).then(client => client.request(read)),
    {code: 'response_mismatch'},
  );
});

test('response streaming limits do not trust content-length', async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    }),
    {headers: {'content-length': '1'}},
  );
  await assert.rejects(() => readBoundedBody(response, 6), {
    code: 'message_too_large',
  });
  assert.deepEqual(
    parseResponse({
      ok: true,
      data: {},
      artifacts: [
        {
          name: 'image',
          mimeType: 'image/png',
          base64: encodeBase64(new Uint8Array([1, 2])),
        },
      ],
    }).ok,
    true,
  );
});
