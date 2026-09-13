import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let settingsApi: typeof import('../src/app-settings.ts');
before(async () => {
  server = await createAppTestServer();
  settingsApi = await server.ssrLoadModule('/src/app-settings.ts');
});
after(async () => server?.close());

test('missing preferences get defaults without replacing saved values', () => {
  const settings = new settingsApi.AppSettings({
    getItem: () => JSON.stringify({editDelayMs: 750, memoryCacheGiB: 4.5}),
    setItem() {},
  });
  assert.equal(settings.value.editDelayMs, 750);
  assert.equal(settings.value.memoryCacheGiB, 4.5);
  assert.equal(settings.value.cachePersistenceThresholdMs, 1);
  assert.equal(settings.execution.cachePersistenceThresholdMs, 1);
  settings.dispose();
});

test('disk thresholds accept zero and fractional milliseconds but reject invalid values', () => {
  for (const cachePersistenceThresholdMs of [0, 0.1, 0.75, 1, 10_000])
    assert.doesNotThrow(() =>
      settingsApi.validateAppSettings({
        ...settingsApi.defaultAppSettings(),
        cachePersistenceThresholdMs,
      }),
    );
  for (const cachePersistenceThresholdMs of [-1, NaN, Infinity])
    assert.throws(
      () =>
        settingsApi.validateAppSettings({
          ...settingsApi.defaultAppSettings(),
          cachePersistenceThresholdMs,
        }),
      {key: 'cachePersistenceThresholdMs'},
    );
});
