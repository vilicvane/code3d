// Runs in the disposable client container on the production relay's private network.
// Transport adapters simulate cloudflared's origin-side IP header; no edge or TLS
// behavior is asserted here, and the production Agent API stays unchanged.
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {
  AgentClient,
  AgentEndpoint,
  RelayHost,
  createAgentConfig,
  createHostIdentity,
} from '@code3d/agent';
import WebSocket from 'ws';
import {probeClientAddresses} from './proxy-probe.mjs';

const relay = 'http://relay:3134';
const fetchOrigin = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input);
  const headers = new Headers(options?.headers);
  headers.set('cf-connecting-ip', '192.0.2.100');
  return fetchOrigin(relay + url.pathname, {...options, headers});
};
globalThis.WebSocket = class extends WebSocket {
  constructor(input) {
    const url = new URL(input);
    super(relay.replace('http:', 'ws:') + url.pathname, {
      headers: {'cf-connecting-ip': '192.0.2.101'},
    });
  }
};
const input = createInterface({input: process.stdin});
const commands = input[Symbol.asyncIterator]();

async function until(check, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + description);
}

async function restart(limits = {}) {
  console.log('@restart ' + JSON.stringify(limits));
  const command = await commands.next();
  assert.equal(command.value, 'restarted');
  await until(async () => {
    try {
      return (
        (
          await fetchOrigin(relay + '/health', {
            signal: AbortSignal.timeout(5000),
          })
        ).status === 200
      );
    } catch {
      return false;
    }
  }, 'relay restart');
}

try {
  const identity = await createHostIdentity();
  const config = createAgentConfig({
    relay: 'https://relay.example.invalid',
    sessionId: identity.sessionId,
    name: 'Euler',
  });
  let calls = 0;
  let response = {ok: true, data: 'saved model'};
  const endpoint = await AgentEndpoint.create(config, async () => {
    calls++;
    return response;
  });
  let onlineCount = 0;
  const host = new RelayHost({
    relay: config.relay,
    ...identity,
    stateChanged(state) {
      if (state === 'online') onlineCount++;
    },
    handle(agentId, envelope) {
      assert.equal(agentId, config.agentId);
      return endpoint.handle(envelope);
    },
  });
  const client = await AgentClient.create(config);
  const read = {operation: 'fs.read', path: '/model.ts'};
  const restartConnected = async limits => {
    const previous = onlineCount;
    await restart(limits);
    await until(() => onlineCount > previous, 'App re-registration');
  };
  try {
    await until(() => host.status === 'online', 'encrypted App host route');
    response = {ok: true, data: 'x'.repeat(8 * 1024 * 1024)};
    const large = {
      operation: 'apply',
      input: {
        files: [
          {
            path: '/model.ts',
            version: null,
            content: 'x'.repeat(8 * 1024 * 1024),
          },
        ],
      },
    };
    const first = await client.request(large, {requestId: 'large-mutation'});
    assert.deepEqual(first.response, response);
    assert.equal(calls, 1);
    await restartConnected();
    assert.deepEqual(
      (await client.request({operation: 'result', requestId: first.requestId}))
        .response,
      response,
    );
    assert.deepEqual(
      (await client.request(large, {requestId: first.requestId})).response,
      response,
    );
    assert.equal(
      calls,
      1,
      'relay restart must preserve App receipt deduplication',
    );
    console.log(
      '8 MiB encrypted source/result and App receipts across relay restart passed.',
    );

    await restartConnected({session: {dailyMiB: 0.02}});
    const beforeUpload = calls;
    await assert.rejects(
      () =>
        client.request({
          operation: 'apply',
          input: {
            files: [
              {
                path: '/large.ts',
                version: null,
                content: 'x'.repeat(32 * 1024),
              },
            ],
          },
        }),
      /HTTP 429.*Retry after/,
    );
    assert.equal(
      calls,
      beforeUpload,
      'over-budget upload must not execute in App',
    );
    await restartConnected({session: {dailyMiB: 0.02}});
    response = {ok: true, data: 'x'.repeat(32 * 1024)};
    const beforeResponse = calls;
    await assert.rejects(
      () => client.request(read),
      /HTTP 429.*application result is not confirmed/,
    );
    assert.equal(
      calls,
      beforeResponse + 1,
      'response rejection cannot undo accepted App work',
    );
    console.log(
      'Encrypted HTTP upload and WebSocket response byte limits passed.',
    );
  } finally {
    host.close();
    endpoint.close();
  }

  await restart({ip: {requestsPerSecond: 0.001, requestBurst: 4}});
  await probeClientAddresses(relay, fetchOrigin);
} finally {
  input.close();
  process.stdin.pause();
}
