import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {after, before, test} from 'node:test';
import type {Browser} from 'playwright-core';
import {chromium} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';
type CompilationPhase =
  import('../../src/model/compilation-progress.ts').CompilationPhase;
declare const packageFiles: typeof import('../../src/project/browser-packages.ts').browserPackageFiles;
declare const compile: (
  onProgress?: (phase: CompilationPhase) => void,
  source?: string,
) => ReturnType<typeof client.compile>;
declare const client: import('../../src/model/compiler-client.ts').ModelCompilerClient;
declare const window: Window & {
  client: typeof client;
  compile: typeof compile;
  packageFiles: typeof packageFiles;
  Worker: typeof Worker;
  compilerWorkers: number;
  executorWorkers: number;
  executorWorker: Worker;
  workerEvents: {
    kind: string;
    label?: string;
    stats?: {
      hits: number;
      misses: number;
      entries: number;
      nativeAllocatedBytes: number;
      estimatedJavaScriptBytes: number;
      maximumBytes: number;
    };
  }[];
  cancelledCompile: Promise<string>;
  delayedOperation: {
    settled: boolean;
    release?: () => void;
    result: Promise<string>;
  };
};

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

async function fixture(t: TestContext) {
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
      headers: appIsolationHeaders,
      body: '<main>Compiler progress</main>',
    }),
  );
  await page.route('**/src/model/compiler-client.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      // Bind probes to the reader imported by the compiler itself. Vite HMR
      // can give that import a different URL and identity than a bare import.
      body:
        (await response.text()) +
        '\nwindow.packageFiles = browserPackageFiles;',
    });
  });
  await page.goto(url.href);
  await page.evaluate(async () => {
    window.compilerWorkers = 0;
    window.executorWorkers = 0;
    window.workerEvents = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes('/compiler.worker')) window.compilerWorkers++;
        if (String(url).includes('/executor.worker')) {
          window.executorWorkers++;
          window.executorWorker = this;
        }
        this.addEventListener('message', ({data}) => {
          if (data.kind === 'cache-probe' || data.kind === 'cancelled')
            window.workerEvents.push(data);
        });
      }
    };
    const {ModelCompilerClient} = await import('/src/model/compiler-client.ts');
    window.client = new ModelCompilerClient({
      async readFile() {
        return undefined;
      },
      async stat() {
        return undefined;
      },
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
  'reading-files',
  'resolving-imports',
  'loading-runtime',
  'compiling-model',
  'initializing-runtime',
  'evaluating-model',
  'preparing-preview',
];

test('project preparation can exceed two minutes and still compile normally', async t => {
  const page = await fixture(t);
  await page.clock.install();
  await page.evaluate(async () => {
    client.dispose();
    const {ModelCompilerClient} = await import('/src/model/compiler-client.ts');
    let release!: () => void;
    const preparation = new Promise<void>(resolve => {
      release = resolve;
    });
    window.client = new ModelCompilerClient(
      {async readFile() {}, async stat() {}},
      () => preparation,
    );
    window.delayedOperation = {
      settled: false,
      release,
      result: compile().then(
        module => {
          window.delayedOperation.settled = true;
          return module.diagnostic?.summary ?? 'compiled';
        },
        error => {
          window.delayedOperation.settled = true;
          return error.message;
        },
      ),
    };
  });
  await page.clock.fastForward(300_000);
  assert.deepEqual(
    await page.evaluate(() => ({
      pending: client.isCompiling(),
      phase: client.phase,
      settled: window.delayedOperation.settled,
    })),
    {pending: true, phase: 'loading-runtime', settled: false},
  );
  assert.equal(
    await page.evaluate(async () => {
      window.delayedOperation.release!();
      try {
        return await window.delayedOperation.result;
      } finally {
        client.dispose();
      }
    }),
    'compiled',
  );
});

for (const operation of ['export', 'sketch', 'clear-build-cache'] as const) {
  test(`${operation} waits for its result beyond the former deadline`, async t => {
    const page = await fixture(t);
    await page.clock.install();
    await page.evaluate(async operation => {
      if (operation === 'clear-build-cache') {
        client.dispose();
        const {ModelCompilerClient} =
          await import('/src/model/compiler-client.ts');
        window.client = new ModelCompilerClient(
          {async readFile() {}, async stat() {}},
          undefined,
          'deadline-fixture',
        );
      }
      const module = await compile(
        undefined,
        operation === 'sketch'
          ? "import {sketch} from '@code3d/core'; const value = sketch([['point', 1, [0, 0]]]);"
          : undefined,
      );
      const delayReply = (worker: Worker) => {
        const receive = worker.onmessage!;
        worker.onmessage = event => {
          if (
            event.data.kind ===
            (operation === 'clear-build-cache'
              ? 'build-cache-cleared'
              : operation)
          ) {
            window.delayedOperation.release = () => receive.call(worker, event);
          } else receive.call(worker, event);
        };
      };
      if (operation === 'clear-build-cache') {
        const create = client['createCompiler'].bind(client);
        client['createCompiler'] = () => {
          const worker = create();
          delayReply(worker);
          return worker;
        };
      } else delayReply(client['executor']);
      let pending: Promise<string>;
      if (operation === 'clear-build-cache') {
        pending = client.clearBuildCache().then(() => 'cleared');
      } else if (operation === 'export') {
        const node = module.fallback!;
        pending = client
          .export(
            module,
            [
              {
                nodeId: node.nodeId,
                kind: 'solid',
                name: node.name,
                transform: node.transform,
              },
            ],
            {
              format: 'step',
              scale: 1,
              upAxis: 'y',
              tolerance: 0.1,
              angularTolerance: 0.1,
              binary: false,
            },
          )
          .then(blob => blob.text());
      } else {
        const sketch = [...module.sketches.values()][0];
        pending = client
          .previewSketchDrag([sketch], {
            id: 1,
            position: [60, 20],
            editable: new Map([[1, [true, true]]]),
            data: sketch.data,
          })
          .then(preview => JSON.stringify(preview.data));
      }
      window.delayedOperation = {
        settled: false,
        result: pending.then(
          value => {
            window.delayedOperation.settled = true;
            return value;
          },
          error => {
            window.delayedOperation.settled = true;
            return error.message;
          },
        ),
      };
    }, operation);
    await page.waitForFunction(() => !!window.delayedOperation.release);
    const workers = await page.evaluate(() => [
      window.compilerWorkers,
      window.executorWorkers,
    ]);
    await page.clock.fastForward(300_000);
    assert.equal(
      await page.evaluate(() => window.delayedOperation.settled),
      false,
    );
    assert.deepEqual(
      await page.evaluate(() => [
        window.compilerWorkers,
        window.executorWorkers,
      ]),
      workers,
    );
    const result = await page.evaluate(async () => {
      window.delayedOperation.release!();
      return window.delayedOperation.result;
    });
    if (operation === 'export') assert.match(result, /ISO-10303-21/);
    else if (operation === 'sketch')
      assert.deepEqual(JSON.parse(result), [{id: 1, parameters: [60, 20]}]);
    else assert.equal(result, 'cleared');

    if (operation === 'sketch') {
      const cancelled = await page.evaluate(async () => {
        const module = await compile(
          undefined,
          "import {sketch} from '@code3d/core'; const value = sketch([['point', 1, [0, 0]]]);",
        );
        const sketch = [...module.sketches.values()][0];
        const workers = window.executorWorkers;
        const pending = client
          .previewSketchDrag([sketch], {
            id: 1,
            position: [10, 5],
            editable: new Map([[1, [true, true]]]),
            data: sketch.data,
          })
          .then(
            () => 'unexpected success',
            error => error.message,
          );
        client.cancel();
        const error = await pending;
        const rebuilt = await compile();
        return {
          error,
          restarted: window.executorWorkers > workers,
          diagnostic: rebuilt.diagnostic,
        };
      });
      assert.match(cancelled.error, /superseded/);
      assert.equal(cancelled.restarted, true);
      assert.equal(cancelled.diagnostic, undefined);
    }
    await page.evaluate(() => client.dispose());
  });
}

test(
  'reports loading before WASM reads and reuses the initialized runtime on edits',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const cold: CompilationPhase[] = [];
      const warm: CompilationPhase[] = [];
      const wasmReads: {path: string; phase: CompilationPhase | undefined}[] =
        [];
      const read = packageFiles.readFile;
      packageFiles.readFile = async path => {
        if (path.endsWith('.wasm')) wasmReads.push({path, phase: cold.at(-1)});
        return read(path);
      };
      try {
        const first = await compile(phase => cold.push(phase));
        const readsAfterFirst = wasmReads.length;
        const second = await compile(
          phase => warm.push(phase),
          'import {box} from "@code3d/core"; export default box(4, 2, 3);',
        );
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
      'reading-files',
      'compiling-model',
      'evaluating-model',
      'preparing-preview',
    ]);
    assert.equal(result.readsAfterFirst, 3);
    assert.equal(new Set(result.wasmReads.map(read => read.path)).size, 3);
    assert.equal(result.wasmReads.length, result.readsAfterFirst);
    assert.ok(result.wasmReads.every(read => read.phase === 'loading-runtime'));
    assert.equal(result.diagnostic, undefined);
    assert.equal(result.exportable, true);
    assert.equal(result.hasModel, true);
  },
);

