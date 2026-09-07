import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {
  AgentClient,
  AgentEndpoint,
  RelayHost,
  createAgentConfig,
  createHostIdentity,
} from '@code3d/agent';

const runFile = promisify(execFile);
const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '../../..');
const deployment = join(root, 'deploy/relay');

async function run(command, args, options = {}) {
  try {
    return await runFile(command, args, {
      cwd: root,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`,
      {cause: error},
    );
  }
}

async function freePorts() {
  const servers = [createServer(), createServer()];
  try {
    for (const server of servers) {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
    }
    return servers.map(server => server.address().port);
  } finally {
    await Promise.all(
      servers.map(server => new Promise(resolve => server.close(resolve))),
    );
  }
}

function compose(args) {
  return run(
    'docker',
    [
      'compose',
      '--project-name',
      process.env.CODE3D_COMPOSE_TEST_PROJECT,
      '--env-file',
      join(process.env.CODE3D_COMPOSE_TEST_DIRECTORY, '.env'),
      '-f',
      join(deployment, 'compose.yaml'),
      '-f',
      join(process.env.CODE3D_COMPOSE_TEST_DIRECTORY, 'override.json'),
      ...args,
    ],
    {
      env: {
        ...process.env,
        // Shell variables override .env in Compose; never inherit a public domain.
        RELAY_DOMAIN: 'localhost',
        ACME_EMAIL: 'relay-test@example.invalid',
        RELAY_BIND_ADDRESS: '127.0.0.1',
        RELAY_HTTP_PORT: new URL(process.env.CODE3D_COMPOSE_TEST_HTTP_URL).port,
        RELAY_HTTPS_PORT: new URL(process.env.CODE3D_COMPOSE_TEST_URL).port,
      },
    },
  );
}

async function until(check, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + description);
}

async function orchestrate() {
  const directory = await mkdtemp(join(tmpdir(), 'code3d-relay-compose-'));
  const project = 'code3d-relay-test-' + randomUUID().slice(0, 8);
  const [httpPort, httpsPort] = await freePorts();
  process.env.CODE3D_COMPOSE_TEST_PROJECT = project;
  process.env.CODE3D_COMPOSE_TEST_DIRECTORY = directory;
  process.env.CODE3D_COMPOSE_TEST_URL = `https://localhost:${httpsPort}`;
  process.env.CODE3D_COMPOSE_TEST_HTTP_URL = `http://localhost:${httpPort}`;
  await writeFile(
    join(directory, '.env'),
    [
      'RELAY_DOMAIN=localhost',
      'ACME_EMAIL=relay-test@example.invalid',
      'RELAY_BIND_ADDRESS=127.0.0.1',
      'RELAY_HTTP_PORT=' + httpPort,
      'RELAY_HTTPS_PORT=' + httpsPort,
      '',
    ].join('\n'),
  );
  await writeFile(
    join(directory, 'limits.json'),
    await readFile(join(deployment, 'limits.json')),
  );
  await writeFile(
    join(directory, 'override.json'),
    JSON.stringify({
      services: {
        relay: {
          volumes: [
            join(directory, 'limits.json') + ':/etc/code3d/limits.json:ro',
          ],
          healthcheck: {interval: '1s', start_period: '1s'},
        },
      },
    }),
  );
  try {
    console.log('Building and starting isolated Compose project ' + project);
    await compose(['up', '-d', '--build', '--wait', '--wait-timeout', '60']);
    const certificate = join(directory, 'root.crt');
    await until(async () => {
      try {
        await compose([
          'cp',
          'gateway:/data/caddy/pki/authorities/local/root.crt',
          certificate,
        ]);
        return true;
      } catch {
        return false;
      }
    }, 'Caddy localhost CA');
    const {stdout} = await run(process.execPath, [script, '--probe'], {
      env: {...process.env, NODE_EXTRA_CA_CERTS: certificate},
    });
    process.stdout.write(stdout);
  } catch (error) {
    const logs = await compose(['logs', '--no-color', '--tail=100']).catch(
      () => ({stdout: 'Could not read Compose logs.'}),
    );
    process.stderr.write(logs.stdout);
    throw error;
  } finally {
    await compose(['down', '--volumes', '--rmi', 'local', '--remove-orphans']);
    await rm(directory, {recursive: true, force: true});
  }
}

async function probe() {
  const url = process.env.CODE3D_COMPOSE_TEST_URL;
  const directory = process.env.CODE3D_COMPOSE_TEST_DIRECTORY;
  const fetchRelay = (path, options) =>
    fetch(url + path, {signal: AbortSignal.timeout(10_000), ...options});
  await until(async () => {
    try {
      return (await fetchRelay('/health')).status === 200;
    } catch {
      return false;
    }
  }, 'trusted HTTPS health check');
  const redirect = await fetch(
    process.env.CODE3D_COMPOSE_TEST_HTTP_URL + '/health',
    {redirect: 'manual', signal: AbortSignal.timeout(10_000)},
  );
  assert.equal(redirect.status, 308);
  assert.equal(new URL(redirect.headers.get('location')).protocol, 'https:');
  const relayId = (await compose(['ps', '-q', 'relay'])).stdout.trim();
  const inspect = JSON.parse(
    (await run('docker', ['inspect', relayId])).stdout,
  )[0];
  assert.equal(inspect.HostConfig.Memory, 512 * 1024 * 1024);
  assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
  assert.equal(inspect.Config.User, 'node');
  assert.ok(
    Object.values(inspect.NetworkSettings.Ports).every(value => value === null),
    'relay backend must have no published ports',
  );
  const networks = Object.keys(inspect.NetworkSettings.Networks);
  assert.equal(networks.length, 1);
  const network = JSON.parse(
    (await run('docker', ['network', 'inspect', networks[0]])).stdout,
  )[0];
  assert.equal(network.Internal, true);
  console.log(
    'HTTPS redirect, trusted TLS, private backend and resource limits passed.',
  );

  const identity = await createHostIdentity();
  const config = createAgentConfig({
    relay: url,
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
    relay: url,
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
  const restart = async (limits, service = 'relay') => {
    if (limits)
      await writeFile(join(directory, 'limits.json'), JSON.stringify(limits));
    const previous = onlineCount;
    await compose(['restart', service]);
    await until(
      () => onlineCount > previous,
      'App re-registration after ' + service + ' restart',
    );
  };
  try {
    await until(() => host.status === 'online', 'encrypted App host route');
    response = {
      ok: true,
      data: 'large render payload: ' + 'x'.repeat(8 * 1024 * 1024),
    };
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
    await restart();
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
    assert.equal(
      JSON.parse((await run('docker', ['inspect', relayId])).stdout)[0].State
        .OOMKilled,
      false,
    );
    console.log(
      '8 MiB source/result round-trip and App receipts across relay restart passed.',
    );

    const certificate = await readFile(join(directory, 'root.crt'));
    await restart(undefined, 'gateway');
    await compose([
      'cp',
      'gateway:/data/caddy/pki/authorities/local/root.crt',
      join(directory, 'reused.crt'),
    ]);
    assert.deepEqual(
      await readFile(join(directory, 'reused.crt')),
      certificate,
    );
    assert.equal((await fetchRelay('/health')).status, 200);
    console.log('Caddy certificate volume reuse and App reconnection passed.');

    await restart({ip: {requestsPerSecond: 0.001, requestBurst: 8}});
    let limited;
    for (let i = 0; i < 12; i++) {
      const result = await fetchRelay('/unknown', {
        headers: {
          'x-real-ip': `192.0.2.${i + 1}`,
          'x-forwarded-for': `198.51.100.${i + 1}`,
        },
      });
      if (result.status === 429) {
        limited = result;
        break;
      }
      assert.equal(result.status, 404);
    }
    assert.ok(limited, 'forged proxy headers must not create fresh IP quotas');
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await fetchRelay('/health')).status, 200);
    console.log('Proxy IP overwrite and HTTP request limits passed.');

    await restart({session: {dailyMiB: 0.02}});
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
    await restart({session: {dailyMiB: 0.02}});
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
    console.log('Encrypted upload and WebSocket response byte limits passed.');
  } finally {
    host.close();
    endpoint.close();
  }
}

if (process.argv.includes('--probe')) await probe();
else await orchestrate();
