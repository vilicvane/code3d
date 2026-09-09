import type {OpenCascadeInstance} from '@code3d/opencascade';
import {getOC} from 'replicad';
import {estimateRetainedBytes} from './retained-memory.js';
import {
  decodeKernelArtifact,
  encodeKernelArtifact,
} from './kernel-artifact-codec.js';

/** The host opens storage before synchronous evaluation and owns its lifetime. */
export interface KernelArtifactStore {
  get(id: string): Uint8Array | undefined;
  set(id: string, bytes: Uint8Array): void;
  touch(id: string): boolean;
  delete(id: string): void;
  flush(): void;
}

export type KernelKeyPart =
  string | number | boolean | null | readonly KernelKeyPart[];

export type KernelArtifact<Value> = Readonly<{
  id: string;
  value: Value;
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

export function createKernelOperationCache({
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
  let persistenceErrors = 0;
  const persisted = new Set<string>();

  function setKernelArtifactStore(next: KernelArtifactStore | undefined): void {
    store = next;
    persisted.clear();
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
      for (const id of retainedEvaluation) {
        if (!used.has(id)) historicalEntries.set(id, entries.get(id)!);
      }
      retainedEvaluation = used;
      currentEvaluation = undefined;
      evictHistoricalEntries();
      accessStore(store => store.flush());
    };
  }

  /**
   * Reuses one complete, deterministic kernel operation. Arguments describe
   * scalar semantics; inputs carry the content identities of prior operations.
   * The lifecycle keeps the retained value independent from each disposable use.
   */
  function evaluateKernelOperation<Value>(
    operation: string,
    arguments_: readonly KernelKeyPart[],
    inputs: readonly KernelArtifact<unknown>[],
    lifecycle: KernelValueLifecycle<Value>,
    compute: () => Value,
  ): KernelArtifact<Value> {
    // Interrupt only between complete operations. A result computed while a
    // cancellation arrives is still retained before the next check can throw.
    currentEvaluation?.checkCancelled?.();
    const signature = JSON.stringify([
      operation,
      arguments_,
      inputs.map(input => input.id),
    ]);
    const id = contentId(signature);
    let cached = entries.get(id) as CacheEntry<Value> | undefined;
    if (!cached) {
      const bytes = accessStore(store => store.get(id));
      if (bytes) {
        let restored: Value;
        try {
          restored = decodeKernelArtifact<Value>(bytes, signature);
        } catch {
          persistenceErrors += 1;
          accessStore(store => store.delete(id));
          return computeAndRetain();
        }
        cached = retainEntry(restored);
        persistentHits += 1;
        persisted.add(id);
      }
    }
    if (cached) {
      if (cached.signature !== signature) {
        throw new Error(`Kernel operation cache identity collision: ${id}`);
      }
      hits += 1;
      const value = cached.instantiate(cached.value);
      persist(cached.value);
      touchEntry(id, cached as CacheEntry<unknown>);
      return {id, value};
    }

    return computeAndRetain();

    function computeAndRetain(): KernelArtifact<Value> {
      misses += 1;
      const value = compute();
      let retained: Value;
      try {
        retained = lifecycle.retain(value);
      } catch (error) {
        lifecycle.release(value);
        throw error;
      }
      const entry = retainEntry(retained);
      persist(retained);
      touchEntry(id, entry as CacheEntry<unknown>);
      return {id, value};
    }

    function persist(value: Value): void {
      if (!store || persisted.has(id)) return;
      accessStore(store => {
        if (!store.touch(id)) {
          store.set(id, encodeKernelArtifact(signature, value));
          persistentWrites += 1;
        }
        persisted.add(id);
      });
    }

    function retainEntry(retained: Value): CacheEntry<Value> {
      const entry: CacheEntry<Value> = {
        estimatedBytes:
          256 +
          estimateRetainedBytes(signature) +
          lifecycle.estimateBytes(retained),
        signature,
        value: retained,
        instantiate: lifecycle.instantiate,
        release: lifecycle.release,
      };
      entries.set(id, entry as CacheEntry<unknown>);
      estimatedJavaScriptBytes += entry.estimatedBytes;
      return entry;
    }
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

  function contentId(value: string): string {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    let third = 0x85ebca6b;
    let fourth = 0xc2b2ae35;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x27d4eb2d);
      third = Math.imul(third ^ code, 0x165667b1);
      fourth = Math.imul(fourth ^ code, 0x85ebca77);
    }
    return [first, second, third, fourth]
      .map(part => (part >>> 0).toString(16).padStart(8, '0'))
      .join('');
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
    persistenceErrors = 0;
    persisted.clear();
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
      persistentHits,
      persistentWrites,
      persistenceErrors,
    };
  }

  function evictHistoricalEntries(): void {
    while (
      historicalEntries.size &&
      nativeAllocatedBytes() + estimatedJavaScriptBytes > maximumBytes
    ) {
      const [id, entry] = historicalEntries.entries().next().value!;
      historicalEntries.delete(id);
      entries.delete(id);
      estimatedJavaScriptBytes -= entry.estimatedBytes;
      entry.release(entry.value);
    }
  }

  return {
    beginKernelOperationEvaluation,
    evaluateKernelOperation,
    clearKernelOperationCache,
    kernelOperationCacheStats,
    setKernelArtifactStore,
  };
}

export const {
  beginKernelOperationEvaluation,
  evaluateKernelOperation,
  clearKernelOperationCache,
  kernelOperationCacheStats,
  setKernelArtifactStore,
} = createKernelOperationCache({
  nativeAllocatedBytes: () =>
    (getOC() as OpenCascadeInstance).Code3dMemory.AllocatedBytes(),
});
