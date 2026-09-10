import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {before, after, test, type TestContext} from 'node:test';
import {chromium, type Browser, type Page} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';
import type {CacheRequest, CacheResult} from './persistent-cache.worker.ts';

let browser: Browser;
before(async () => {
  assert.ok(
    process.env.CODE3D_TEST_URL,
    'Set CODE3D_TEST_URL to the task server',
  );
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

const source = `import {box, cylinder, cut, group, rectangle} from '@code3d/core';
export const blank = box(40, 6, 60).fillet(3, [2, 4, 6, 8]);
export const holes = Array.from({length: 6}, (_, i) => cylinder(1.3, 12).originOffset(i * 5 - 12, 0, 0));
export const machined = cut(blank, holes);
export const profile = rectangle(12, 8).extrude(2).rotate(10, 20, 30).originOffset(0, 12, 0);
export const assembly = group([machined, profile]).rotate(0, 20, 0);
export default machined;`;

async function fixture(t: TestContext) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const url = new URL(
    '/__persistent-cache-test__',
    process.env.CODE3D_TEST_URL,
  );
  await context.route(url.href, route =>
    route.fulfill({
      contentType: 'text/html',
      headers: appIsolationHeaders,
      body: '<main>Persistent cache</main>',
    }),
  );
  await page.goto(url.href);
  return page;
}

async function compile(
  page: Page,
  request: CacheRequest,
  workerName = 'compiler',
  restart = false,
): Promise<CacheResult> {
  return page.evaluate(
    async ({request, workerName, restart}) => {
      const host = window as unknown as {workers?: Record<string, Worker>};
      host.workers ??= {};
      if (restart) {
        host.workers[workerName]?.terminate();
        delete host.workers[workerName];
      }
      const {default: CacheWorker} =
        await import('/test/browser/persistent-cache.worker.ts?worker');
      const worker = (host.workers[workerName] ??= new CacheWorker());
      return new Promise<CacheResult>((resolve, reject) => {
        worker.onerror = error => reject(new Error(error.message));
        worker.onmessage = ({data}) => {
          if (!data.phase) resolve(data);
        };
        worker.postMessage(request);
      });
    },
    {request, workerName, restart},
  );
}

function valid(result: CacheResult) {
  assert.equal(result.error, undefined);
  assert.equal(result.diagnostic, undefined);
  assert.equal(result.stats.memory?.persistenceErrors, 0);
  assert.equal(result.stats.disk?.errors, 0);
}

test(
  'fresh Workers and page refresh restore complete geometry; edits and undo retain both histories',
  {timeout: 180_000},
  async t => {
    const page = await fixture(t);
    const cold = await compile(page, {source, inspect: true});
    valid(cold);
    assert.ok(cold.stats.memory!.misses > 50);
    assert.ok(cold.stats.disk!.diskBytes > 0);
    const restored = await compile(
      page,
      {source, inspect: true},
      'compiler',
      true,
    );
    valid(restored);
    assert.equal(restored.stats.memory!.misses, 0);
    assert.equal(
      restored.stats.memory!.persistentHits,
      cold.stats.memory!.entries,
    );
    assert.equal(digest(restored.objects!), digest(cold.objects!));
    sameTopology(JSON.parse(restored.topology!), JSON.parse(cold.topology!));
    assert.ok(restored.stepBytes! > 1000);
    const further = await compile(page, {
      source: source + '\nexport const rounded = profile.fillet(0.1);',
    });
    valid(further);
    assert.ok(further.stats.memory!.misses > 0);
    const changed = source.replace('box(40, 6, 60)', 'box(42, 6, 60)');
    const edit = await compile(page, {source: changed});
    valid(edit);
    assert.ok(edit.stats.memory!.misses > 0);
    await page.reload();
    const undo = await compile(page, {source, inspect: true});
    valid(undo);
    assert.equal(undo.stats.memory!.misses, 0);
    assert.equal(digest(undo.objects!), digest(cold.objects!));
    const redo = await compile(page, {source: changed}, 'compiler', true);
    valid(redo);
    assert.equal(redo.stats.memory!.misses, 0);
    t.diagnostic(
      JSON.stringify({
        coldMs: cold.milliseconds,
        restoredMs: restored.milliseconds,
        disk: redo.stats.disk,
        memory: restored.stats.memory,
      }),
    );
  },
);

test(
  'concurrent tabs share records safely and Core implementation changes invalidate them',
  {timeout: 180_000},
  async t => {
    const page = await fixture(t);
    const peer = await page.context().newPage();
    await peer.goto(page.url());
    const results = await Promise.all([
      compile(page, {source}, 'one'),
      compile(peer, {source}, 'two'),
    ]);
    results.forEach(valid);
    assert.equal(digest(results[0].objects!), digest(results[1].objects!));
    assert.ok(results.some(result => result.stats.memory!.misses === 0));
    const changed = await compile(page, {source, revision: 1}, 'three');
    valid(changed);
    assert.ok(changed.stats.memory!.misses > 50);
    assert.equal(changed.stats.memory!.persistentHits, 0);
    const original = await compile(page, {source}, 'four');
    valid(original);
    assert.equal(original.stats.memory!.misses, 0);
  },
);

test(
  'a failed build persists its completed prefix, and unavailable OPFS still builds',
  {timeout: 180_000},
  async t => {
    const page = await fixture(t);
    const failed = await compile(page, {
      source: source + '\nthrow new Error("fixture failure");',
    });

    assert.ok(failed.diagnostic);
    assert.ok(failed.stats.memory!.persistentWrites > 0);
    const recovered = await compile(page, {source}, 'compiler', true);
    valid(recovered);
    assert.ok(recovered.stats.memory!.persistentHits > 0);
    const memoryOnly = await compile(
      page,
      {source, disabled: true},
      'disabled',
    );
    assert.equal(memoryOnly.diagnostic, undefined);
    assert.equal(memoryOnly.error, undefined);
    assert.equal(memoryOnly.stats.disk, undefined);
    assert.equal(digest(memoryOnly.objects!), digest(recovered.objects!));
  },
);

for (const mode of ['cancel', 'terminate'] as const) {
  test(
    `${mode} preserves completed disk artifacts for a new Worker`,
    {timeout: 180_000},
    async t => {
      const page = await fixture(t);
      const interrupted = await page.evaluate(
        async ({source, mode}) => {
          const {default: CacheWorker} =
            await import('/test/browser/persistent-cache.worker.ts?worker');
          const worker = new CacheWorker();
          const cancellation = new Int32Array(new SharedArrayBuffer(4));
          const extra =
            mode === 'terminate'
              ? '\nfor (let i = 0; i < 40; i++) box(50 + i, 10, 20).fillet(1);\nglobalThis.postMessage({phase: "interrupt"});\nwhile (true) {}'
              : '\nglobalThis.postMessage({phase: "interrupt"});\nawait new Promise(resolve => setTimeout(resolve, 100));\nbox(100, 100, 100);';
          return new Promise<CacheResult | undefined>((resolve, reject) => {
            worker.onerror = error => reject(new Error(error.message));
            worker.onmessage = ({data}) => {
              if (data.phase === 'interrupt') {
                if (mode === 'terminate') {
                  worker.terminate();
                  resolve(undefined);
                } else Atomics.store(cancellation, 0, 1);
              } else if (!data.phase) {
                worker.terminate();
                resolve(data);
              }
            };
            worker.postMessage({source: source + extra, cancellation});
          });
        },
        {source, mode},
      );
      if (mode === 'cancel') {
        assert.match(interrupted?.error ?? '', /Cancelled/);
        assert.ok(interrupted!.stats.memory!.persistentWrites > 0);
      }
      const recovered = await compile(page, {source, inspect: true});
      valid(recovered);
      assert.ok(recovered.stats.memory!.persistentHits > 0);
      assert.ok(recovered.stepBytes! > 1000);
    },
  );
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

test(
  'waiting for another tab to release the cache lock remains cancellable',
  {timeout: 60_000},
  async t => {
    const page = await fixture(t);
    const error = await page.evaluate(
      async ({source}) => {
        let release!: () => void;
        let acquired!: () => void;
        const ready = new Promise<void>(resolve => {
          acquired = resolve;
        });
        const held = navigator.locks.request(
          'code3d-kernel-artifacts',
          async () => {
            acquired();
            await new Promise<void>(resolve => {
              release = resolve;
            });
          },
        );
        await ready;
        const {default: CacheWorker} =
          await import('/test/browser/persistent-cache.worker.ts?worker');
        const worker = new CacheWorker();
        const cancellation = new Int32Array(new SharedArrayBuffer(4));
        try {
          return await new Promise<string>((resolve, reject) => {
            worker.onerror = event => reject(new Error(event.message));
            worker.onmessage = ({data}) => {
              if (data.phase === 'compiling-model')
                setTimeout(() => Atomics.store(cancellation, 0, 1), 100);
              else if (!data.phase)
                resolve(data.error ?? 'Unexpected completed model');
            };
            worker.postMessage({source, cancellation});
          });
        } finally {
          worker.terminate();
          release();
          await held;
        }
      },
      {source},
    );
    assert.match(error, /Cancelled/);
    valid(await compile(page, {source}));
  },
);

function sameTopology(
  actual: unknown,
  expected: unknown,
  path = 'topology',
): void {
  // BinTools rebuilds gp_Dir/gp_Ax3 via normalized directions. Recomputed native
  // measurements can differ by a few ULPs; IDs/connectivity and saved snapshots
  // remain exact. This is far tighter than the kernel's geometric tolerance.
  if (
    typeof actual === 'number' &&
    typeof expected === 'number' &&
    path.includes('.geometry.')
  ) {
    assert.ok(
      Math.abs(actual - expected) <=
        32 * Number.EPSILON * Math.max(1, Math.abs(expected)),
      `${path}: ${actual} vs ${expected}`,
    );
  } else if (
    actual &&
    expected &&
    typeof actual === 'object' &&
    typeof expected === 'object'
  ) {
    assert.deepEqual(Object.keys(actual), Object.keys(expected), path);
    for (const key of Object.keys(actual))
      sameTopology(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        path + '.' + key,
      );
  } else assert.equal(actual, expected, path);
}

test(
  'font text restores from OPFS in fresh Workers and keeps changed font histories',
  {timeout: 180_000},
  async t => {
    const page = await fixture(t);
    const latin = new Uint8Array(
      await readFile(
        new URL('../../examples/fonts/DejaVuSans.ttf', import.meta.url),
      ),
    );
    const chinese = new Uint8Array(
      await readFile(
        new URL(
          '../../../core/test/fonts/NotoSansCJK-subset.otf',
          import.meta.url,
        ),
      ),
    );
    const source = `import {font,text,extrude,group} from '@code3d/core';
const sans = font(new URL('./font.ttf',import.meta.url));
export default group(extrude(text('B8i', sans, 10),2));`;
    const assets = {'/font.ttf': {bytes: latin, version: '1'}};
    const cold = await compile(page, {
      source,
      assets,
      summary: true,
      concurrency: 4,
    });
    valid(cold);
    const restored = await compile(
      page,
      {source, assets, summary: true, concurrency: 4},
      'compiler',
      true,
    );
    valid(restored);
    assert.equal(restored.objects, cold.objects);
    assert.ok(restored.stats.memory!.persistentHits > 0);
    assert.equal(restored.stats.memory!.misses, 1); // The parsed font is memory-only.
    const changed = await compile(page, {
      source,
      summary: true,
      assets: {'/font.ttf': {bytes: chinese, version: '2'}},
    });
    valid(changed);
    assert.notEqual(changed.objects, cold.objects);
    const undo = await compile(
      page,
      {source, assets, summary: true},
      'compiler',
      true,
    );
    valid(undo);
    assert.equal(undo.objects, cold.objects);
  },
);

test(
  'engine prepares cross-origin font URLs, refreshes content and recovers from denied CORS',
  {timeout: 180_000},
  async t => {
    const {createServer} = await import('node:http');
    const latin = await readFile(
      new URL('../../examples/fonts/DejaVuSans.ttf', import.meta.url),
    );
    const chinese = await readFile(
      new URL(
        '../../../core/test/fonts/NotoSansCJK-subset.otf',
        import.meta.url,
      ),
    );
    let bytes = latin,
      allow = true,
      downloads = 0,
      cacheControl = 'no-store';
    const fontServer = createServer((request, response) => {
      response.setHeader('Cache-Control', cacheControl);
      if (allow) response.setHeader('Access-Control-Allow-Origin', '*');
      if (request.url === '/redirect.ttf') {
        response.writeHead(302, {Location: '/font.ttf'}).end();
        return;
      }
      downloads++;
      response.writeHead(200, {'Content-Type': 'font/ttf'}).end(bytes);
    });
    fontServer.listen(0, '127.0.0.1');
    await once(fontServer, 'listening');
    t.after(
      () =>
        new Promise<void>((resolve, reject) => {
          fontServer.close(error => (error ? reject(error) : resolve()));
          fontServer.closeAllConnections();
        }),
    );
    const address = fontServer.address();
    assert.ok(address && typeof address !== 'string');
    const fontUrl = `http://127.0.0.1:${address.port}/redirect.ttf`;
    const page = await fixture(t);
    // Playwright routing disables HTTP caching. The initial fixture document
    // is loaded; remove its route before testing real browser cache behavior.
    await page.context().unroute(page.url());
    assert.notEqual(new URL(page.url()).origin, new URL(fontUrl).origin);
    const source = `import {font, text, extrude, group} from '@code3d/core';
import {sans} from './font.ts';
const second = font(new URL('${fontUrl}'));
export default group([...extrude(text('B', sans, 10, {letterSpacing: 0.5, kerning: false}), 2), ...extrude(text('8i', second, 10), 2)]);`;
    const assets = {
      '/font.ts': {
        version: '1',
        bytes: new TextEncoder().encode(
          `import {font} from '@code3d/core'; export const sans = font(new URL('${fontUrl}', import.meta.url));`,
        ),
      },
    };
    const geometry = (result: CacheResult) =>
      createHash('sha256')
        .update(
          JSON.stringify(
            JSON.parse(result.objects!)
              .filter((object: {mesh?: unknown}) => object.mesh)
              .map((object: {mesh: unknown; transform: unknown}) => [
                object.mesh,
                object.transform,
              ]),
          ),
        )
        .digest('hex');
    const first = await compile(page, {source, assets});
    valid(first);
    assert.equal(
      downloads,
      1,
      'discovery, model compilation and both modules share one download',
    );
    bytes = chinese;
    const changed = await compile(page, {source});
    valid(changed);
    assert.equal(downloads, 2);
    assert.notEqual(geometry(changed), geometry(first));
    bytes = latin;
    const restored = await compile(page, {source});
    valid(restored);
    assert.equal(downloads, 3);
    assert.equal(geometry(restored), geometry(first));
    allow = false;
    const denied = await compile(page, {source});
    assert.match(
      JSON.stringify(denied.diagnostic ?? denied.error),
      /Cannot load network asset.*CORS/,
    );
    allow = true;
    cacheControl = 'public, max-age=3600';
    const recovered = await compile(page, {source});
    valid(recovered);
    assert.equal(geometry(recovered), geometry(first));
    const before = downloads;
    const cached = await compile(page, {source});
    valid(cached);
    assert.equal(
      downloads,
      before,
      'fresh HTTP cache avoids another font download',
    );
    assert.equal(geometry(cached), geometry(first));
  },
);
