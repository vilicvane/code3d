import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {reaction} from 'mobx';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let sceneApi: typeof import('../src/rendering/render-scene.ts');
before(async () => {
  server = await createAppTestServer();
  sceneApi = await server.ssrLoadModule('/src/rendering/render-scene.ts');
});
after(async () => server?.close());

test('render choice is observable, persists across instances and leaves isolated renders at Studio', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const preference = new sceneApi.RenderScenePreference(storage);
  const seen: string[] = [];
  const stop = reaction(
    () => preference.preset,
    preset => seen.push(preset),
  );
  try {
    preference.select('side');
    preference.select('soft');
    assert.deepEqual(seen, ['side', 'soft']);
    assert.equal(values.get(sceneApi.renderSceneStorageKey), 'soft');
    assert.equal(new sceneApi.RenderScenePreference(storage).preset, 'soft');
    assert.equal(new sceneApi.RenderScenePreference().preset, 'studio');
  } finally {
    stop();
  }
});

test('invalid or unavailable saved scenes use Studio', () => {
  for (const saved of [null, '', 'unknown', '__proto__', 'constructor']) {
    const preference = new sceneApi.RenderScenePreference({
      getItem: () => saved,
      setItem() {},
    });
    assert.equal(preference.preset, 'studio');
  }
  assert.equal(
    new sceneApi.RenderScenePreference({
      getItem() {
        throw new Error('Storage unavailable');
      },
      setItem() {},
    }).preset,
    'studio',
  );
});

test('failed preference writes preserve the last saved scene', () => {
  const preference = new sceneApi.RenderScenePreference({
    getItem: () => 'side',
    setItem() {
      throw new Error('Storage full');
    },
  });
  assert.throws(() => preference.select('soft'), /Storage full/);
  assert.equal(preference.preset, 'side');
});
