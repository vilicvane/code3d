import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const runFile = promisify(execFile);
const tests = dirname(fileURLToPath(import.meta.url));
const root = resolve(tests, '../../..');
const deployment = join(root, 'deploy/relay');
const directory = await mkdtemp(join(tmpdir(), 'code3d-relay-compose-'));
const project = 'code3d-relay-test-' + randomUUID().slice(0, 8);
// Deliberately unparsable, so the connector never authenticates or contacts an edge.
const token = 'invalid-offline-test-token-' + randomUUID();
const environment = {...process.env};
// Shell variables override .env. Never use a developer's real tunnel credentials.
delete environment.TUNNEL_TOKEN;
const composeArgs = [
  'compose',
  '--project-name',
  project,
  '--env-file',
  join(directory, '.env'),
  '-f',
  join(deployment, 'compose.yaml'),
  '-f',
  join(directory, 'override.json'),
];

async function run(command, args, options = {}) {
  return runFile(command, args, {
    cwd: root,
    env: environment,
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
}

const compose = args => run('docker', [...composeArgs, ...args]);
async function inspect(service) {
  const id = (await compose(['ps', '--all', '-q', service])).stdout.trim();
  assert.ok(id, service + ' container must exist');
  return JSON.parse((await run('docker', ['inspect', id])).stdout)[0];
}

async function until(check, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + description);
}

async function probe() {
  const child = spawn(
    'docker',
    [...composeArgs, 'run', '--rm', '--no-deps', '-T', 'probe'],
    {cwd: root, env: environment, stdio: ['pipe', 'pipe', 'inherit']},
  );
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGTERM'), 120_000);
  const lines = createInterface({input: child.stdout});
  try {
    for await (const line of lines) {
      if (!line.startsWith('@restart ')) {
        console.log(line);
        continue;
      }
      await writeFile(join(directory, 'limits.json'), line.slice(9));
      await compose(['restart', 'relay']);
      child.stdin.write('restarted\n');
    }
    const [code, signal] = await exited;
    assert.equal(code, 0, 'internal probe failed: ' + signal);
  } finally {
    clearTimeout(timeout);
    child.stdin.end();
    if (child.exitCode === null) child.kill('SIGTERM');
  }
}

try {
  await writeFile(join(directory, '.env'), 'TUNNEL_TOKEN=' + token + '\n', {
    mode: 0o600,
  });
  await writeFile(
    join(directory, 'limits.json'),
    await readFile(join(deployment, 'limits.json')),
  );
  await writeFile(
    join(directory, 'override.json'),
    JSON.stringify({
      services: {
        cloudflared: {restart: 'no'},
        relay: {
          image: project + ':test',
          volumes: [
            join(directory, 'limits.json') + ':/etc/code3d/limits.json:ro',
          ],
          healthcheck: {interval: '1s', start_period: '1s'},
        },
        // Disposable client only; it has no Docker socket, token or published port.
        probe: {
          image: project + ':test',
          entrypoint: ['node', '/app/packages/relay/test/docker-probe.mjs'],
          volumes: [tests + ':/app/packages/relay/test:ro'],
          networks: ['backend'],
          read_only: true,
          cap_drop: ['ALL'],
          security_opt: ['no-new-privileges:true'],
        },
      },
    }),
  );
  const config = JSON.parse(
    (await compose(['config', '--format', 'json'])).stdout,
  );
  assert.deepEqual(Object.keys(config.secrets), ['tunnel_token']);
  assert.equal(config.secrets.tunnel_token.environment, 'TUNNEL_TOKEN');
  assert.equal(config.networks.backend.internal, true);
  assert.equal(config.networks.edge.internal ?? false, false);
  for (const [name, service] of Object.entries(config.services)) {
    assert.equal(
      service.ports?.length ?? 0,
      0,
      name + ' must not publish ports',
    );
    assert.equal(service.secrets?.length ?? 0, name === 'cloudflared' ? 1 : 0);
    assert.ok(!JSON.stringify(service).includes(token));
  }
  assert.deepEqual(Object.keys(config.services.relay.networks), ['backend']);
  assert.deepEqual(Object.keys(config.services.cloudflared.networks).sort(), [
    'backend',
    'edge',
  ]);

  console.log('Building and starting isolated Compose project ' + project);
  await compose([
    'up',
    '-d',
    '--build',
    '--wait',
    '--wait-timeout',
    '60',
    'relay',
  ]);
  await compose(['up', '-d', '--no-deps', 'cloudflared']);
  await until(
    async () => (await inspect('cloudflared')).State.Status === 'exited',
    'invalid tunnel token rejection',
  );
  const connector = await inspect('cloudflared');
  assert.notEqual(connector.State.ExitCode, 0);
  assert.notEqual(connector.State.Health.Status, 'healthy');
  assert.equal(connector.Config.User, '65532:65532');
  assert.ok(!JSON.stringify(connector.Config).includes(token));
  const logs = (await compose(['logs', '--no-color', 'cloudflared'])).stdout;
  assert.match(logs, /Provided Tunnel token is not valid/);
  assert.ok(!logs.includes(token), 'connector must not log the token');
  await compose([
    'cp',
    'cloudflared:/run/secrets/tunnel_token',
    join(directory, 'secret'),
  ]);
  assert.equal(await readFile(join(directory, 'secret'), 'utf8'), token);
  await assert.rejects(
    () =>
      run('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--entrypoint',
        connector.Config.Healthcheck.Test[1],
        connector.Config.Image,
        ...connector.Config.Healthcheck.Test.slice(2),
      ]),
    error => /connect: connection refused/.test(error.stderr),
  );
  await assert.rejects(
    () =>
      run('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        connector.Config.Image,
        'tunnel',
        'run',
        '--token-file',
        '/run/secrets/tunnel_token',
      ]),
    error => /no such file or directory/.test(error.stderr),
  );
  console.log(
    'Official cloudflared reads its secret as non-root, rejects an invalid token, and cannot report ready offline.',
  );

  const relay = await inspect('relay');
  assert.equal(relay.HostConfig.Memory, 512 * 1024 * 1024);
  assert.equal(relay.HostConfig.ReadonlyRootfs, true);
  assert.equal(relay.Config.User, 'node');
  for (const service of [connector, relay]) {
    assert.ok(
      Object.values(service.NetworkSettings.Ports).every(
        value => value === null,
      ),
    );
  }
  const networks = Object.keys(relay.NetworkSettings.Networks);
  assert.equal(networks.length, 1);
  assert.equal(
    JSON.parse(
      (await run('docker', ['network', 'inspect', networks[0]])).stdout,
    )[0].Internal,
    true,
  );
  await compose([
    'exec',
    '-T',
    'relay',
    'node',
    '--input-type=module',
    '--eval',
    "import assert from 'node:assert/strict'; import {existsSync} from 'node:fs'; assert.equal(existsSync('/run/secrets/tunnel_token'), false);",
  ]);
  console.log(
    'No published ports; relay has only the private backend and no tunnel secret.',
  );
  await probe();
  const completed = await inspect('relay');
  assert.equal(completed.State.OOMKilled, false);
  assert.equal(
    completed.RestartCount,
    0,
    'relay must not crash or restart automatically',
  );
} catch (error) {
  const logs = await compose(['logs', '--no-color', '--tail=100']).catch(
    () => ({stdout: 'Could not read Compose logs.'}),
  );
  process.stderr.write(logs.stdout);
  throw error;
} finally {
  await compose(['down', '--volumes', '--rmi', 'local', '--remove-orphans']);
  await run('docker', ['image', 'rm', project + ':test']).catch(() => {});
  await rm(directory, {recursive: true, force: true});
}
