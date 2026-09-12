import {
  artifactOperationBytes,
  packArtifactValues,
  type ArtifactOperation,
} from './artifact-store-protocol';
import {
  withPersistentArtifacts,
  type PersistentArtifactStats,
  type PersistentArtifactStore,
} from './persistent-artifacts';

type Mutation = {
  namespace: string;
  operation: ArtifactOperation;
  complete(): void;
};
type Result = Uint8Array | boolean | undefined;

/** One I/O owner retains accepted writes independently of compilation lifetimes. */
export class ArtifactStoreServer {
  maximumBytes = 2 * 1024 ** 3;
  private readonly queue = new Set<Mutation>();
  private readonly pending = new Map<string, Map<string, Mutation>>();
  private writing?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private disk?: PersistentArtifactStats;
  private errors = 0;
  private pendingBytes = 0;
  private pendingOperations = 0;
  private batches = 0;
  private writeTransactionMilliseconds = 0;

  constructor(private readonly transaction = withPersistentArtifacts) {}

  enqueue(
    namespace: string,
    operation: ArtifactOperation,
    complete: () => void,
  ): void {
    const mutation = {namespace, operation, complete};
    this.queue.add(mutation);
    this.pendingBytes += artifactOperationBytes(operation);
    this.pendingOperations++;
    if (
      operation.kind === 'set' ||
      operation.kind === 'delete' ||
      operation.kind === 'publish'
    ) {
      let entries = this.pending.get(namespace);
      if (!entries) this.pending.set(namespace, (entries = new Map()));
      entries.set(operation.id, mutation);
    }
    this.schedule(operation.kind === 'flush' ? 0 : 16);
  }

  get stats() {
    return {
      disk: this.disk,
      pendingBytes: this.pendingBytes,
      pendingOperations: this.pendingOperations,
      errors: this.errors,
      batches: this.batches,
      writeTransactionMilliseconds: this.writeTransactionMilliseconds,
    };
  }

  async request(
    namespace: string,
    operation: ArtifactOperation,
    signal?: AbortSignal,
  ): Promise<Result> {
    signal?.throwIfAborted();
    if (operation.kind === 'stats')
      return new TextEncoder().encode(JSON.stringify(this.stats));
    if (operation.kind === 'drain' || operation.kind === 'clear') {
      await waitForRead(this.drain(), signal);
      if (operation.kind === 'drain') return true;
      return this.transaction(
        async scope => {
          const store = scope(namespace);
          if (!store) return;
          store.clear();
          return true;
        },
        stats => {
          this.disk = stats;
        },
        {touchReads: false, signal, maximumBytes: this.maximumBytes},
      );
    }
    if (
      operation.kind !== 'get' &&
      operation.kind !== 'get-many' &&
      operation.kind !== 'touch' &&
      operation.kind !== 'touch-many'
    )
      throw new Error('Expected an artifact read request.');
    const ids = 'ids' in operation ? operation.ids : [operation.id];
    // Publication must validate persisted references and the cross-tab timestamp.
    // It cannot be exposed as an unconditional pending set.
    if (
      ids.some(
        id =>
          this.pending.get(namespace)?.get(id)?.operation.kind === 'publish',
      )
    )
      await waitForRead(this.drain(), signal);
    const touching =
      operation.kind === 'touch' || operation.kind === 'touch-many';
    const overlay = ids.map(id => this.pending.get(namespace)?.get(id));
    const read = (store?: PersistentArtifactStore) => {
      signal?.throwIfAborted();
      return ids.map((id, index) => {
        const pending = overlay[index]?.operation;
        if (pending?.kind === 'delete') return undefined;
        if (pending?.kind === 'set') return touching ? true : pending.bytes;
        return touching ? store?.has(id) : store?.get(id);
      });
    };
    const values = overlay.every(Boolean)
      ? read()
      : await this.transaction(
          async scope => read(scope(namespace)),
          stats => {
            this.disk = stats;
          },
          {touchReads: false, signal, maximumBytes: this.maximumBytes},
        );
    if (touching) {
      const present = values.map(Boolean);
      const touched = ids.filter((_, index) => present[index]);
      if (touched.length)
        this.enqueue(namespace, {kind: 'touch-many', ids: touched}, () => {});
      return operation.kind === 'touch'
        ? present[0]
        : Uint8Array.from(present, Number);
    }
    return operation.kind === 'get'
      ? (values[0] as Uint8Array | undefined)
      : packArtifactValues(values as (Uint8Array | undefined)[]);
  }

  /** Explicit durability boundary for shutdown and administrative operations. */
  async drain(): Promise<void> {
    while (this.queue.size || this.writing) {
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = undefined;
      await this.writeBatch();
    }
  }

  private schedule(delay: number): void {
    if (this.timer !== undefined || this.writing) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.writeBatch();
    }, delay);
  }

  private writeBatch(): Promise<void> {
    if (this.writing) return this.writing;
    if (!this.queue.size) return Promise.resolve();
    this.writing = this.write().finally(() => {
      this.writing = undefined;
      if (this.queue.size) this.schedule(0);
    });
    return this.writing;
  }

  private async write(): Promise<void> {
    const completed: Mutation[] = [];
    const started = performance.now();
    try {
      await this.transaction(
        async scope => {
          const start = performance.now();
          // Bound transaction work, never the admitted queue or the current model.
          while (
            this.queue.size &&
            completed.length < 128 &&
            (completed.length === 0 || performance.now() - start < 8)
          ) {
            const mutation = this.queue.values().next().value!;
            this.queue.delete(mutation);
            completed.push(mutation);
            const store = scope(mutation.namespace);
            if (store) this.apply(store, mutation.operation);
          }
        },
        stats => {
          this.disk = stats;
          this.errors += stats?.errors ?? 0;
        },
        {touchReads: false, maximumBytes: this.maximumBytes},
      );
    } catch {
      this.errors++;
      // If opening the transaction itself failed, release this batch as well.
      // Retained model values can refill missing records on a later evaluation.
      if (!completed.length) {
        for (const mutation of this.queue) {
          this.queue.delete(mutation);
          completed.push(mutation);
          if (completed.length === 128) break;
        }
      }
    } finally {
      this.batches++;
      this.writeTransactionMilliseconds += performance.now() - started;
      for (const mutation of completed) {
        const {namespace, operation} = mutation;
        if ('id' in operation) {
          const entries = this.pending.get(namespace);
          if (entries?.get(operation.id) === mutation)
            entries.delete(operation.id);
          if (!entries?.size) this.pending.delete(namespace);
        }
        this.pendingBytes -= artifactOperationBytes(operation);
        this.pendingOperations--;
        mutation.complete();
      }
    }
  }

  private apply(
    store: PersistentArtifactStore,
    operation: ArtifactOperation,
  ): void {
    switch (operation.kind) {
      case 'set':
        store.set(operation.id, operation.bytes);
        break;
      case 'delete':
        store.delete(operation.id);
        break;
      case 'touch-many':
        store.touchMany(operation.ids);
        break;
      case 'flush':
        break; // The transaction flushes once when the whole batch is done.
      case 'publish': {
        const previous = store.get(operation.id);
        if (
          previous &&
          JSON.parse(new TextDecoder().decode(previous)).stamp > operation.stamp
        )
          return;
        if (!operation.required.every(id => store.has(id))) return;
        store.touchMany(operation.required);
        store.set(operation.id, operation.bytes);
        break;
      }
      default:
        throw new Error('Expected an artifact mutation.');
    }
  }
}

// Cancellation releases the reader while accepted mutations continue draining.
function waitForRead<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) abort();
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
