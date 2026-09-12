import {
  decodeKernelArtifact,
  encodeKernelArtifact,
} from './kernel-artifact-codec.js';
import {estimateRetainedBytes} from './retained-memory.js';

/** The host opens storage before synchronous evaluation and owns its lifetime. */
export interface KernelArtifactStore {
  /** Encoded writes retained by the host for the current working version. */
  readonly pendingWriteBytes?: number;
  get(id: string): Uint8Array | undefined;
  getMany(ids: readonly string[]): readonly (Uint8Array | undefined)[];
  set(id: string, bytes: Uint8Array): void;
  touch(id: string): boolean;
  /** Update access order together, returning existence in the same order. */
  touchMany(ids: readonly string[]): readonly boolean[];
  delete(id: string): void;
  /** Schedule persistence; hosts may complete disk I/O in the background. */
  flush(): void;
}

export type KernelKeyPart =
  string | number | boolean | null | readonly KernelKeyPart[];

export type KernelArtifact<Value> = Readonly<{
  id: string;
  value: Value;
}>;

export type CacheCodec<Value> = Readonly<{
  encoder(value: Value): Uint8Array;
  decoder(bytes: Uint8Array): Value;
}>;

export type KernelValueLifecycle<Value> = Readonly<{
  estimateBytes(value: Value): number;
  retain(value: Value): Value;
  instantiate(retained: Value): Value;
  release(value: Value): void;
}>;

type CacheEntry<Value> = Readonly<{
  estimatedBytes: number;
  signature: string;
  value: Value;
  instantiate(retained: Value): Value;
  release(value: Value): void;
}>;

