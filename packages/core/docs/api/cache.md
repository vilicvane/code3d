---
title: cache
description: Memoize synchronous computations with typed arguments, optional result codecs and host-managed persistence.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/cached.ts
      sha256: 9b9806bfa153c119d8954636c6c9be114bae2e95073165742b50d8316f8e1a1d
      commit: 7871945765ce2e86ba7a6ed227b7cc8c3d8ba81f
    - path: packages/core/src/library/kernel-cache.ts
      sha256: 779d4de9fa63c44633a16aac3c6e1125376dcc7483b0e6cf6d11d6970db87310
      commit: da2824c30b54a50ac216679fff96c67dd3dcee4c
    - path: packages/core/src/library/kernel-artifact-codec.ts
      sha256: 65a0e0929d6e807e429900ed7e70db27b13f0a86dbf694b751dac332071e538a
      commit: 5058f1bbd8f9289ad89f0cf6cb19f7b5fa143eae
    - path: packages/app/src/project/cached-definitions.ts
      sha256: a0e691da653209fc513d934b75838823586592ccb8b901186725d2f299d474df
      commit: 7871945765ce2e86ba7a6ed227b7cc8c3d8ba81f
sidebar:
  hidden: true
head:
  - tag: title
    content: cache — Code3D TypeScript API reference
---

`cache` reuses deterministic computation results by function identity and encoded arguments. Use it for expensive ordinary data; custom geometry builders have their own ownership-aware cache.

## Example

```ts
import {cache} from '@code3d/core';

function buildProfile(radius: number, sides: number) {
  return Array.from({length: sides}, (_, index) => {
    const angle = (index * 2 * Math.PI) / sides;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}
const profile = cache(buildProfile);
const points = cache(buildProfile, [10, 6]);
```

## Signature

```ts
// Simplified overloads: Promise-like results are excluded.
cache<Args extends unknown[], Value>(
  compute: (...args: Args) => Value,
  args: Readonly<NoInfer<Args>>,
  options?: CacheOptions<NoInfer<Value>>,
): Value;
cache<Args extends unknown[], Value>(
  compute: (...args: Args) => Value,
  args?: undefined,
  options?: CacheOptions<NoInfer<Value>>,
): (...args: Args) => Value;

type CacheOptions<Value> = Readonly<{
  encoder(value: Value): Uint8Array;
  decoder(bytes: Uint8Array): Value;
}>;
```

Import the functions and named types from `@code3d/core`.

`cache(fn)` returns a memoized function; `cache(fn, args)` immediately returns
its result for the supplied argument tuple. Both forms preserve synchronous
parameter/result types and use the same definition and argument cache keys.
In the example, `profile(10, 6)` reuses the same cached result as `points`. An empty tuple `[]` immediately invokes
a computation with no arguments. The argument tuple is not part of the
compiler's function fingerprint: changing inputs selects another cache entry.

## Data and ownership

The API caches
ordinary data; use [`definePrimitive()`](../custom-primitives.mdx) for Replicad geometry so Core also owns
native resources and creates fresh model metadata. Treat cached results as
immutable. A memory hit returns the retained computed or decoded value directly,
without decoding, copying or freezing it.

The default persistent codec supports plain objects, arrays, scalar values
(including `undefined`, nonfinite numbers and bigint), Date, Map, Set, ArrayBuffer,
standard TypedArrays and DataView. Shared references, cycles, sparse arrays and
shared buffer views survive restoration. Arguments use the same data encoding;
changing dynamic state must be supplied as arguments. Functions, native handles
and application class instances are not ordinary data arguments.

## Custom result codecs

For custom result types, supply both functions as
`cache(fn, undefined, {encoder: value => bytes, decoder: bytes => value})`.
For immediate evaluation, use `cache(fn, args, options)` with the same codec options.
The encoder runs when saving to disk; the decoder runs once when restoring an
entry into memory. A subsequent memory hit never calls either codec. Async
computations are excluded: incomplete work is not admitted to the cache.

## Persistence and identity

New results are written to disk only when their computation reaches the configured
threshold, 1 ms by default. In the App, change **Disk cache threshold (ms)** under
**Settings → Cache**; fractional values are supported and 0 removes the time
threshold. Changes apply to new computations from the next model execution;
existing entries retain their disk eligibility.
Faster results still use the memory cache, and later memory hits do not promote
them to disk. The computation timer excludes the surrounding cache lookup,
argument hashing and persistence encoding. Batched snapshot queries use their
local or Worker computation time, excluding input restoration and transport.
Existing disk records remain readable; restoring a record preserves its disk
eligibility.

The model engine fingerprints static function definitions, their referenced
local declarations, imported implementation graphs and codec definitions. Aliases
and re-exports of Core cache factories are supported. Editing an unrelated local
binding, moving a definition or adding/removing `export` preserves its identity;
changing a referenced helper or dependency invalidates it. Functions supplied as parameters, dynamic factory results and closures capturing
enclosing function/loop bindings use memory-only object identity.
Outside the model engine, ordinary Node calls also use function object identity
and share the process-wide memory LRU. Authors do not provide cache IDs or versions.

Public cached computations, primitives, Core geometry, font parsing, glyph contours
and snapshot queries share one cache. Memory and browser OPFS disk budgets are managed by the host; consult App
settings for the active disk budget.
Cancellation and exceptions retain completed entries and editing history.

## CacheOptions and errors

`CacheOptions<Value>` requires both `encoder(value: Value): Uint8Array` and
`decoder(bytes: Uint8Array): Value`. They are synchronous and must round-trip the
value without relying on hidden changing state. Custom result codecs do not
change how arguments are keyed; arguments still use the standard data encoding.

The computation must be synchronous and deterministic. Its thrown errors
propagate and are not stored as results. Promise-like results are excluded by
the TypeScript overloads and rejected at runtime. Unsupported arguments fail
while creating their content key, before invoking the computation. Persistence
encoding or restoration failures are recorded by the cache and degrade to
memory use or recomputation; they do not make a broken codec reliable.

Read [input](input.md) and [timeOffset](time-offset.md) outside the cached body,
then pass their values as arguments. Avoid reading mutable module state, random
numbers or the wall clock from inside a supposedly reusable computation.
