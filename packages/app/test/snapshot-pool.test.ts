import type * as CoreTooling from '@code3d/core/tooling';
import type {
  SnapshotQueryBatch,
  SnapshotQueryResult,
} from '@code3d/core/tooling';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {setImmediate as nextTurn} from 'node:timers/promises';
import type {
  SnapshotWorkerRequest,
  SnapshotWorkerResponse,
} from '../src/model/snapshot-protocol.ts';
import {createAppTestServer} from './vite-test-server.ts';
let server: Awaited<ReturnType<typeof createAppTestServer>>;
let SnapshotWorkerPool: (typeof import('../src/model/snapshot-pool.ts'))['SnapshotWorkerPool'];
before(async () => {
  server = await createAppTestServer();
  ({SnapshotWorkerPool} = await server.ssrLoadModule<
    typeof import('../src/model/snapshot-pool.ts')
  >('/src/model/snapshot-pool.ts'));
});
after(async () => server?.close());

type Simulation = {
  created: number;
  active: number;
  maximumActive: number;
  started: string[];
  fault?: 'crash-once' | 'stall-once' | 'always';
  completed?: () => void;
  initializeDelay?: number;
  queryDelay?: number;
};
class ComputeWorker {
  onmessage: ((event: MessageEvent<SnapshotWorkerResponse>) => void) | null =
    null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private stopped = false;
  private running = false;
  private readonly ordinal: number;
  private readonly state: Simulation;
  constructor(state: Simulation) {
    this.state = state;
    this.ordinal = ++state.created;
  }
  private send(message: SnapshotWorkerResponse) {
    if (!this.stopped)
      this.onmessage?.({
        data: structuredClone(message),
      } as MessageEvent<SnapshotWorkerResponse>);
  }
  postMessage(original: SnapshotWorkerRequest, transfers: Transferable[] = []) {
    const message = structuredClone(original, {transfer: transfers});
    if (message.kind === 'initialize') {
      setTimeout(
        () => this.send({kind: 'ready', nativeBytes: 128}),
        this.state.initializeDelay ?? 0,
      );
      return;
    }
    this.running = true;
    this.state.active++;
    this.state.maximumActive = Math.max(
      this.state.maximumActive,
      this.state.active,
    );
    this.state.started.push(message.id);
    let index = 0;
    const next = () => {
      if (this.stopped) return;
      if (Atomics.load(message.cancellation, 0)) {
        this.finish();
        this.send({
          kind: 'error',
          id: message.id,
          message: 'Cancelled',
          nativeBytes: 128,
        });
        return;
      }
      if (
        index === 1 &&
        ((this.ordinal === 1 && this.state.fault) ||
          this.state.fault === 'always')
      ) {
        if (this.state.fault !== 'stall-once')
          this.onerror?.({
            message: 'Native worker crashed',
            preventDefault() {},
          } as ErrorEvent);
        return;
      }
      const query = message.queries[index++];
      if (!query) {
        this.finish();
        this.send({
          kind: 'done',
          id: message.id,
          milliseconds: 12,
          nativeBytes: 128,
        });
        return;
      }
      this.send({
        kind: 'result',
        id: message.id,
        key: query.key.id,
        value: [
          [message.bytes[0], 0, 0],
          [1, 1, 1],
        ],
        milliseconds: 3,
        nativeBytes: 1024,
      });
      this.state.completed?.();
      setTimeout(next, this.state.queryDelay ?? 5);
    };
    setTimeout(next, this.state.queryDelay ?? 5);
  }
  private finish() {
    if (this.running) {
      this.running = false;
      this.state.active--;
    }
  }
  terminate() {
    this.stopped = true;
    this.finish();
  }
}

function fixture(fault?: Simulation['fault'], maximumBytes = 2 * 1024 ** 3) {
  const state: Simulation = {
    created: 0,
    active: 0,
    maximumActive: 0,
    started: [],
    fault,
  };
  let external = 0;
  const tooling = {
    setKernelExternalBytes(bytes: number) {
      external = bytes;
    },
    kernelOperationCacheStats: () => ({
      nativeAllocatedBytes: 32,
      estimatedJavaScriptBytes: 64,
      externalBytes: external,
      maximumBytes,
    }),
  } as unknown as typeof CoreTooling;
  const workers: ComputeWorker[] = [];
  const pool = new SnapshotWorkerPool(
    tooling,
    {
      url: 'fixture',
      wasm: new Uint8Array(4),
      sketchWasm: new Uint8Array(4),
      resources: [],
    },
    {
      concurrency: 2,
      cancellationGraceMs: 30,
      createWorker: () => {
        const worker = new ComputeWorker(state);
        workers.push(worker);
        return worker as unknown as Worker;
      },
    },
  );
  const values = new Map<string, SnapshotQueryResult>();
  const source = new Uint8Array([17]);
  const batches: SnapshotQueryBatch[] = [1, 2, 3, 4].map(id => ({
    id: String(id),
    weight: id * 10,
    queries: Array.from({length: 8}, (_, n) => ({
      kind: 'bounds',
      key: {id: `${id}:${n}`, signature: `${id}:${n}`},
      transform: {position: [0, 0, 0], quaternion: [0, 0, 0, 1]},
      selection: {kind: 'solid'},
      scale: 1,
    })),
    encode: () => source.slice(),
    accept(query, value) {
      assert.ok(
        !values.has(query.key.id),
        'completed work must not be replayed',
      );
      values.set(query.key.id, value);
    },
  }));
  const remaining = () =>
    batches
      .map(batch => ({
        ...batch,
        queries: batch.queries.filter(query => !values.has(query.key.id)),
      }))
      .filter(batch => batch.queries.length);
  return {
    pool,
    workers,
    state,
    values,
    source,
    batches,
    remaining,
    external: () => external,
  };
}