export function createComputationCache({
  maximumBytes = 2 * 1024 ** 3,
  nativeAllocatedBytes,
}: {
  maximumBytes?: number;
  nativeAllocatedBytes: () => number;
}) {
  const entries = new Map<string, CacheEntry<unknown>>();
  const historicalEntries = new Map<string, CacheEntry<unknown>>();
  let retainedEvaluation = new Set<string>();
  let currentEvaluation:
    {used: Set<string>; checkCancelled?: () => void} | undefined;
  let hits = 0;
  let misses = 0;
  let estimatedJavaScriptBytes = 0;
  let store: KernelArtifactStore | undefined;
  let persistentHits = 0;
  let persistentWrites = 0;
  let persistenceEncodeMilliseconds = 0;
  let persistenceErrors = 0;
  const persisted = new Set<string>();
  const pendingPersistence = new Map<string, () => Uint8Array>();
  let externalBytes = 0;

  /** Adjust historical retention without invalidating the current model. */
  function setKernelCacheBudget(bytes: number): void {
    maximumBytes = bytes;
    evictHistoricalEntries();
  }

  /** The host accounts for in-flight inputs and all auxiliary native heaps. */
  function setKernelExternalBytes(bytes: number): void {
    externalBytes = bytes;
    evictHistoricalEntries();
  }

  function setKernelArtifactStore(next: KernelArtifactStore | undefined): void {
    store = next;
    persisted.clear();
    pendingPersistence.clear();
  }

  function accessStore<Result>(
    action: (store: KernelArtifactStore) => Result,
  ): Result | undefined {
    if (!store) return undefined;
    try {
      return action(store);
    } catch {
      // Cache storage is optional. Its failures must not change model execution.
      persistenceErrors += 1;
      store = undefined;
      return undefined;
    }
  }

  /**
   * Keep a serial evaluation's complete working set, including snapshot queries.
   * The previous working set stays available until this evaluation finishes so
   * a changed prefix cannot evict unchanged operations that execute later.
   * Outside evaluations, only the bounded historical LRU admits new entries.
   */
  function beginKernelOperationEvaluation(
    checkCancelled?: () => void,
  ): () => void {
    const used = new Set<string>();
    currentEvaluation = {used, checkCancelled};
    return () => {
      flushPendingPersistence();
      for (const id of retainedEvaluation) {
        if (!used.has(id)) historicalEntries.set(id, entries.get(id)!);
      }
      retainedEvaluation = used;
      currentEvaluation = undefined;
      evictHistoricalEntries();
      accessStore(store => store.flush());
    };
  }

  function evaluateCachedArtifact<Value>(
    key: KernelOperationKey,
    lifecycle: KernelValueLifecycle<Value>,
    compute: () => Value,
    codec?: CacheCodec<Value> | false,
  ): KernelArtifact<Value> {
    const hit = findKernelOperation(key, lifecycle, codec);
    if (hit) return hit;
    const value = compute();
    acceptKernelOperation(key, lifecycle, value, codec);
    return {id: key.id, value};
  }

  function findKernelOperation<Value>(
    key: KernelOperationKey,
    lifecycle: KernelValueLifecycle<Value>,
    codec?: CacheCodec<Value> | false,
  ): KernelArtifact<Value> | undefined {
    return lookup(key, lifecycle, codec, () =>
      accessStore(store => store.get(key.id)),
    );
  }

  function findKernelOperations<Value>(
    keys: readonly KernelOperationKey[],
    lifecycle: KernelValueLifecycle<Value>,
    codec?: CacheCodec<Value> | false,
  ): readonly (KernelArtifact<Value> | undefined)[] {
    currentEvaluation?.checkCancelled?.();
    const missing =
      codec === false ? [] : keys.filter(key => !entries.has(key.id));
    const bytes = missing.length
      ? accessStore(store => store.getMany(missing.map(key => key.id)))
      : undefined;
    const restored = new Map(
      missing.map((key, index) => [key.id, bytes?.[index]]),
    );
    return keys.map(key =>
      lookup(key, lifecycle, codec, () => restored.get(key.id)),
    );
  }

  function lookup<Value>(
    key: KernelOperationKey,
    lifecycle: KernelValueLifecycle<Value>,
    codec: CacheCodec<Value> | false | undefined,
    read: () => Uint8Array | undefined,
  ): KernelArtifact<Value> | undefined {
    currentEvaluation?.checkCancelled?.();
    const {id, signature} = key;
    let cached = entries.get(id) as CacheEntry<Value> | undefined;
    if (!cached && codec !== false) {
      const bytes = read();
      if (bytes) {
        let restored: Value;
        try {
          restored = codec
            ? codec.decoder(decodeKernelArtifact<Uint8Array>(bytes, signature))
            : decodeKernelArtifact<Value>(bytes, signature);
        } catch {
          persistenceErrors += 1;
          accessStore(store => store.delete(id));
          misses += 1;
          return undefined;
        }
        cached = retainEntry(key, lifecycle, restored);
        persistentHits += 1;
        persisted.add(id);
      }
    }
    if (!cached) {
      misses += 1;
      return undefined;
    }
    if (cached.signature !== signature)
      throw new Error(`Kernel operation cache identity collision: ${id}`);
    hits += 1;
    const value = cached.instantiate(cached.value);
    if (codec !== false) persist(key, cached.value, codec, true);
    touchEntry(id, cached as CacheEntry<unknown>);
    return {id, value};
  }

  /** Accept completed work even when cancellation arrived during computation. */
  function acceptKernelOperation<Value>(
    key: KernelOperationKey,
    lifecycle: KernelValueLifecycle<Value>,
    value: Value,
    codec?: CacheCodec<Value> | false,
  ): void {
    const existing = entries.get(key.id);
    if (existing) {
      if (existing.signature !== key.signature)
        throw new Error(`Kernel operation cache identity collision: ${key.id}`);
      touchEntry(key.id, existing);
      return;
    }
    let retained: Value;
    try {
      retained = lifecycle.retain(value);
    } catch (error) {
      lifecycle.release(value);
      throw error;
    }
    const entry = retainEntry(key, lifecycle, retained);
    if (codec !== false) persist(key, retained, codec);
    touchEntry(key.id, entry as CacheEntry<unknown>);
  }

  function persist<Value>(
    key: KernelOperationKey,
    value: Value,
    codec?: CacheCodec<Value>,
    defer = false,
  ): void {
    if (!store || persisted.has(key.id)) return;
    const encode = () => {
      const started = performance.now();
      try {
        return encodeKernelArtifact(
          key.signature,
          codec ? Uint8Array.from(codec.encoder(value)) : value,
        );
      } finally {
        persistenceEncodeMilliseconds += performance.now() - started;
      }
    };
    if (defer && currentEvaluation) {
      pendingPersistence.set(key.id, encode);
      return;
    }
    accessStore(store => {
      // A completed computation follows a miss; write it without another lookup.
      if (!defer || !store.touch(key.id)) {
        store.set(key.id, encode());
        persistentWrites += 1;
      }
      persisted.add(key.id);
    });
  }

  /** Memory hits need one transaction, while newly computed work is saved immediately. */
  function flushPendingPersistence(): void {
    if (!pendingPersistence.size) return;
    accessStore(store => {
      const ids = [...pendingPersistence.keys()];
      const present = store.touchMany(ids);
      ids.forEach((id, index) => {
        if (!present[index]) {
          store.set(id, pendingPersistence.get(id)!());
          persistentWrites += 1;
        }
        persisted.add(id);
      });
    });
    pendingPersistence.clear();
  }

  function retainEntry<Value>(
    key: KernelOperationKey,
    lifecycle: KernelValueLifecycle<Value>,
    retained: Value,
  ): CacheEntry<Value> {
    const entry: CacheEntry<Value> = {
      estimatedBytes:
        256 +
        estimateRetainedBytes(key.signature) +
        lifecycle.estimateBytes(retained),
      signature: key.signature,
      value: retained,
      instantiate: lifecycle.instantiate,
      release: lifecycle.release,
    };
    entries.set(key.id, entry as CacheEntry<unknown>);
    estimatedJavaScriptBytes += entry.estimatedBytes;
    return entry;
  }

  function touchEntry(id: string, entry: CacheEntry<unknown>): void {
    historicalEntries.delete(id);
    if (currentEvaluation) {
      currentEvaluation.used.delete(id);
      currentEvaluation.used.add(id);
    } else if (!retainedEvaluation.has(id)) {
      historicalEntries.set(id, entry);
    }
    evictHistoricalEntries();
  }

  function clearKernelOperationCache(): void {
    for (const entry of entries.values()) {
      entry.release(entry.value);
    }
    entries.clear();
    historicalEntries.clear();
    retainedEvaluation.clear();
    currentEvaluation?.used.clear();
    hits = 0;
    misses = 0;
    estimatedJavaScriptBytes = 0;
    persistentHits = 0;
    persistentWrites = 0;
    persistenceEncodeMilliseconds = 0;
    persistenceErrors = 0;
    persisted.clear();
    pendingPersistence.clear();
  }

  function kernelOperationCacheStats() {
    return {
      entries: entries.size,
      hits,
      misses,
      historicalEntries: historicalEntries.size,
      estimatedJavaScriptBytes,
      nativeAllocatedBytes: nativeAllocatedBytes(),
      maximumBytes,
      externalBytes,
      pendingPersistenceBytes: store?.pendingWriteBytes ?? 0,
      persistentHits,
      persistentWrites,
      persistenceEncodeMilliseconds,
      persistenceErrors,
    };
  }

  function evictHistoricalEntries(): void {
    while (
      historicalEntries.size &&
      nativeAllocatedBytes() +
        estimatedJavaScriptBytes +
        externalBytes +
        (store?.pendingWriteBytes ?? 0) >
        maximumBytes
    ) {
      const [id, entry] = historicalEntries.entries().next().value!;
      historicalEntries.delete(id);
      entries.delete(id);
      estimatedJavaScriptBytes -= entry.estimatedBytes;
      entry.release(entry.value);
    }
  }

  return {
    evaluateCachedArtifact,
    beginKernelOperationEvaluation,
    clearKernelOperationCache,
    kernelOperationCacheStats,
    setKernelCacheBudget,
    setKernelArtifactStore,
    findKernelOperation,
    findKernelOperations,
    acceptKernelOperation,
    setKernelExternalBytes,
  };
}