test(
  'prepares newly imported declarations once and reuses them during later edits',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const read = packageFiles.readFile;
      const reads: string[] = [];
      packageFiles.readFile = async path => {
        reads.push(path);
        return read(path);
      };
      const added: CompilationPhase[] = [];
      const edited: CompilationPhase[] = [];
      try {
        await compile();
        const afterCold = reads.length;
        const source =
          'import type * as Screws from "@code3d/screws"; import {box} from "@code3d/core"; export default box(2, 3, 4);';
        const first = await compile(phase => added.push(phase), source);
        const afterAdded = reads.length;
        const second = await compile(
          phase => edited.push(phase),
          source.replace('box(2,', 'box(5,'),
        );
        return {
          added,
          edited,
          newReads: reads.slice(afterCold, afterAdded),
          laterReads: reads.slice(afterAdded),
          diagnostics: [first.diagnostic, second.diagnostic],
        };
      } finally {
        client.dispose();
      }
    });
    assert.deepEqual(result.added, [
      'reading-files',
      'resolving-imports',
      'compiling-model',
      'evaluating-model',
      'preparing-preview',
    ]);
    assert.deepEqual(result.edited, [
      'reading-files',
      'compiling-model',
      'evaluating-model',
      'preparing-preview',
    ]);
    assert.ok(
      result.newReads.some(
        path => path.includes('/@code3d/screws/') && path.endsWith('.d.ts'),
      ),
    );
    assert.deepEqual(result.laterReads, []);
    assert.deepEqual(result.diagnostics, [undefined, undefined]);
  },
);

