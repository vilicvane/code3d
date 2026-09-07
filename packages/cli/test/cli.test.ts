import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {encodeBase64, type AgentRequest} from '@code3d/agent';
import {relay} from '../../agent/test/relay.ts';

const main = fileURLToPath(new URL('../bld/main.js', import.meta.url));
async function run(args: string[], stdin = '') {
  const child = spawn(process.execPath, [main, ...args], {
    stdio: 'pipe',
    timeout: 10_000,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr += chunk;
  });
  child.stdin.on('error', () => {});
  child.stdin.end(stdin);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  return {code, stdout, stderr};
}

test('help documents config-first syntax without connecting', async () => {
  const result = await run(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /c3d <config-file>/);
  assert.doesNotMatch(result.stdout, /connect/);
  assert.equal(result.stderr, '');
});

test('CLI reads remote files and submits full changes from stdin or a JSON file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'c3d-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const requests: AgentRequest[] = [];
  const server = await relay(t, async request => {
    requests.push(request);
    return {
      ok: true,
      data:
        request.operation === 'fs.read'
          ? {content: 'old', version: 'v1'}
          : {status: 'saved', version: 'v2'},
    };
  });
  const config = await server.grant();
  const configPath = join(directory, 'project.json');
  await writeFile(configPath, JSON.stringify(config));
  const read = await run([configPath, 'fs', 'read', '/model.ts']);
  assert.equal(read.code, 0, read.stdout + read.stderr);
  assert.equal(JSON.parse(read.stdout).data.version, 'v1');
  const input = {
    files: [
      {path: '/model.ts', version: 'v1', content: 'const privateSource = 42;'},
    ],
    cursor: {
      file: '/model.ts',
      regex: 'const (privateSource)',
      arguments: '[]',
    },
  };
  const apply = await run(
    [
      configPath,
      '--request-id',
      'edit-1',
      'apply',
      '--input',
      '-',
      '--render',
      '--topology',
    ],
    JSON.stringify(input),
  );
  assert.equal(apply.code, 0, apply.stdout + apply.stderr);
  assert.deepEqual(requests[1], {
    operation: 'apply',
    input: {...input, render: true, topology: true},
  });
  assert.equal(JSON.parse(apply.stdout).requestId, 'edit-1');
  const inputPath = join(directory, 'apply.json');
  await writeFile(inputPath, JSON.stringify(input));
  assert.equal(
    (await run([configPath, 'apply', '--input', inputPath])).code,
    0,
  );
  const result = await run([configPath, 'result', 'edit-1']);
  assert.equal(JSON.parse(result.stdout).data.version, 'v2');
  assert.equal(requests.length, 3);
  for (const invocation of [read, apply, result]) {
    assert.ok(!invocation.stdout.includes(config.key));
  }
  assert.ok(
    server.received.every(message => !message.body.includes('privateSource')),
  );
});

test('CLI saves artifacts using safe generated names and reports paths instead of base64', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'c3d-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const server = await relay(t, async () => ({
    ok: true,
    data: {snapshot: 'v3'},
    artifacts: [
      {
        name: '../../escape.png',
        mimeType: 'image/png',
        base64: encodeBase64(bytes),
      },
    ],
  }));
  const configPath = join(directory, 'project.json');
  await writeFile(configPath, JSON.stringify(await server.grant()));
  const result = await run([
    configPath,
    '--output-dir',
    directory,
    'apply',
    '--render',
  ]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.artifacts[0].path.startsWith(directory + '/c3d-'));
  assert.equal(output.artifacts[0].base64, undefined);
  assert.deepEqual(
    new Uint8Array(await readFile(output.artifacts[0].path)),
    bytes,
  );
});

test('application errors, invalid input, and missing transport have distinct exit codes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'c3d-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const server = await relay(t, async () => ({
    ok: false,
    error: {code: 'version_conflict', message: 'File changed.'},
  }));
  const config = await server.grant();
  const configPath = join(directory, 'project.json');
  await writeFile(configPath, JSON.stringify(config));
  const conflict = await run([configPath, 'apply']);
  assert.equal(conflict.code, 1);
  assert.equal(JSON.parse(conflict.stdout).error.code, 'version_conflict');
  const bad = await run(
    [configPath, 'apply', '--input', '-'],
    '{"private-secret": broken',
  );
  assert.equal(bad.code, 2);
  assert.equal(JSON.parse(bad.stdout).error.code, 'invalid_json');
  assert.ok(!bad.stdout.includes('private-secret'));
  assert.equal(server.received.length, 1);
  await writeFile(
    configPath,
    JSON.stringify({...config, key: encodeBase64(new Uint8Array(32))}),
  );
  const rejected = await run([
    configPath,
    '--request-id',
    'recover-this',
    'apply',
  ]);
  assert.equal(rejected.code, 3);
  assert.equal(JSON.parse(rejected.stdout).requestId, 'recover-this');
  assert.equal(JSON.parse(rejected.stdout).error.code, 'relay_error');
});
