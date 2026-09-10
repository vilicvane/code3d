import type {KernelArtifactStore} from '@code3d/core/tooling';
import ts from '@typescript/typescript6';
import assert from 'node:assert/strict';
import {posix} from 'node:path';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ResourceCache: (typeof import('../src/project/resource-cache.ts'))['ResourceCache'];
let fontResourceRequests: (typeof import('../src/project/font-resources.ts'))['fontResourceRequests'];
before(async () => {
  server = await createAppTestServer();
  ({ResourceCache} = await server.ssrLoadModule<
    typeof import('../src/project/resource-cache.ts')
  >('/src/project/resource-cache.ts'));
  ({fontResourceRequests} = await server.ssrLoadModule<
    typeof import('../src/project/font-resources.ts')
  >('/src/project/font-resources.ts'));
});
after(async () => server?.close());

function disk(): KernelArtifactStore & {entries: Map<string, Uint8Array>} {
  const entries = new Map<string, Uint8Array>();
  return {
    entries,
    get: key => entries.get(key),
    set: (key, bytes) => {
      entries.set(key, bytes.slice());
    },
    touch: key => entries.has(key),
    getMany(ids: readonly string[]) {
      return ids.map(id => this.get(id));
    },
    touchMany: (ids: readonly string[]) => ids.map(id => entries.has(id)),
    delete: key => {
      entries.delete(key);
    },
    flush() {},
  };
}
const signal = () => new AbortController().signal;

test('fresh resources reuse memory and disk, expired URLs revalidate and replace content', async () => {
  let time = 10_000;
  let requests = 0;
  const request: typeof fetch = async (_url, options) => {
    requests++;
    assert.equal(options?.cache, 'no-cache');
    assert.equal(options?.credentials, 'omit');
    return new Response(new Uint8Array([requests]), {
      headers: {'cache-control': 'public, max-age=10'},
    });
  };
  const store = disk();
  const first = new ResourceCache(request, 1024, () => time);
  first.setStore(store);
  const url = 'https://fonts.example/a.ttf';
  const [a, duplicate] = await Promise.all([
    first.load(url, signal()),
    first.load(url, signal()),
  ]);
  assert.deepEqual(a.bytes, duplicate.bytes);
  await first.load(url, signal());
  assert.equal(requests, 1);
  assert.ok(first.stats.memoryHits > 0);
  const next = new ResourceCache(request, 1024, () => time);
  next.setStore(store);
  assert.deepEqual((await next.load(url, signal())).bytes, new Uint8Array([1]));
  assert.equal(requests, 1);
  assert.equal(next.stats.diskHits, 1);
  time += 10_001;
  assert.deepEqual((await next.load(url, signal())).bytes, new Uint8Array([2]));
  assert.equal(requests, 2);
});

test('HTTP age and expiry do not extend a cached response lifetime', async () => {
  let time = 100_000;
  let requests = 0;
  const cache = new ResourceCache(
    async () => {
      requests++;
      return new Response('font', {
        headers: {
          'cache-control': 'max-age=10',
          age: '8',
          date: new Date(time).toUTCString(),
        },
      });
    },
    1024,
    () => time,
  );
  await cache.load('https://fonts.example/age', signal());
  time += 1999;
  await cache.load('https://fonts.example/age', signal());
  assert.equal(requests, 1);
  time += 2;
  await cache.load('https://fonts.example/age', signal());
  assert.equal(requests, 2);
});

test('no-store replaces old saved responses and does not retain decoded bytes', async () => {
  let noStore = false;
  const store = disk();
  const cache = new ResourceCache(
    async () =>
      new Response('font', {
        headers: {
          'cache-control': noStore ? 'no-store' : 'no-cache',
        },
      }),
  );
  cache.setStore(store);
  const url = 'https://fonts.example/no-store';
  await cache.load(url, signal());
  assert.equal(store.entries.size, 1);
  noStore = true;
  const resource = await cache.load(url, signal());
  let decoded = 0;
  const decode = async () => {
    decoded++;
    return new Uint8Array([1]);
  };
  await cache.decoded(resource, 'decode', decode);
  await cache.decoded(resource, 'decode', decode);
  assert.equal(decoded, 2);
  assert.equal(store.entries.size, 0);
  assert.equal(cache.stats.memoryBytes, 0);
});

test('decoding is content-addressed across URLs and survives a new cache instance', async () => {
  const store = disk();
  let decodes = 0;
  const request: typeof fetch = async () =>
    new Response(new Uint8Array([1, 2]), {
      headers: {'cache-control': 'max-age=100'},
    });
  const decode = async (bytes: Uint8Array) => {
    decodes++;
    return new Uint8Array([...bytes, 3]);
  };
  for (let i = 0; i < 2; i++) {
    const cache = new ResourceCache(request);
    cache.setStore(store);
    for (const url of ['https://fonts.example/a', 'https://fonts.example/b']) {
      const resource = await cache.load(url, signal());
      assert.deepEqual(
        await cache.decoded(resource, 'decode', decode),
        new Uint8Array([1, 2, 3]),
      );
    }
  }
  assert.equal(decodes, 1);
});