for (const pause of ['kernel-loop', 'await'] as const) {
  test(
    `cancelling a ${pause} preserves the complete prefix and runs only the latest queued revision`,
    {timeout: 120_000},
    async t => {
      const page = await fixture(t);
      await page.evaluate(async pause => {
        if (!crossOriginIsolated)
          throw new Error('The compiler fixture must be isolated.');
        const read = packageFiles.readFile;
        packageFiles.readFile = async path => {
          const bytes = await read(path);
          if (!bytes || !path.endsWith('/tooling/index.js')) return bytes;
          return new TextEncoder().encode(
            new TextDecoder().decode(bytes) +
              '\nglobalThis.__cacheProbe = kernelOperationCacheStats;',
          );
        };
        const source = [
          'import {box, group} from "@code3d/core";',
          'const parts = Array.from({length: 320}, (_, i) => box(i + 1, 2, 3));',
          'globalThis.postMessage({kind: "cache-probe", label: "prefix", stats: (globalThis as any).__cacheProbe()});',
          pause === 'kernel-loop'
            ? 'while (true) box(1, 2, 3);'
            : 'await new Promise(resolve => setTimeout(resolve, 1_000));',
          'export default group(parts);',
        ].join('\n');
        window.cancelledCompile = compile(undefined, source).then(
          () => 'unexpected success',
          error => (error as Error).message,
        );
      }, pause);
      await page.waitForFunction(() =>
        window.workerEvents.some(event => event.label === 'prefix'),
      );
      const result = await page.evaluate(async () => {
        const phases: CompilationPhase[] = [];
        try {
          const skipped = compile(
            undefined,
            'throw new Error("Queued revision must not execute");',
          ).then(
            () => 'unexpected success',
            error => (error as Error).message,
          );
          const model = await compile(
            phase => phases.push(phase),
            [
              'import {box, group} from "@code3d/core";',
              'const parts = Array.from({length: 320}, (_, i) => box(i + 1, 2, 3));',
              'globalThis.postMessage({kind: "cache-probe", label: "reused", stats: (globalThis as any).__cacheProbe()});',
              'export default group(parts);',
            ].join('\n'),
          );
          // A completed cancellation must also disarm its forced-restart timer.
          await new Promise(resolve => window.setTimeout(resolve, 5_100));
          return {
            error: await window.cancelledCompile,
            skipped: await skipped,
            phases,
            workers: window.compilerWorkers,
            events: window.workerEvents,
            diagnostic: model.diagnostic,
            exportable: client.canExport(model),
          };
        } finally {
          client.dispose();
        }
      });
      assert.match(result.error, /Compilation superseded/);
      assert.match(result.skipped, /Compilation superseded/);
      assert.equal(result.diagnostic, undefined);
      assert.equal(result.exportable, true);
      assert.equal(result.workers, 1);
      assert.deepEqual(result.phases, [
        'reading-files',
        'compiling-model',
        'evaluating-model',
        'preparing-preview',
      ]);
      assert.equal(
        result.events.filter(event => event.kind === 'cancelled').length,
        1,
      );
      const before = result.events.find(
        event => event.label === 'prefix',
      )!.stats!;
      const after = result.events.find(
        event => event.label === 'reused',
      )!.stats!;
      assert.ok(before.entries > 256);
      assert.ok(before.nativeAllocatedBytes > 0);
      assert.ok(before.estimatedJavaScriptBytes > 0);
      assert.equal(before.maximumBytes, 2 * 1024 ** 3);
      assert.equal(after.misses, before.misses);
      assert.ok(after.hits >= before.hits + 320);
    },
  );
}

