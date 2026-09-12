import type * as CoreTooling from '@code3d/core/tooling';
import type {SnapshotQuery, SnapshotQueryBatch} from '@code3d/core/tooling';
import {locateModelError} from './diagnostic';
import type {
  SnapshotWorkerRequest,
  SnapshotWorkerResponse,
} from './snapshot-protocol';

export type SnapshotPoolOptions = {
  concurrency?: number;
  createWorker?: () => Worker;
  cancellationGraceMs?: number;
};
export type SnapshotPoolStats = {
  workers: number;
  batches: number;
  queries: number;
  completed: number;
  retries: number;
  transferredBytes: number;
  encodeMs: number;
  computeMs: number;
  restoreMs: number;
  initializeMs: number;
  dispatchMs: number;
  queuedMs: number;
  elapsedMs: number;
  peakAccountedBytes: number;
};

type Slot = {
  worker: Worker;
  ready: Promise<void>;
  nativeBytes: number;
  inputBytes: number;
  reject(error: Error): void;
  receive?: (message: SnapshotWorkerResponse) => void;
};

/** One cache owner; auxiliary runtimes retain only their currently executing batch. */
export class SnapshotWorkerPool {
  private readonly slots: Slot[] = [];
  private readonly costs = new Map<string, number>();
  private concurrency: number;
  private disposed = false;
  private queuedBytes = 0;
  private localInputBytes = 0;
  private activeCancellation?: Int32Array<SharedArrayBuffer>;
  private latest: SnapshotPoolStats = this.emptyStats();