test('memory eviction preserves disk history; oversized records do not exceed the memory budget', async () => {
  const store = disk();
  let requests = 0;
  const cache = new ResourceCache(async url => {
    requests++;
    return new Response(
      new Uint8Array(String(url).endsWith('large') ? 100 : 8),
      {headers: {'cache-control': 'max-age=100'}},
    );
  }, 12);
  cache.setStore(store);
  for (const name of ['a', 'b', 'a', 'large']) {
    await cache.load('https://fonts.example/' + name, signal());
    assert.ok(cache.stats.memoryBytes <= 12);
  }
  assert.equal(requests, 3);
  assert.equal(cache.stats.diskHits, 1);
});

test('completed downloads survive cancellation; partial responses and failures can retry', async () => {
  const store = disk();
  let fail = true;
  const controller = new AbortController();
  const cache = new ResourceCache(async url => {
    if (String(url).endsWith('done')) {
      controller.abort(new Error('Cancelled'));
      return new Response('complete', {
        headers: {'cache-control': 'max-age=100'},
      });
    }
    if (fail)
      return new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error('Interrupted'));
          },
        }),
      );
    return new Response('recovered');
  });
  cache.setStore(store);
  await cache.load('https://fonts.example/done', controller.signal);
  assert.equal(store.entries.size, 1);
  await assert.rejects(
    cache.load('https://fonts.example/partial', signal()),
    /Interrupted/,
  );
  assert.equal(store.entries.size, 1);
  fail = false;
  assert.equal(
    new TextDecoder().decode(
      (await cache.load('https://fonts.example/partial', signal())).bytes,
    ),
    'recovered',
  );
});

test('unavailable and corrupt storage preserve successful downloads and memory reuse', async () => {
  const store = disk();
  const cache = new ResourceCache(
    async () => new Response('ok', {headers: {'cache-control': 'max-age=100'}}),
  );
  cache.setStore({
    ...store,
    get() {
      return new Uint8Array([1]);
    },
    set() {
      throw new Error('Quota exceeded');
    },
  });
  await cache.load('https://fonts.example/a', signal());
  await cache.load('https://fonts.example/a', signal());
  assert.equal(cache.stats.networkRequests, 1);
  assert.equal(cache.stats.storageErrors, 1);
});

test('memory resources populate newly available storage without downloading again', async () => {
  const cache = new ResourceCache(
    async () =>
      new Response('font', {headers: {'cache-control': 'max-age=100'}}),
  );
  const url = 'https://fonts.example/backfill';
  await cache.load(url, signal());
  const store = disk();
  cache.setStore(store);
  await cache.load(url, signal());
  assert.equal(store.entries.size, 1);
  const restored = new ResourceCache(async () => {
    throw new Error('Unexpected download');
  });
  restored.setStore(store);
  assert.equal(
    new TextDecoder().decode((await restored.load(url, signal())).bytes),
    'font',
  );
});

function requests(source: string, extra: Record<string, string> = {}) {
  const files: Record<string, string> = {
    '/api.d.ts':
      '/** @modelResource google-font */\nexport declare function googleFont(family: string, options?: {weight?: number; italic?: boolean}): unknown;',
    '/model.ts': source,
    ...extra,
  };
  const host = ts.createCompilerHost({noLib: true});
  host.getSourceFile = path =>
    files[path] === undefined
      ? undefined
      : ts.createSourceFile(path, files[path], ts.ScriptTarget.Latest, true);
  host.fileExists = path => files[path] !== undefined;
  host.readFile = path => files[path];
  host.resolveModuleNames = (names, containing) =>
    names.map(name => ({
      resolvedFileName: posix.resolve(posix.dirname(containing), name),
    }));
  const program = ts.createProgram(
    Object.keys(files),
    {noLib: true, strict: true},
    host,
  );
  return fontResourceRequests(program, '/model.ts').map(
    ({family, options}) => ({family, options}),
  );
}

test('Google font discovery follows aliases, re-exports and static imported options', () => {
  assert.deepEqual(
    requests(
      `import {gf} from './exports.ts';
import {family, weight} from './values.ts';
import * as constants from './values.ts';
const options = {italic: true} as const;
gf(family, {...options, weight});
gf(constants.family, {weight: undefined});
gf('Play');
function googleFont(value: string) {} googleFont('unrelated');`,
      {
        '/exports.ts': "export {googleFont as gf} from './api.d.ts';",
        '/values.ts':
          "export const family = 'Roboto'; export const weight = 450;",
      },
    ),
    [
      {family: 'Roboto', options: {italic: true, weight: 450}},
      {family: 'Roboto', options: {weight: undefined}},
      {family: 'Play', options: undefined},
    ],
  );
});

test('Google font discovery rejects dynamic values with an actionable diagnostic', () => {
  for (const source of [
    "let family = 'Roboto'; googleFont(family);",
    "const family = String('Roboto'); googleFont(family);",
    'const a = b; const b = a; googleFont(a);',
  ])
    assert.throws(
      () => requests("import {googleFont} from './api.d.ts';\n" + source),
      /requires a static family name and options/,
    );
});
