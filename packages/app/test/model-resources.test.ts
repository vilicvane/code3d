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

test('execution resources replace obsolete local assets while dependency URLs remain valid', async () => {
  const wasm = new Uint8Array([0, 1, 2]);
  const font = new Uint8Array([3, 4]);
  const resources = new ModelResources(new Map([['/kernel.wasm', wasm]]));
  try {
    const wasmUrl = resources.url('/kernel.wasm');
    resources.install(new Map([['/fonts/a.ttf', font]]));
    const first = resources.url('/fonts/a.ttf');
    resources.install(new Map([['/fonts/a.ttf', font.slice()]]));
    assert.equal(resources.url('/fonts/a.ttf'), first);
    resources.install(new Map([['/fonts/b.ttf', font]]));
    await assert.rejects(resources.load(new URL(first)));
    assert.throws(() => resources.url('/fonts/a.ttf'), /missing/);
    await assert.rejects(fetch(first));
    assert.equal(resources.url('/kernel.wasm'), wasmUrl);
    assert.equal((await resources.load(new URL(wasmUrl))).bytes, wasm);
    const second = resources.url('/fonts/b.ttf');
    resources.install(new Map([['/fonts/b.ttf', new Uint8Array([5, 6])]]));
    await assert.rejects(resources.load(new URL(second)));
    assert.notEqual(resources.url('/fonts/b.ttf'), second);
    resources.dispose();
    await assert.rejects(resources.load(new URL(wasmUrl)));
    await assert.rejects(fetch(wasmUrl));
  } finally {
    await resources.finish();
    resources.dispose();
  }
});