test(
  'finishes cancelled preparation and reuses the initialized worker for the latest project',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const cancelled: CompilationPhase[] = [];
      const next: CompilationPhase[] = [];
      try {
        let error;
        try {
          await compile(phase => {
            cancelled.push(phase);
            if (phase === 'loading-runtime') client.cancel();
          });
        } catch (failure) {
          if (!(failure instanceof Error)) throw failure;
          error = failure.message;
        }
        const model = await compile(phase => next.push(phase));
        return {
          cancelled,
          next,
          error,
          diagnostic: model.diagnostic,
          workers: window.compilerWorkers,
        };
      } finally {
        client.dispose();
      }
    });
    assert.match(result.error!, /superseded/);
    assert.deepEqual(result.cancelled, [
      'loading-compiler',
      'reading-files',
      'resolving-imports',
      'loading-runtime',
    ]);
    assert.deepEqual(result.next, [
      'reading-files',
      'loading-runtime',
      'compiling-model',
      'initializing-runtime',
      'evaluating-model',
      'preparing-preview',
    ]);
    assert.equal(result.workers, 1);
    assert.equal(result.diagnostic, undefined);
  },
);

test(
  'reports a failed WASM read without entering initialization and can retry',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const failed: CompilationPhase[] = [];
      const retried: CompilationPhase[] = [];
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
          if (!(failure instanceof Error)) throw failure;
          if (
            failure.name !== 'ModelDiagnosticError' ||
            !('diagnostic' in failure)
          )
            throw failure;
          // Check the worker's structured error contract. A separate dynamic
          // import can load another class identity after Vite hot updates.
          const diagnostic =
            failure.diagnostic as import('../../src/model/diagnostic.ts').ModelDiagnostic;
          error = [failure.message, diagnostic.details].join('\n');
        }
        const model = await compile(phase => retried.push(phase));
        return {failed, retried, error, diagnostic: model.diagnostic};
      } finally {
        client.dispose();
      }
    });
    assert.match(result.error!, /Simulated WASM download failure/);
    assert.deepEqual(result.failed, [
      'loading-compiler',
      'reading-files',
      'resolving-imports',
      'loading-runtime',
    ]);
    assert.deepEqual(result.retried, [
      'reading-files',
      ...runtimePhases.slice(2),
    ]);
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
    const failed: CompilationPhase[] = [];
    const retried: CompilationPhase[] = [];
    try {
      let error;
      try {
        await compile(phase => failed.push(phase));
      } catch (failure) {
        if (!(failure instanceof Error)) throw failure;
        error = failure.message;
      }
      const model = await compile(phase => retried.push(phase));
      return {failed, retried, error, diagnostic: model.diagnostic};
    } finally {
      client.dispose();
    }
  });
  assert.equal(downloads, 2);
  assert.match(result.error!, /Failed to download/);
  assert.deepEqual(result.failed, ['loading-compiler']);
  assert.deepEqual(result.retried, ['loading-compiler', ...runtimePhases]);
  assert.equal(result.diagnostic, undefined);
});

