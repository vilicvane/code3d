---
title: Model package data
description: Attach symbol-keyed package metadata to model values and understand which operations retain it.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: e3658b0ffa55da9d2c612f442ce1d5f190923aea1870122823677faa60fb0b84
      commit: 3d2db0c82c1ae0e6723ecd77fa6f571b326d1681
sidebar:
  hidden: true
head:
  - tag: title
    content: Model package data — Code3D TypeScript API reference
---

`setModelData` and `getModelData` let a package associate its own data with a model without adding public geometry members or colliding with another package.

## Example

```ts
import {box, getModelData, setModelData} from '@code3d/core';

type PartData = Readonly<{sku: string}>;
const partData = Symbol('part-data');
const part = box(20, 10, 8);
setModelData(part, partData, {sku: 'bracket-a'} satisfies PartData);
export const finished = part.material('#9bc7c5');
const info = getModelData<PartData>(finished, partData); // {sku: 'bracket-a'}
```

## Signature

```ts
setModelData<Value>(model: Model, key: symbol, value: Value): void;
getModelData<Value>(model: Model, key: symbol): Value | undefined;
```

Import the functions and named types from `@code3d/core`.

## Keys and values

Use a package-owned `symbol` as the key. Two independently created symbols with
the same description remain different keys. Setting an existing key replaces
that entry; reading an absent key returns `undefined`. Both functions require a
real model value, including a group; passing an anchor or a plain object throws.

The `Value` generic is a compile-time assertion at read time, not runtime
validation. A symbol is not itself associated with a TypeScript value type.
Wrap these functions in a package-specific getter/setter if consumers need a
stable typed contract. Values are retained by reference without cloning or freezing.

## Lifetime and model copies

Attach metadata while constructing a new package model, before exposing it to
callers. `setModelData` changes that model's metadata association in place; it
returns `void` and is not an immutable modeling operation. It does not change
geometry, material or placement and does not trigger UI updates.

Only `.relate()` and `.material()` copies retain this data map automatically.
Other modeling operations, including origin changes, scaling, geometry edits,
`expose()` and grouping, do not propagate it. A group does not inherit its
members' package data as its own. Recompute and attach data when an operation
changes the package's meaning.

A copied model initially shares the same immutable map. Later calls to
`setModelData` replace only the map for the model being written, so already
created copies keep their earlier entries. However, mutating a stored object
changes that object wherever it is shared; prefer immutable records.

Associations use weak model identity and are runtime-only. They are not a
serialization, persistent cache, source-tracing or inspection-data mechanism.
Use [captureInspectData](inspectors.md#call-data) for one invocation's inspector
facts, and [expose](expose.md) for public placement references.
