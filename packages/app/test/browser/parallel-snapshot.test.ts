import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {after, before, test, type TestContext} from 'node:test';
import {chromium, type Browser, type Page} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';
import {normalizedModelSnapshot} from '../model-snapshot.ts';
import type {CacheRequest, CacheResult} from './persistent-cache.worker.ts';

let browser: Browser;
before(async () => {
  assert.ok(process.env.CODE3D_TEST_URL);
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

const source = `import {box,cylinder,cut,group,rectangle} from '@code3d/core';
export const blank=box(40,6,60).fillet(3,[2,4,6,8]);
export const holes=Array.from({length:10},(_,i)=>cylinder(1.1,12).originOffset(i*3-14,0,0));
export const machined=cut(blank,holes);
export const profile=rectangle(12,8).extrude(2).rotate(10,20,30).originOffset(0,12,0);
export const nested=group([machined,profile]).rotate(0,20,0);
export const assembly=group([nested,profile.originOffset(30,0,0)]);
export default machined;`;

async function fixture(t: TestContext) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const url = new URL(
    '/__parallel-snapshot-test__',
    process.env.CODE3D_TEST_URL,
  );
  await page.route(url.href, route =>
    route.fulfill({
      contentType: 'text/html',
      headers: appIsolationHeaders,
      body: '<main>Parallel snapshot test</main>',
    }),
  );
  await page.goto(url.href);
  return page;
}

async function compile(
  page: Page,
  request: CacheRequest,
  restart = false,
  cancelAtSnapshot = false,
): Promise<CacheResult & {cancelMilliseconds?: number}> {
  return page.evaluate(
    async ({request, restart, cancelAtSnapshot}) => {
      const host = window as unknown as {compiler?: Worker};
      if (restart) {
        host.compiler?.terminate();
        host.compiler = undefined;
      }
      const {default: CacheWorker} =
        await import('/test/browser/persistent-cache-host.ts');
      const worker = (host.compiler ??= new CacheWorker());
      const cancellation = new Int32Array(new SharedArrayBuffer(4));
      let cancelledAt: number | undefined;
      return new Promise<CacheResult & {cancelMilliseconds?: number}>(
        (resolve, reject) => {
          worker.onerror = event => reject(new Error(event.message));
          worker.onmessage = ({data}) => {
            if (data.phase === 'snapshot-query' && cancelAtSnapshot) {
              cancelledAt ??= performance.now();
              Atomics.store(cancellation, 0, 1);
            }
            if (!data.phase)
              resolve({
                ...data,
                cancelMilliseconds:
                  cancelledAt === undefined
                    ? undefined
                    : performance.now() - cancelledAt,
              });
          };
          worker.postMessage({...request, cancellation});
        },
      );
    },
    {request, restart, cancelAtSnapshot},
  );
}
function valid(result: CacheResult) {
  assert.equal(result.error, undefined);
  assert.equal(result.diagnostic, undefined);
  assert.equal(result.stats.memory?.persistenceErrors, 0);
}

function snapshotDigest(value: string): string {
  return createHash('sha256')
    .update(normalizedModelSnapshot(value))
    .digest('hex');
}

test(
  'one, two and four workers preserve snapshots and retained geometry across edits',
  {timeout: 180_000},
  async t => {
    const page = await fixture(t);
    let expected: string | undefined;
    for (const concurrency of [1, 2, 4]) {
      const result = await compile(
        page,
        {source, concurrency, disabled: true, inspect: true},
        true,
      );
      valid(result);
      expected ??= result.objects;
      assert.equal(result.objects, expected);
      assert.equal(
        result.stats.snapshots?.workers,
        concurrency === 1 ? 0 : concurrency,
      );
      assert.ok(result.stats.snapshots!.queries > 0);
      assert.equal(
        result.stats.snapshots!.completed,
        result.stats.snapshots!.queries,
      );
      assert.ok(result.stepBytes! > 1000);
      const warm = await compile(page, {
        source: source + '\nexport {profile as selected};',
      });
      valid(warm);
      assert.equal(warm.stats.snapshots!.queries, 0);
      assert.equal(warm.stats.memory!.misses, result.stats.memory!.misses);
      const edited = await compile(page, {
        source: source.replace('box(40,6,60)', 'box(42,6,60)'),
      });
      valid(edited);
      assert.ok(edited.stats.snapshots!.queries > 0);
      const undo = await compile(page, {source});
      valid(undo);
      assert.equal(snapshotDigest(undo.objects!), snapshotDigest(expected!));
      assert.equal(undo.stats.snapshots!.queries, 0);
    }
  },
);

test(
  'a terminated compute worker preserves completed results and retries its unfinished batch',
  {timeout: 90_000},
  async t => {
    const page = await fixture(t);
    const reference = await compile(
      page,
      {source, concurrency: 1, disabled: true},
      true,
    );
    valid(reference);
    const result = await compile(
      page,
      {source, concurrency: 2, disabled: true, terminateChild: true},
      true,
    );
    valid(result);
    assert.equal(result.stats.snapshots!.retries, 1);
    assert.equal(result.objects, reference.objects);
    const warm = await compile(page, {source});
    valid(warm);
    assert.equal(warm.stats.snapshots!.queries, 0);
  },
);

test(
  'cancelling during parallel queries retains its completed prefix and resumes the latest revision',
  {timeout: 90_000},
  async t => {
    const page = await fixture(t);
    const cancelled = await compile(
      page,
      {source, concurrency: 2, trackSnapshots: true},
      false,
      true,
    );
    assert.match(cancelled.error!, /Cancelled/);
    assert.ok(cancelled.cancelMilliseconds! < 5000);
    t.diagnostic(
      `Cancellation after first snapshot result: ${cancelled.cancelMilliseconds} ms`,
    );
    assert.ok(cancelled.stats.snapshots!.completed > 0);
    const result = await compile(page, {
      source: source + '\nexport {profile as latest};',
    });
    valid(result);
    assert.ok(
      result.stats.snapshots!.queries < cancelled.stats.snapshots!.queries,
    );
    const restored = await compile(page, {source}, true);
    valid(restored);
    assert.equal(restored.stats.memory!.misses, 0);
    assert.equal(restored.stats.snapshots!.queries, 0);
  },
);
