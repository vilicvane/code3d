---
title: Kernel cache integration
description: Control shared cache budgets and persistence, inspect counters and implement a synchronous artifact store.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/kernel-cache.ts
      sha256: 779d4de9fa63c44633a16aac3c6e1125376dcc7483b0e6cf6d11d6970db87310
      commit: da2824c30b54a50ac216679fff96c67dd3dcee4c
sidebar:
  hidden: true
head:
  - tag: title
    content: Kernel cache integration — Code3D TypeScript API reference
---

Tooling hosts use these APIs to control shared cache budgets and persistence, inspect counters and implement a synchronous artifact store.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {kernelOperationCacheStats} from '@code3d/core/tooling';

const stats = kernelOperationCacheStats();
const retainedBytes =
  stats.estimatedJavaScriptBytes + stats.nativeAllocatedBytes;
const historicalEntries = stats.historicalEntries;
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## Host configuration

All functions configure the shared runtime cache; they do not create independent
caches per model. Apply changes between serial evaluations. Use finite,
nonnegative budgets and thresholds; these low-level setters trust the host and
do not perform the App form's validation.

- `setKernelCacheBudget(bytes)` sets the memory retention budget and evicts
  eligible historical entries. The current evaluation's working set remains
  protected, so this is not a hard process memory limit.
- `setKernelExternalBytes(bytes)` accounts for in-flight inputs and auxiliary
  native heaps owned by the host, then reevaluates historical retention.
- `setKernelCachePersistenceThreshold(milliseconds)` changes admission for future
  completed computations; default 1 ms, with 0 admitting all durations. Existing
  entries keep their admission decision. Encoding and transfer time are excluded.
- `setKernelArtifactStore(store | undefined)` installs or detaches storage and
  clears pending persistence bookkeeping; the host owns the store's lifetime.
- `clearKernelOperationCache()` releases retained cache entries and resets counters
  and pending bookkeeping. It does not erase the host's disk store or change the
  configured budget. Avoid using it as model-object disposal.

[Evaluation scopes](tooling-evaluation.md) retain the current working set, flush
pending writes and support cancellation. Completed computations can remain cached
after an evaluation fails. Author-level behavior is documented by [cache](cache.md).

## KernelArtifactStore

The host must open storage before synchronous evaluation. Every method is
synchronous from Core's perspective; the implementation may schedule actual disk
writes in the background. `flush()` schedules persistence rather than returning
a promise that proves durability.

| Member               | Contract                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `pendingWriteBytes?` | Bytes retained by queued writes for the current working version, used in memory accounting. |
| `get(id)`            | Encoded bytes or `undefined` on a miss.                                                     |
| `getMany(ids)`       | Same-length array of hits/misses in input order.                                            |
| `set(id, bytes)`     | Retain/schedule the encoded artifact under that ID.                                         |
| `touch(id)`          | Refresh access order and report whether the record exists.                                  |
| `touchMany(ids)`     | Refresh in a batch; booleans correspond to input order.                                     |
| `delete(id)`         | Remove an invalid or unwanted record.                                                       |
| `flush()`            | Schedule pending persistence at the evaluation boundary.                                    |

Artifact bytes include signatures; preserve them exactly. A bad decoded record
is deleted and recomputed. Store exceptions increment persistence errors and
detach the failing store so optional persistence does not break model evaluation.

## Statistics

`kernelOperationCacheStats()` returns a fresh numeric record. `entries` counts
all retained entries; `historicalEntries` are eligible for historical eviction.
`hits`, `misses`, `persistentHits` and `persistentWrites` describe activity since
the last clear. `estimatedJavaScriptBytes` estimates retained JavaScript data;
`nativeAllocatedBytes` comes from the installed kernel; `externalBytes` comes
from the host; `pendingPersistenceBytes` comes from the store. `maximumBytes` is
the configured memory budget. `persistenceEncodeMilliseconds` accumulates encode
time and `persistenceErrors` counts persistence failures. These are diagnostics,
not a promise that total process memory equals their sum.

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### clearKernelOperationCache

```ts
const clearKernelOperationCache: () => void;
```

### kernelOperationCacheStats

```ts
const kernelOperationCacheStats: () => {
  entries: number;
  hits: number;
  misses: number;
  historicalEntries: number;
  estimatedJavaScriptBytes: number;
  nativeAllocatedBytes: number;
  maximumBytes: number;
  externalBytes: number;
  pendingPersistenceBytes: number;
  persistentHits: number;
  persistentWrites: number;
  persistenceEncodeMilliseconds: number;
  persistenceErrors: number;
};
```

### setKernelCacheBudget

```ts
const setKernelCacheBudget: (bytes: number) => void;
```

### setKernelCachePersistenceThreshold

```ts
const setKernelCachePersistenceThreshold: (milliseconds: number) => void;
```

### setKernelArtifactStore

```ts
const setKernelArtifactStore: (next: KernelArtifactStore | undefined) => void;
```

### setKernelExternalBytes

```ts
const setKernelExternalBytes: (bytes: number) => void;
```

### KernelArtifactStore

```ts
interface KernelArtifactStore {
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
```