test('dispatches costly geometry first, streams independent results and shares one memory account', async () => {
  const f = fixture();
  try {
    await f.pool.compute(f.batches, () => {});
    assert.deepEqual(f.state.started.slice(0, 2), ['4', '3']);
    assert.equal(f.state.maximumActive, 2);
    assert.equal(f.values.size, 32);
    assert.deepEqual(f.source, new Uint8Array([17]));
    assert.equal(f.pool.stats.retries, 0);
    assert.ok(f.pool.stats.peakAccountedBytes > 1024);
  } finally {
    f.pool.dispose();
  }
  assert.equal(f.state.active, 0);
  assert.equal(f.external(), 0);
});

test('a worker crash replaces its owner and retries only unfinished queries', async () => {
  const f = fixture('crash-once');
  try {
    await f.pool.compute(f.batches, () => {});
    assert.equal(f.pool.stats.retries, 1);
    assert.equal(f.values.size, 32);
    assert.equal(f.state.created, 3);
  } finally {
    f.pool.dispose();
  }
});

test('worker startup and queries can exceed two minutes without restarting or losing results', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture();
  f.state.initializeDelay = 125_000;
  f.state.queryDelay = 125_000;
  let settled = false;
  const pending = f.pool
    .compute(f.batches, () => {})
    .finally(() => {
      settled = true;
    });
  try {
    await nextTurn();
    t.mock.timers.tick(121_000);
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(f.state.created, 2);
    assert.equal(f.pool.stats.retries, 0);
    t.mock.timers.tick(4000);
    await nextTurn();
    assert.equal(f.state.active, 2);
    for (let i = 0; i < 20 && !settled; i++) {
      t.mock.timers.tick(125_000);
      await nextTurn();
    }
    assert.equal(settled, true);
    await pending;
    assert.equal(f.values.size, 32);
    assert.equal(f.state.created, 2);
    assert.equal(f.pool.stats.retries, 0);
  } finally {
    f.pool.dispose();
    await pending.catch(() => {});
  }
});

test('cancellation keeps completed work, settles all owners, and the next run finishes the suffix', async () => {
  const f = fixture();
  let cancelled = false;
  f.state.completed = () => {
    if (f.values.size >= 4) cancelled = true;
  };
  try {
    await assert.rejects(
      f.pool.compute(f.batches, () => {
        if (cancelled) throw new Error('Superseded');
      }),
      /Superseded/,
    );
    assert.ok(f.values.size >= 4 && f.values.size < 32);
    assert.equal(f.state.active, 0);
    cancelled = false;
    f.state.completed = undefined;
    await f.pool.compute(f.remaining(), () => {});
    assert.equal(f.values.size, 32);
  } finally {
    f.pool.dispose();
  }
});

test('repeated worker failures settle the compile without leaving a pending cache owner', async () => {
  const f = fixture('always');
  try {
    await assert.rejects(
      f.pool.compute(f.batches, () => {}),
      /crashed|Cancelled/,
    );
    assert.equal(f.state.active, 0);
    assert.ok(f.values.size > 0);
  } finally {
    f.pool.dispose();
  }
});

test('global pressure reduces batch admission while the protected working set can still finish', async () => {
  const f = fixture(undefined, 1);
  try {
    await f.pool.compute(f.batches, () => {});
    assert.equal(f.state.maximumActive, 1);
    assert.equal(f.values.size, 32);
  } finally {
    f.pool.dispose();
  }
});

test('unresponsive cancellation ends within its grace period and preserves completed results', async () => {
  const f = fixture('stall-once');
  let cancelled = false;
  f.state.completed = () => {
    cancelled = true;
  };
  const started = performance.now();
  try {
    await assert.rejects(
      f.pool.compute(f.batches, () => {
        if (cancelled) throw new Error('Superseded');
      }),
      /Superseded/,
    );
    assert.ok(performance.now() - started < 500);
    assert.ok(f.values.size > 0 && f.values.size < 32);
    assert.equal(f.state.active, 0);
    assert.equal(f.pool.stats.retries, 0);
  } finally {
    f.pool.dispose();
  }
});

test('disposing during worker startup settles compilation and releases auxiliary memory', async () => {
  const f = fixture();
  const pending = f.pool.compute(f.batches, () => {});
  f.pool.dispose();
  await assert.rejects(pending, /disposed/);
  assert.equal(f.state.active, 0);
  assert.equal(f.external(), 0);
});

test('an idle worker crash is released before the next revision is dispatched', async () => {
  const f = fixture();
  try {
    await f.pool.compute(f.batches, () => {});
    f.workers[0].onerror?.({
      message: 'Idle worker crashed',
      preventDefault() {},
    } as ErrorEvent);
    const next = f.batches.map(batch => ({
      ...batch,
      id: batch.id + '-next',
      queries: batch.queries.map(query => ({
        ...query,
        key: {
          id: query.key.id + '-next',
          signature: query.key.signature + '-next',
        },
      })),
    }));
    await f.pool.compute(next, () => {});
    assert.equal(f.state.created, 3);
    assert.equal(f.pool.stats.retries, 0);
    assert.equal(f.values.size, 64);
  } finally {
    f.pool.dispose();
  }
});
