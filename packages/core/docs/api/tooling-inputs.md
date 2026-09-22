---
title: Input, time and cache scopes
description: Establish serial host scopes for numeric inputs, playback time and compiler-supplied cache identities.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/cached.ts
      sha256: 9b9806bfa153c119d8954636c6c9be114bae2e95073165742b50d8316f8e1a1d
      commit: 7871945765ce2e86ba7a6ed227b7cc8c3d8ba81f
    - path: packages/core/src/library/input.ts
      sha256: 40f5d1c698e755c1b21e040a8ac4dd8942a69f93012cfdf5ac9c3156b935511e
      commit: 46c94b9c7709c93da17db39f12991e7a8b2fa8b0
    - path: packages/core/src/library/time-offset.ts
      sha256: 246d6631b743c85e3e96b31ab12c660662f9cee7e63f5daaee6a736c0caca798
      commit: 025b3ce96b10249bda2ecc9cc475fb88f725187f
sidebar:
  hidden: true
head:
  - tag: title
    content: Input, time and cache scopes — Code3D TypeScript API reference
---

Tooling hosts use these APIs to establish serial host scopes for numeric inputs, playback time and compiler-supplied cache identities.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {input, timeOffset} from '@code3d/core';
import {beginModelInputs, beginTimeOffset} from '@code3d/core/tooling';

const inputs = beginModelInputs({Width: 32});
const finishTime = beginTimeOffset(1.5);
try {
  const width = input('Width', 20, {min: 1}); // 32
  const seconds = timeOffset(); // 1.5
  const definitions = [...inputs.definitions.values()];
} finally {
  finishTime();
  inputs.finish();
}
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## Scope lifetime

Scopes are module-local runtime context. Serialize evaluations that use the same
Core instance and restore scopes in reverse order in `finally`. Do not overlap
async model executions through one global input/time context. Beginning these
scopes does not evaluate a module or update a UI.

`beginModelInputs(values, onRead?)` installs a readonly map of name-to-number
overrides and returns `definitions` plus `finish()`. The map records declarations
actually reached by [input](input.md). `onRead(name)` runs on reads; it can record
dependencies. The definitions map is filled during evaluation; copy its values
before publishing a result if the host needs a stable snapshot. `finish()` restores
the previous input scope, including nested scopes.

`beginTimeOffset(value, read?)` supplies seconds to [timeOffset](time-offset.md)
and returns the restoration function. The optional callback receives the value
on every read. The reader checks finiteness when it is reached; the scope setter
itself does not normalize time or schedule playback.

## Cache identities

`identifyCachedFunction(fn, identity)` returns a wrapper preserving the function's
type, call arguments and receiver. The compiler must supply an identity covering
the definition, static dependencies and result codec. Never reuse an identity
for unrelated computations or omit dependencies merely to increase hits. The
wrapper has its own identity; the original function object is not relabeled.
This enables persistent [cache](cache.md) reuse where ordinary closures have only
process-local object identity. Changing arguments changes entries, not the
static definition identity.

`ModelInputValues` is a readonly string-to-number record.
`ModelInputDefinition` contains `name`, `defaultValue` and optional `min`, `max`,
`step`; these are the same declarations documented by [input](input.md).

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### beginModelInputs

```ts
function beginModelInputs(
  values: ModelInputValues,
  onRead?: (name: string) => void,
): {
  definitions: ReadonlyMap<string, ModelInputDefinition>;
  finish(): void;
};
```

### beginTimeOffset

```ts
function beginTimeOffset(
  value: number,
  read?: TimeOffsetContext['read'],
): () => void;
```

### identifyCachedFunction

```ts
function identifyCachedFunction<Fn extends Function>(
  fn: Fn,
  identity: string,
): Fn;
```

### ModelInputValues

```ts
type ModelInputValues = Readonly<Record<string, number>>;
```

### ModelInputDefinition

```ts
type ModelInputDefinition = InputOptions &
  Readonly<{
    name: string;
    defaultValue: number;
  }>;
```
