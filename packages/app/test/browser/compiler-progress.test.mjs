import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium} from 'playwright-core';

let browser;
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

async function fixture(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const url = new URL(
    '/__compiler-progress-test__',
    process.env.CODE3D_TEST_URL,
  );
  await page.route(url.href, route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main>Compiler progress</main>',
    }),
  );
  await page.goto(url.href);
  await page.evaluate(async () => {
    const {ModelCompilerClient} = await import('/src/model/compiler-client.ts');
    const {browserPackageFiles} =
      await import('/src/project/browser-packages.ts');
    window.packageFiles = browserPackageFiles;
    window.client = new ModelCompilerClient({
      async readFile() {},
      async stat() {},
    });
    window.compile = (
      onProgress,
      source = 'import {box} from "@code3d/core"; export default box(1, 2, 3);',
    ) =>
      client.compile(
        {files: [{path: '/model.ts', source}]},
        '/model.ts',
        undefined,
        onProgress,
      );
  });
  return page;
}

const runtimePhases = [
  'loading-project',
  'loading-runtime',
  'initializing-runtime',
  'compiling-model',
  'evaluating-model',
];

test(
  'reports loading before WASM reads and reuses the initialized runtime on edits',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const cold = [];
      const warm = [];
      const wasmReads = [];
      const read = packageFiles.readFile;
      packageFiles.readFile = async path => {
        if (path.endsWith('.wasm')) wasmReads.push({path, phase: cold.at(-1)});
        return read(path);
      };
      try {
        const first = await compile(phase => cold.push(phase));
        const readsAfterFirst = wasmReads.length;
        const second = await compile(phase => warm.push(phase));
        return {
          cold,
          warm,
          wasmReads,
          readsAfterFirst,
          diagnostic: second.diagnostic,
          exportable: client.canExport(second),
          hasModel: first.exports.has('default'),
        };
      } finally {
        client.dispose();
      }
    });
    assert.deepEqual(result.cold, ['loading-compiler', ...runtimePhases]);
    assert.deepEqual(result.warm, [
      'loading-project',
      'compiling-model',
      'evaluating-model',
    ]);
    assert.equal(result.readsAfterFirst, 1);
    assert.equal(result.wasmReads.length, result.readsAfterFirst);
    assert.ok(result.wasmReads.every(read => read.phase === 'loading-runtime'));
    assert.equal(result.diagnostic, undefined);
    assert.equal(result.exportable, true);
    assert.equal(result.hasModel, true);
  },
);

test(
  'ignores cancelled progress while preserving in-flight runtime preparation',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const cancelled = [];
      const next = [];
      try {
        let error;
        try {
          await compile(phase => {
            cancelled.push(phase);
            if (phase === 'loading-runtime') client.cancel();
          });
        } catch (failure) {
          error = failure.message;
        }
        const model = await compile(phase => next.push(phase));
        return {cancelled, next, error, diagnostic: model.diagnostic};
      } finally {
        client.dispose();
      }
    });
    assert.match(result.error, /superseded/);
    assert.deepEqual(result.cancelled, [
      'loading-compiler',
      'loading-project',
      'loading-runtime',
    ]);
    assert.deepEqual(result.next, [
      'loading-project',
      'compiling-model',
      'evaluating-model',
    ]);
    assert.equal(result.diagnostic, undefined);
  },
);

test(
  'reports a failed WASM read without entering initialization and can retry',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const failed = [];
      const retried = [];
      const read = packageFiles.readFile;
      let fail = true;
      packageFiles.readFile = async path => {
        if (fail && path.endsWith('.wasm')) {
          fail = false;
          throw new Error('Simulated WASM download failure');
        }
        return read(path);
      };
      try {
        let error;
        try {
          await compile(phase => failed.push(phase));
        } catch (failure) {
          error = [failure.message, failure.diagnostic?.details].join('\n');
        }
        const model = await compile(phase => retried.push(phase));
        return {failed, retried, error, diagnostic: model.diagnostic};
      } finally {
        client.dispose();
      }
    });
    assert.match(result.error, /Simulated WASM download failure/);
    assert.deepEqual(result.failed, [
      'loading-compiler',
      'loading-project',
      'loading-runtime',
    ]);
    assert.deepEqual(result.retried, runtimePhases);
    assert.equal(result.diagnostic, undefined);
  },
);

test('can retry a failed compiler download', {timeout: 120_000}, async t => {
  const page = await fixture(t);
  let downloads = 0;
  await page.context().route(
    url => url.pathname.endsWith('/esbuild.wasm') && !url.search,
    route => {
      downloads++;
      return downloads === 1
        ? route.fulfill({status: 503, body: 'Temporarily unavailable'})
        : route.continue();
    },
  );
  const result = await page.evaluate(async () => {
    const failed = [];
    const retried = [];
    try {
      let error;
      try {
        await compile(phase => failed.push(phase));
      } catch (failure) {
        error = failure.message;
      }
      const model = await compile(phase => retried.push(phase));
      return {failed, retried, error, diagnostic: model.diagnostic};
    } finally {
      client.dispose();
    }
  });
  assert.equal(downloads, 2);
  assert.match(result.error, /Failed to download/);
  assert.deepEqual(result.failed, ['loading-compiler']);
  assert.deepEqual(result.retried, ['loading-compiler', ...runtimePhases]);
  assert.equal(result.diagnostic, undefined);
});

test(
  'execution progress still arms the execution deadline and restarts a stuck worker',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const phases = [];
      const recovered = [];
      const deadlines = [];
      const setTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => {
        deadlines.push(delay);
        return setTimeout(callback, delay === 15_000 ? 100 : delay, ...args);
      };
      try {
        let error;
        try {
          await compile(phase => phases.push(phase), 'while (true) {}');
        } catch (failure) {
          error = failure.message;
        }
        window.setTimeout = setTimeout;
        const model = await compile(phase => recovered.push(phase));
        return {
          phases,
          recovered,
          deadlines,
          error,
          diagnostic: model.diagnostic,
        };
      } finally {
        window.setTimeout = setTimeout;
        client.dispose();
      }
    });
    assert.equal(result.phases.at(-1), 'evaluating-model');
    assert.deepEqual(result.deadlines, [120_000, 15_000]);
    assert.match(result.error, /Model execution exceeded 15 seconds/);
    assert.deepEqual(result.recovered, ['loading-compiler', ...runtimePhases]);
    assert.equal(result.diagnostic, undefined);
  },
);