let nativeMemoryCounter = () => 0;

/** The installed backend supplies native accounting; pure caches need no kernel. */
export function setKernelNativeMemoryCounter(read: () => number): void {
  nativeMemoryCounter = read;
}

export const {
  evaluateCachedArtifact,
  beginKernelOperationEvaluation,
  clearKernelOperationCache,
  kernelOperationCacheStats,
  setKernelCacheBudget,
  setKernelArtifactStore,
  findKernelOperation,
  findKernelOperations,
  acceptKernelOperation,
  setKernelExternalBytes,
} = createComputationCache({
  nativeAllocatedBytes: () => nativeMemoryCounter(),
});

export type KernelOperationKey = Readonly<{id: string; signature: string}>;

export function kernelOperationKey(
  operation: string,
  arguments_: readonly KernelKeyPart[],
  inputs: readonly Pick<KernelArtifact<unknown>, 'id'>[],
): KernelOperationKey {
  const signature = JSON.stringify([
    operation,
    arguments_,
    inputs.map(input => input.id),
  ]);
  return {id: kernelContentId(signature), signature};
}

export function kernelContentId(value: string | Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  let third = 0x85ebca6b;
  let fourth = 0xc2b2ae35;
  for (let index = 0; index < value.length; index += 1) {
    const code =
      typeof value === 'string' ? value.charCodeAt(index) : value[index];
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x27d4eb2d);
    third = Math.imul(third ^ code, 0x165667b1);
    fourth = Math.imul(fourth ^ code, 0x85ebca77);
  }
  return [first, second, third, fourth]
    .map(part => (part >>> 0).toString(16).padStart(8, '0'))
    .join('');
}
