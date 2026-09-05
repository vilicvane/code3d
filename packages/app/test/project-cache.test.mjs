import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';

let server;
let ProjectFileCache;
before(async () => {
  server = await createAppTestServer();
  ({ProjectFileCache} = await server.ssrLoadModule(
    '/src/project/file-cache.ts',
  ));
});
after(async () => server?.close());

for (const operation of ['stat', 'readFile']) {
  test(`does not retain a failed ${operation} when the next request can succeed`, async () => {
    let failed = false;
    const reader = {
      async stat() {
        return {kind: 'file', version: 'unchanged'};
      },
      async readFile() {
        return new TextEncoder().encode('ready');
      },
    };
    const original = reader[operation];
    reader[operation] = async () => {
      if (!failed) {
        failed = true;
        throw new Error('Temporarily unavailable');
      }
      return original();
    };
    const cache = new ProjectFileCache(reader);
    await assert.rejects(
      cache.readFile('/package.js'),
      /Temporarily unavailable/,
    );
    assert.equal(
      new TextDecoder().decode(await cache.readFile('/package.js')),
      'ready',
    );
  });
}

test('caches reached bytes and misses, and refreshes additions, replacements and removals', async () => {
  const files = new Map([['/value.js', 'one']]);
  let reads = 0;
  const reader = {
    async readFile(path) {
      reads++;
      return new TextEncoder().encode(files.get(path));
    },
    async stat(path) {
      if (files.has(path)) return {kind: 'file', version: files.get(path)};
    },
  };
  const cache = new ProjectFileCache(reader);
  assert.equal(await cache.readFile('/missing.js'), undefined);
  assert.equal(reads, 0);
  assert.equal(
    new TextDecoder().decode(await cache.readFile('/value.js')),
    'one',
  );
  await cache.readFile('/value.js');
  assert.equal(reads, 1);
  assert.equal((await cache.refresh()).size, 0);
  files.set('/missing.js', 'added');
  files.set('/value.js', 'two');
  assert.deepEqual(
    new Set(await cache.refresh()),
    new Set(['/missing.js', '/value.js']),
  );
  assert.equal(
    new TextDecoder().decode(await cache.readFile('/value.js')),
    'two',
  );
  assert.equal(
    new TextDecoder().decode(await cache.readFile('/missing.js')),
    'added',
  );
  files.delete('/value.js');
  assert.deepEqual([...(await cache.refresh())], ['/value.js']);
  assert.equal(await cache.readFile('/value.js'), undefined);
  assert.equal(reads, 3);
});