test(
  'execution can exceed 15 seconds and a new compile terminates a stuck worker',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const phases: CompilationPhase[] = [];
      const recovered: CompilationPhase[] = [];
      try {
        let started!: () => void;
        const evaluating = new Promise<void>(resolve => {
          started = resolve;
        });
        let settled = false;
        const stuck = compile(phase => {
          phases.push(phase);
          if (phase === 'evaluating-model') started();
        }, 'while (true) {}').then(
          () => {
            settled = true;
            return '';
          },
          error => {
            settled = true;
            return (error as Error).message;
          },
        );
        await evaluating;
        await new Promise(resolve => window.setTimeout(resolve, 16_000));
        const stillRunning = !settled && client.isCompiling();
        const model = await compile(phase => recovered.push(phase));
        return {
          phases,
          recovered,
          stillRunning,
          error: await stuck,
          diagnostic: model.diagnostic,
          compilerWorkers: window.compilerWorkers,
          executorWorkers: window.executorWorkers,
        };
      } finally {
        client.dispose();
      }
    });
    assert.equal(result.phases.at(-1), 'evaluating-model');
    assert.equal(result.stillRunning, true);
    assert.match(result.error, /Compilation superseded/);
    assert.deepEqual(result.recovered, [
      'reading-files',
      'resolving-imports',
      'compiling-model',
      'initializing-runtime',
      'evaluating-model',
      'preparing-preview',
    ]);
    assert.equal(result.compilerWorkers, 1);
    assert.equal(result.executorWorkers, 2);
    assert.equal(result.diagnostic, undefined);
  },
);

