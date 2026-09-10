import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {encodeBase64, maxMessageBytes, type AgentRequest} from '@code3d/agent';
import {transport} from '../../agent/test/transport.ts';
import {runCli as run} from './process.ts';

test('help documents JSON stdin and serve without connecting', async () => {
  const result = await run(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /c3d <config-file>/);
  assert.match(result.stdout, /JSON request from stdin/);
  assert.match(result.stdout, /serve/);
  assert.doesNotMatch(result.stdout, /--render|--view|--input|fs read/);
  assert.equal(result.stderr, '');
});

test('serve startup reports an occupied port as structured JSON', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'c3d-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const server = await transport(t, async () => ({ok: true, data: null}));
  const config = await server.grant();
  const path = join(directory, 'project.json');
  await writeFile(path, JSON.stringify(config));
  const result = await run([path, 'serve']);
  assert.equal(result.code, 2);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).error.code, 'port_in_use');
  assert.ok(!result.stderr.includes(config.key));
});

test('CLI submits complete JSON requests, preserves source escapes and recovers receipts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'c3d-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const requests: AgentRequest[] = [];
  const server = await transport(t, async request => {
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
  const read = await run(
    [configPath],
    JSON.stringify({operation: 'fs.read', path: '/model.ts'}),
  );
  assert.equal(read.code, 0, read.stdout + read.stderr);
  assert.equal(JSON.parse(read.stdout).data.version, 'v1');
  const request = {
    operation: 'apply',
    input: {
      files: [
        {
          path: '/model.ts',
          version: 'v1',
          content:
            'const privateSource = `模型 ${42}`;\n// "quotes", \\paths, $()',
        },
      ],
      cursor: {
        file: '/model.ts',
        regex: 'const (privateSource)',
        arguments: '[]',
      },
      render: {view: {direction: [1, 2, 3], up: [0, 1, 0]}},
      topology: true,
      type: true,
    },
  };
  const apply = await run(
    [configPath, '--request-id', 'edit-1'],
    JSON.stringify(request, null, 2) + '\n',
  );
  assert.equal(apply.code, 0, apply.stdout + apply.stderr);
  assert.deepEqual(requests[1], request);
  assert.equal(JSON.parse(apply.stdout).requestId, 'edit-1');
  const result = await run(
    [configPath],
    JSON.stringify({operation: 'result', requestId: 'edit-1'}),
  );
  assert.equal(JSON.parse(result.stdout).data.version, 'v2');
  assert.equal(requests.length, 2);
  for (const invocation of [read, apply, result]) {
    assert.ok(!invocation.stdout.includes(config.key));
    assert.equal(invocation.stdout.trim().split('\n').length, 1);
  }
  assert.ok(
    server.received.every(message => !message.body.includes('privateSource')),
  );
});

test('CLI saves artifacts using safe generated names and reports paths instead of base64', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'c3d-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const server = await transport(t, async () => ({
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
  const result = await run(
    [configPath, '--output-dir', directory],
    JSON.stringify({operation: 'apply', input: {render: true}}),
  );
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.artifacts[0].path.startsWith(directory + '/c3d-'));
  assert.equal(output.artifacts[0].base64, undefined);
  assert.deepEqual(
    new Uint8Array(await readFile(output.artifacts[0].path)),
    bytes,
  );
});

test('App validates operation schemas; malformed JSON, removed syntax and oversized stdin stay local', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'c3d-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  let executions = 0;
  const server = await transport(t, async () => {
    executions++;
    return {ok: true, data: null};
  });
  const configPath = join(directory, 'project.json');
  await writeFile(configPath, JSON.stringify(await server.grant()));
  for (const request of [
    {operation: 'future.operation', input: {newField: true}},
    {operation: 'apply', input: {render: {futureOption: true}}},
    {operation: 'fs.read', path: '../model.ts'},
    [{operation: 'context'}],
    null,
  ]) {
    const result = await run([configPath], JSON.stringify(request));
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).error.code, 'invalid_input');
  }
  assert.equal(server.received.length, 5);
  assert.equal(executions, 0);
  for (const input of ['', ' \n', '{"private-secret": broken', '{}\n{}']) {
    const result = await run([configPath], input);
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stdout).error.code, 'invalid_json');
    assert.ok(!result.stdout.includes('private-secret'));
  }
  for (const args of [['apply'], ['context'], ['--render'], ['--input', '-']]) {
    const result = await run([configPath, ...args], '{"operation":"context"}');
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stdout).error.code, 'usage_error');
  }
  const oversized = await run([configPath], ' '.repeat(maxMessageBytes + 1));
  assert.equal(oversized.code, 2);
  assert.equal(JSON.parse(oversized.stdout).error.code, 'message_too_large');
  assert.equal(server.received.length, 5);
});

test('application errors and missing transport have distinct exit codes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'c3d-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const server = await transport(t, async () => ({
    ok: false,
    error: {
      code: 'version_conflict',
      message: 'File changed.',
      details: {futureDetail: {accepted: false}},
    },
  }));
  const config = await server.grant();
  const configPath = join(directory, 'project.json');
  await writeFile(configPath, JSON.stringify(config));
  const input = JSON.stringify({operation: 'apply', input: {}});
  const conflict = await run([configPath], input);
  assert.equal(conflict.code, 1);
  assert.equal(JSON.parse(conflict.stdout).error.code, 'version_conflict');
  assert.deepEqual(JSON.parse(conflict.stdout).error.details, {
    futureDetail: {accepted: false},
  });
  await writeFile(
    configPath,
    JSON.stringify({...config, key: encodeBase64(new Uint8Array(32))}),
  );
  const rejected = await run(
    [configPath, '--request-id', 'recover-this'],
    input,
  );
  assert.equal(rejected.code, 3);
  assert.equal(JSON.parse(rejected.stdout).requestId, 'recover-this');
  assert.equal(JSON.parse(rejected.stdout).error.code, 'bridge_error');
});
