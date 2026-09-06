import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let typeScriptFileName: (typeof import('../src/monaco/typescript-file-names.ts'))['typeScriptFileName'];
let typeScriptWorkerRequests: (typeof import('../src/monaco/typescript-file-names.ts'))['typeScriptWorkerRequests'];

before(async () => {
  server = await createAppTestServer();
  ({typeScriptFileName, typeScriptWorkerRequests} = await server.ssrLoadModule<
    typeof import('../src/monaco/typescript-file-names.ts')
  >('/src/monaco/typescript-file-names.ts'));
});

after(async () => server?.close());

test('serialized package and project URIs share the literal TypeScript identity', () => {
  for (const [serialized, literal] of [
    [
      'file:///workspace/node_modules/%40code3d/core/index.d.ts',
      'file:///workspace/node_modules/@code3d/core/index.d.ts',
    ],
    [
      'file:///workspace/%E5%B0%BA%E5%AF%B8%20box.ts',
      'file:///workspace/尺寸 box.ts',
    ],
    [
      'file:///workspace/hash%23query%3F.ts',
      'file:///workspace/hash%23query%3F.ts',
    ],
    ['/lib.es5.d.ts', '/lib.es5.d.ts'],
  ] as const) {
    assert.equal(typeScriptFileName(serialized), literal);
    assert.equal(typeScriptFileName(literal), literal);
  }
});

test('worker requests normalize the document while preserving receiver and other arguments', () => {
  const worker = {
    marker: {},
    getProjectCompletionDetails(...args: unknown[]) {
      return {receiver: this, args};
    },
    updateExtraLibs<T>(libs: T) {
      return libs;
    },
    getLibFiles() {
      return this.marker;
    },
  };
  const requests = typeScriptWorkerRequests(worker);
  const data = {source: 'file:///keep/%40source', name: 'box'};
  const result = requests.getProjectCompletionDetails(
    'file:///workspace/%40models/box.ts',
    3,
    'box',
    '@code3d/core',
    data,
  );
  assert.equal(result.receiver, worker);
  assert.deepEqual(result.args, [
    'file:///workspace/@models/box.ts',
    3,
    'box',
    '@code3d/core',
    data,
  ]);
  assert.equal(result.args[4], data);
  const libs = {
    'file:///workspace/@code3d/index.d.ts': {content: 'export {};'},
  };
  assert.equal(requests.updateExtraLibs(libs), libs);
  assert.equal(requests.getLibFiles(), worker.marker);
});

test('document highlights normalize every searched URI without mutating the request', () => {
  const requests = typeScriptWorkerRequests({
    getDocumentHighlights(...args: unknown[]) {
      return args;
    },
  });
  const files = ['file:///workspace/%40models/box.ts'];
  assert.deepEqual(requests.getDocumentHighlights(files[0], 2, files), [
    'file:///workspace/@models/box.ts',
    2,
    ['file:///workspace/@models/box.ts'],
  ]);
  assert.deepEqual(files, ['file:///workspace/%40models/box.ts']);
});