test(
  'executor errors reject pending topology inspection and allow rebuilding',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      try {
        const model = await compile();
        window.executorWorker.postMessage = () => {
          queueMicrotask(() =>
            window.executorWorker.dispatchEvent(
              new ErrorEvent('error', {message: 'Simulated executor failure'}),
            ),
          );
        };
        const error = await client
          .inspectTopology(
            model,
            model.objects.values().next().value!.nodeId,
            {},
          )
          .then(
            () => 'unexpected success',
            error => (error as Error).message,
          );
        const rebuilt = await compile();
        return {
          error,
          diagnostic: rebuilt.diagnostic,
          exportable: client.canExport(rebuilt),
          workers: window.executorWorkers,
        };
      } finally {
        client.dispose();
      }
    });
    assert.match(result.error, /Simulated executor failure/);
    assert.equal(result.diagnostic, undefined);
    assert.equal(result.exportable, true);
    assert.equal(result.workers, 2);
  },
);

for (const stage of ['compiler', 'executor', 'restore'] as const) {
  test(
    `cancels a ${stage} cache read promptly and reuses workers for the latest entry`,
    {timeout: 60_000},
    async t => {
      const page = await fixture(t);
      const result = await page.evaluate(async stage => {
        let releasePreparation: (() => void) | undefined;
        let preparing = true;
        if (stage === 'executor') await compile();
        if (stage !== 'executor') {
          client.dispose();
          const {ModelCompilerClient} =
            await import('/src/model/compiler-client.ts');
          window.client = new ModelCompilerClient(
            {async readFile() {}, async stat() {}},
            // Keep normal compilation out of the restore cancellation probe.
            stage === 'restore'
              ? () =>
                  preparing
                    ? new Promise<void>(resolve => {
                        releasePreparation = resolve;
                      })
                    : Promise.resolve()
              : undefined,
            'cancel-restore-fixture',
          );
        }
        const counts = [window.compilerWorkers, window.executorWorkers];
        const until = async (
          check: () => boolean | Promise<boolean>,
          timeout = 2000,
        ) => {
          const deadline = performance.now() + timeout;
          while (!(await check())) {
            if (performance.now() > deadline)
              throw new Error('Cancellation did not complete promptly');
            await new Promise(resolve => setTimeout(resolve, 5));
          }
        };
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
        try {
          const cancelled = compile(
            undefined,
            'import {box} from "@code3d/core"; export default box(913, 2, 3);',
          ).then(
            () => 'unexpected success',
            error => error.message,
          );
          await until(
            async () => !!(await navigator.locks.query()).pending?.length,
            15000,
          );
          const start = performance.now();
          client.cancel();
          // Public rejection alone is insufficient: wait for the real Worker
          // cancellation reply, or removal of the isolated restore lock request.
          await until(async () =>
            stage === 'restore'
              ? !(await navigator.locks.query()).pending?.length
              : window.workerEvents.some(event => event.kind === 'cancelled'),
          );
          const milliseconds = performance.now() - start;
          preparing = false;
          releasePreparation?.();
          const skipped = compile(
            undefined,
            'throw new Error("Obsolete entry executed");',
          ).then(
            () => 'unexpected success',
            error => error.message,
          );
          const latest = compile(
            undefined,
            'import {box} from "@code3d/core"; export default box(917, 2, 3);',
          );
          release();
          await held;
          const model = await latest;
          return {
            milliseconds,
            cancelled: await cancelled,
            skipped: await skipped,
            diagnostic: model.diagnostic,
            exportable: client.canExport(model),
            counts,
            after: [window.compilerWorkers, window.executorWorkers],
          };
        } finally {
          release();
          client.dispose();
        }
      }, stage);
      assert.match(result.cancelled, /Compilation superseded/);
      assert.match(result.skipped, /Compilation superseded/);
      assert.ok(result.milliseconds < 1000, JSON.stringify(result));
      assert.equal(result.diagnostic, undefined);
      assert.equal(result.exportable, true);
      assert.deepEqual(result.after, result.counts);
      t.diagnostic(JSON.stringify({stage, ...result}));
    },
  );
}
