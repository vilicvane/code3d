import {
  googleFontSources,
  googleFontUrl,
  type KernelArtifactStore,
} from '@code3d/core/tooling';
import ts from '@typescript/typescript6';
import assert from 'node:assert/strict';
import {posix} from 'node:path';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ResourceCache: (typeof import('../src/project/resource-cache.ts'))['ResourceCache'];
let ProjectAssets: (typeof import('../src/project/project-assets.ts'))['ProjectAssets'];
let fontResourceRequests: (typeof import('../src/project/font-resources.ts'))['fontResourceRequests'];
before(async () => {
  server = await createAppTestServer();
  ({ResourceCache} = await server.ssrLoadModule<
    typeof import('../src/project/resource-cache.ts')
  >('/src/project/resource-cache.ts'));
  ({fontResourceRequests} = await server.ssrLoadModule<
    typeof import('../src/project/font-resources.ts')
  >('/src/project/font-resources.ts'));
  ({ProjectAssets} = await server.ssrLoadModule<
    typeof import('../src/project/project-assets.ts')
  >('/src/project/project-assets.ts'));
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

const bundleResources = (value = 'font', cacheable = true) =>
  new Map([
    [
      'https://fonts.example/css',
      {bytes: new TextEncoder().encode('css'), expires: 0, cacheable},
    ],
    [
      'https://fonts.example/font',
      {bytes: new TextEncoder().encode(value), expires: 0, cacheable},
    ],
  ]);

test('complete bundles survive expired HTTP entries and bounded memory eviction', async () => {
  const store = disk();
  let loads = 0;
  const first = new ResourceCache(undefined, 1024);
  first.setStore(store);
  const load = async () => {
    loads++;
    return bundleResources();
  };
  const [a, duplicate] = await Promise.all([
    first.bundle('font:400', load),
    first.bundle('font:400', load),
  ]);
  assert.deepEqual(a, duplicate);
  assert.equal(loads, 1);
  const offline = async (): Promise<never> => {
    throw new Error('Offline');
  };
  const next = new ResourceCache(offline, 1);
  next.setStore(store);
  assert.deepEqual(await next.bundle('font:400', offline), a);
  assert.equal(next.stats.memoryBytes, 0);
  assert.deepEqual(await next.bundle('font:400', offline), a);
  assert.equal(next.stats.diskHits, 2);
  await assert.rejects(next.bundle('font:700', offline), /Offline/);
  store.entries.clear();
  await assert.rejects(next.bundle('font:400', offline), /Offline/);
});

test('bundle refresh replaces only complete results and honors no-store', async () => {
  const store = disk();
  const cache = new ResourceCache();
  cache.setStore(store);
  const original = await cache.bundle('font', async () => bundleResources());
  const failed = async (): Promise<never> => {
    throw new Error('Partial download');
  };
  await assert.rejects(cache.bundle('font', failed, true), /Partial download/);
  assert.deepEqual(await cache.bundle('font', failed), original);
  const changed = await cache.bundle(
    'font',
    async () => bundleResources('new'),
    true,
  );
  assert.notDeepEqual(changed, original);
  assert.deepEqual(await cache.bundle('font', failed), changed);
  await cache.bundle(
    'font',
    async () => bundleResources('private', false),
    true,
  );
  assert.equal(store.entries.size, 0);
  assert.equal(cache.stats.memoryBytes, 0);
  await assert.rejects(cache.bundle('font', failed), /Partial download/);
});

test('corrupt bundle payloads are discarded and retried as a full resolution', async () => {
  const store = disk();
  const first = new ResourceCache();
  first.setStore(store);
  const original = await first.bundle('font', async () => bundleResources());
  const [key, bytes] = [...store.entries][0];
  // Keep the resource record metadata intact but truncate its bundled payload.
  store.entries.set(key, bytes.slice(0, -1));
  const next = new ResourceCache();
  next.setStore(store);
  let loads = 0;
  assert.deepEqual(
    await next.bundle('font', async () => {
      loads++;
      return bundleResources();
    }),
    original,
  );
  assert.equal(loads, 1);
});

test('explicit HTTP refresh bypasses fresh records and keeps old content on failure', async () => {
  let requests = 0;
  const cache = new ResourceCache(async () => {
    requests++;
    if (requests === 3) throw new Error('Offline');
    return new Response(String(requests), {
      headers: {'cache-control': 'max-age=3600'},
    });
  });
  const url = 'https://fonts.example/css';
  await cache.load(url, signal());
  const changed = await cache.load(url, signal(), true);
  assert.equal(new TextDecoder().decode(changed.bytes), '2');
  await assert.rejects(cache.load(url, signal(), true), /Offline/);
  assert.deepEqual(await cache.load(url, signal()), changed);
  assert.equal(requests, 3);
});

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

function fontProgram(source: string, extra: Record<string, string> = {}) {
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
  return ts.createProgram(
    Object.keys(files),
    {noLib: true, strict: true},
    host,
  );
}

function requests(source: string, extra: Record<string, string> = {}) {
  return fontResourceRequests(fontProgram(source, extra), '/model.ts').map(
    ({family, options}) => ({family, options}),
  );
}

for (const interruption of ['failure', 'cancellation'] as const) {
  test(`Google font ${interruption} never publishes a partial subset bundle`, async () => {
    const cssUrl = googleFontUrl('Test Font').href;
    const latin = 'https://fonts.example/latin.ttf';
    const extended = 'https://fonts.example/extended.ttf';
    const css = `@font-face {src: url(${latin}); unicode-range: U+0000-00FF;}
@font-face {src: url(${extended}); unicode-range: U+0100-017F;}`;
    const counts = new Map<string, number>();
    let interrupted = true;
    let cancelled = false;
    let started!: () => void;
    const slowStarted = new Promise<void>(resolve => {
      started = resolve;
    });
    const request: typeof fetch = async (input, options) => {
      const url = String(input);
      counts.set(url, (counts.get(url) ?? 0) + 1);
      if (url === extended && interrupted) {
        if (interruption === 'failure') throw new Error('Missing subset');
        started();
        await new Promise<void>((_resolve, reject) => {
          options!.signal!.addEventListener(
            'abort',
            () => reject(options!.signal!.reason),
            {once: true},
          );
        });
      }
      return new Response(url === cssUrl ? css : url, {
        headers: {
          'cache-control': url === cssUrl ? 'max-age=0' : 'max-age=3600',
        },
      });
    };
    const store = disk();
    const files = {
      async readFile() {
        return undefined;
      },
      async stat() {
        return undefined;
      },
    };
    const source =
      "import {googleFont} from './api.d.ts'; googleFont('Test Font');";
    const prepare = async (assets: InstanceType<typeof ProjectAssets>) => {
      assets.beginCompilation(() => {
        if (cancelled) throw new Error('Cancelled');
      });
      assets.setStore(store);
      assets.setGoogleContext(fontProgram(source), {
        googleFontUrl,
        googleFontSources,
      });
      try {
        await assets.rewrite('/model.ts', source);
        return assets.snapshot();
      } finally {
        await assets.finishCompilation();
      }
    };
    const assets = new ProjectAssets(files, request);
    const pending = assert.rejects(prepare(assets), error => {
      const diagnostic = (
        error as import('../src/model/diagnostic.ts').ModelDiagnosticError
      ).diagnostic;
      assert.equal(diagnostic.sourceRef?.file, '/model.ts');
      assert.match(
        diagnostic.summary,
        interruption === 'failure' ? /Missing subset/ : /Cancelled/,
      );
      return true;
    });
    if (interruption === 'cancellation') {
      await slowStarted;
      cancelled = true;
    }
    await pending;
    assert.equal(
      [...store.entries.keys()].some(key => key.startsWith('bundle:')),
      false,
    );
    interrupted = cancelled = false;
    const restored = await prepare(new ProjectAssets(files, request));
    assert.equal(counts.get(cssUrl), 2);
    assert.equal(
      counts.get(latin),
      1,
      'the completed subset survives the interrupted build',
    );
    assert.equal(counts.get(extended), 2);
    assert.equal(restored.size, 3);
    assert.deepEqual(googleFontSources(restored.get(cssUrl)!), [
      {url: extended, ranges: [[0x100, 0x17f]]},
      {url: latin, ranges: [[0, 0xff]]},
    ]);
    const offline = new ProjectAssets(files, async () => {
      throw new Error('Offline');
    });
    assert.deepEqual(await prepare(offline), restored);
  });
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