  constructor(
    private readonly tooling: typeof CoreTooling,
    private readonly runtime: {
      url: string;
      wasm: Uint8Array;
      sketchWasm: Uint8Array;
      resources: readonly (readonly [string, string])[];
    },
    private readonly options: SnapshotPoolOptions = {},
  ) {
    this.concurrency =
      options.concurrency ??
      (typeof Worker === 'undefined'
        ? 1
        : Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)));
  }

  /** Called between executions; retire surplus native runtimes when lowering the limit. */
  setConcurrency(concurrency: number): void {
    this.concurrency = concurrency;
    for (let index = this.slots.length - 1; index >= concurrency; index--)
      this.dropSlot(index, new Error('Geometry concurrency changed.'));
    this.slots.length = Math.min(this.slots.length, concurrency);
  }

  get stats(): SnapshotPoolStats {
    return {...this.latest};
  }

  private emptyStats(): SnapshotPoolStats {
    return {
      workers: 0,
      batches: 0,
      queries: 0,
      completed: 0,
      retries: 0,
      transferredBytes: 0,
      encodeMs: 0,
      computeMs: 0,
      restoreMs: 0,
      initializeMs: 0,
      dispatchMs: 0,
      queuedMs: 0,
      elapsedMs: 0,
      peakAccountedBytes: 0,
    };
  }

  async compute(
    batches: readonly SnapshotQueryBatch[],
    checkCancelled: () => void,
  ): Promise<void> {
    const start = performance.now();
    const stats = (this.latest = this.emptyStats());
    stats.batches = batches.length;
    stats.queries = batches.reduce(
      (count, batch) => count + batch.queries.length,
      0,
    );
    this.queuedBytes = batches.reduce(
      (bytes, batch) =>
        bytes +
        JSON.stringify(batch.queries).length * 2 +
        batch.queries.length * 128,
      0,
    );
    this.accountMemory();
    if (!batches.length) return;
    const measured = batches.filter(batch => this.costs.has(batch.id));
    const costPerWeight = measured.length
      ? measured.reduce((sum, batch) => sum + this.costs.get(batch.id)!, 0) /
        measured.reduce((sum, batch) => sum + batch.weight, 0)
      : 1;
    const queue = [...batches].sort(
      (a, b) =>
        (this.costs.get(b.id) ?? b.weight * costPerWeight) -
        (this.costs.get(a.id) ?? a.weight * costPerWeight),
    );
    const cancellation = new Int32Array(new SharedArrayBuffer(4));
    this.activeCancellation = cancellation;
    let failure: unknown;
    let cancelledAt: number | undefined;
    let activeBatches = 0;
    const memoryWaiters = new Set<() => void>();
    const wake = () => {
      for (const resolve of memoryWaiters) resolve();
      memoryWaiters.clear();
    };
    const underPressure = () => {
      const cache = this.tooling.kernelOperationCacheStats();
      return (
        cache.nativeAllocatedBytes +
          cache.estimatedJavaScriptBytes +
          cache.externalBytes >=
        cache.maximumBytes
      );
    };
    const timer = setInterval(() => {
      try {
        checkCancelled();
      } catch (error) {
        failure ??= error;
        wake();
        Atomics.store(cancellation, 0, 1);
        cancelledAt ??= performance.now();
        if (
          performance.now() - cancelledAt >=
          (this.options.cancellationGraceMs ?? 2000)
        )
          this.stopWorkers(new Error('Snapshot computation cancelled.'));
      }
    }, 25);
    try {
      checkCancelled();
      if (this.concurrency <= 1 || batches.length === 1) {
        for (const batch of queue) {
          checkCancelled();
          const before = performance.now();
          const bytes = batch.encode();
          stats.encodeMs += performance.now() - before;
          this.localInputBytes = bytes.byteLength;
          this.accountMemory();
          let previous = performance.now();
          this.tooling.executeSnapshotQueryBatch(
            batch.id,
            bytes,
            batch.queries,
            checkCancelled,
            (query, value) => {
              const now = performance.now();
              stats.computeMs += now - previous;
              batch.accept(query, value);
              stats.completed++;
              previous = performance.now();
              this.accountMemory();
            },
            milliseconds => {
              stats.restoreMs += milliseconds;
              previous = performance.now();
              this.accountMemory();
            },
          );
          this.localInputBytes = 0;
        }
      } else {
        const count = Math.min(this.concurrency, batches.length);
        stats.workers = count;
        const remaining = new Map(
          queue.map(batch => [
            batch.id,
            new Map(batch.queries.map(query => [query.key.id, query])),
          ]),
        );
        let index = 0;
        const run = async (position: number) => {
          while (index < queue.length && !failure) {
            while (activeBatches && underPressure() && !failure)
              await new Promise<void>(resolve => memoryWaiters.add(resolve));
            if (failure || index >= queue.length) break;
            const batch = queue[index++];
            stats.queuedMs += performance.now() - start;
            activeBatches++;
            try {
              const pending = remaining.get(batch.id)!;
              for (let attempt = 0; attempt < 2 && pending.size; attempt++) {
                try {
                  checkCancelled();
                  const slot =
                    this.slots[position] ?? this.createSlot(position);
                  await slot.ready;
                  checkCancelled();
                  await this.runBatch(
                    slot,
                    batch,
                    pending,
                    cancellation,
                    stats,
                  );
                } catch (error) {
                  this.dropSlot(
                    position,
                    error instanceof Error ? error : new Error(String(error)),
                  );
                  try {
                    checkCancelled();
                  } catch (cancelled) {
                    throw cancelled;
                  }
                  if (failure || this.disposed || attempt === 1) throw error;
                  stats.retries++;
                }
              }
            } finally {
              activeBatches--;
              wake();
            }
          }
        };
        const outcomes = await Promise.allSettled(
          Array.from({length: count}, (_, index) =>
            run(index).catch(error => {
              failure ??= error;
              wake();
              Atomics.store(cancellation, 0, 1);
              throw error;
            }),
          ),
        );
        for (const outcome of outcomes)
          if (outcome.status === 'rejected') failure ??= outcome.reason;
      }
      if (failure) throw failure;
      checkCancelled();
    } finally {
      clearInterval(timer);
      this.activeCancellation = undefined;
      this.queuedBytes = 0;
      this.localInputBytes = 0;
      this.accountMemory();
      stats.elapsedMs = performance.now() - start;
    }
  }

  private createSlot(position: number): Slot {
    const started = performance.now();
    const worker =
      this.options.createWorker?.() ??
      new Worker(new URL('./snapshot.worker.ts', import.meta.url), {
        type: 'module',
      });
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const slot: Slot = {
      worker,
      ready,
      nativeBytes: 0,
      inputBytes:
        this.runtime.wasm.byteLength + this.runtime.sketchWasm.byteLength,
      reject: rejectReady,
    };
    this.slots[position] = slot;
    worker.onmessage = ({data}: MessageEvent<SnapshotWorkerResponse>) => {
      slot.nativeBytes = data.nativeBytes;
      if (data.kind === 'ready') {
        slot.inputBytes = 0;
        this.latest.initializeMs += performance.now() - started;
        resolveReady();
      } else if (data.kind === 'error' && !data.id)
        rejectReady(new Error(data.message));
      else slot.receive?.(data);
      this.accountMemory();
    };
    worker.onerror = event => {
      event.preventDefault();
      this.dropSlot(
        position,
        new Error(event.message || 'Snapshot worker crashed.'),
      );
    };
    worker.onmessageerror = () =>
      this.dropSlot(
        position,
        new Error('Snapshot worker message could not be decoded.'),
      );
    this.post(worker, {kind: 'initialize', ...this.runtime});
    this.accountMemory();
    return slot;
  }

  private runBatch(
    slot: Slot,
    batch: SnapshotQueryBatch,
    pending: Map<string, SnapshotQuery>,
    cancellation: Int32Array<SharedArrayBuffer>,
    stats: SnapshotPoolStats,
  ): Promise<void> {
    const before = performance.now();
    const bytes = batch.encode();
    stats.encodeMs += performance.now() - before;
    stats.transferredBytes += bytes.byteLength;
    slot.inputBytes = bytes.byteLength;
    this.accountMemory();
    return new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        cleanup();
        reject(
          batch.sourceRef ? locateModelError(error, batch.sourceRef) : error,
        );
      };
      const cleanup = () => {
        slot.receive = undefined;
        slot.inputBytes = 0;
      };
      slot.reject = fail;
      slot.receive = message => {
        if (!('id' in message) || message.id !== batch.id) return;
        if (message.kind === 'loaded') {
          stats.restoreMs += message.restoreMs;
          stats.dispatchMs += performance.now() - before - message.restoreMs;
        } else if (message.kind === 'result') {
          const query = pending.get(message.key)!;
          try {
            batch.accept(query, message.value);
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          pending.delete(message.key);
          stats.completed++;
          stats.computeMs += message.milliseconds;
        } else if (message.kind === 'done') {
          this.costs.delete(batch.id);
          this.costs.set(batch.id, message.milliseconds);
          // Scheduling metadata is bounded independently of geometric history.
          if (this.costs.size > 4096)
            this.costs.delete(this.costs.keys().next().value!);
          cleanup();
          resolve();
        } else if (message.kind === 'error') fail(new Error(message.message));
      };
      this.post(
        slot.worker,
        {
          kind: 'compute',
          id: batch.id,
          bytes,
          queries: [...pending.values()],
          cancellation,
        },
        [bytes.buffer as ArrayBuffer],
      );
    });
  }

  private post(
    worker: Worker,
    message: SnapshotWorkerRequest,
    transfer: Transferable[] = [],
  ): void {
    worker.postMessage(message, transfer);
  }

  private accountMemory(): void {
    const external = this.slots.reduce(
      (bytes, slot) => bytes + (slot ? slot.nativeBytes + slot.inputBytes : 0),
      this.costs.size * 208 + this.queuedBytes + this.localInputBytes,
    );
    this.tooling.setKernelExternalBytes(external);
    const cache = this.tooling.kernelOperationCacheStats();
    this.latest.peakAccountedBytes = Math.max(
      this.latest.peakAccountedBytes,
      external + cache.nativeAllocatedBytes + cache.estimatedJavaScriptBytes,
    );
  }

  private dropSlot(position: number, error: Error): void {
    const slot = this.slots[position];
    if (!slot) return;
    delete this.slots[position];
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.onmessageerror = null;
    slot.worker.terminate();
    slot.reject(error);
    this.accountMemory();
  }

  private stopWorkers(error: Error): void {
    this.slots.forEach((_, index) => this.dropSlot(index, error));
    this.slots.length = 0;
  }

  dispose(): void {
    this.disposed = true;
    if (this.activeCancellation) Atomics.store(this.activeCancellation, 0, 1);
    this.stopWorkers(new Error('Snapshot worker pool disposed.'));
    this.costs.clear();
    this.queuedBytes = 0;
    this.localInputBytes = 0;
    this.tooling.setKernelExternalBytes(0);
  }
}
