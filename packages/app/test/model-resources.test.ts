import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ModelResources: typeof import('../src/model/model-resources.ts').ModelResources;
before(async () => {
  server = await createAppTestServer();
  ({ModelResources} = await server.ssrLoadModule<
    typeof import('../src/model/model-resources.ts')
  >('/src/model/model-resources.ts'));
});
after(async () => server?.close());

test('execution resources replace obsolete fonts while dependency URLs remain valid', async () => {
  const wasm = new Uint8Array([0, 1, 2]);
  const font = new Uint8Array([3, 4]);
  const resources = new ModelResources(new Map([['/kernel.wasm', wasm]]));
  try {
    const wasmUrl = resources.url('/kernel.wasm');
    resources.install(new Map([['https://fonts.example/a.ttf', font]]));
    const first = resources.url('https://fonts.example/a.ttf');
    resources.install(new Map([['https://fonts.example/a.ttf', font.slice()]]));
    assert.equal(resources.url('https://fonts.example/a.ttf'), first);
    resources.install(new Map([['https://fonts.example/b.ttf', font]]));
    assert.equal(resources.read(new URL(first)), undefined);
    assert.throws(
      () => resources.url('https://fonts.example/a.ttf'),
      /missing/,
    );
    await assert.rejects(fetch(first));
    assert.equal(resources.url('/kernel.wasm'), wasmUrl);
    assert.equal(resources.read(new URL(wasmUrl)), wasm);
    const second = resources.url('https://fonts.example/b.ttf');
    resources.install(
      new Map([['https://fonts.example/b.ttf', new Uint8Array([5, 6])]]),
    );
    assert.equal(resources.read(new URL(second)), undefined);
    assert.notEqual(resources.url('https://fonts.example/b.ttf'), second);
    resources.dispose();
    assert.equal(resources.read(new URL(wasmUrl)), undefined);
    await assert.rejects(fetch(wasmUrl));
  } finally {
    resources.dispose();
  }
});
