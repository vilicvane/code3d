---
title: Model metadata
description: Read and replace symbol-keyed metadata snapshots while preserving model value semantics.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: 1caf8c92de983f0c22b4da70e0af4216472b9ff8fe8e2f0ebc34ec9a84e259b0
sidebar:
  hidden: true
head:
  - tag: title
    content: Model metadata — Code3D TypeScript API reference
---

Every model exposes a readonly `metadata` dictionary. `withMetadata` returns a new model with package-owned entries added or replaced, preserving the original model.

## Example

```ts
import {box} from '@code3d/core';

type PartData = Readonly<{sku: string}>;
const partData = Symbol('part-data');
const part = box(20, 10, 8).withMetadata({
  [partData]: {sku: 'bracket-a'} satisfies PartData,
});
export const finished = part.material('#9bc7c5').originOffset(0, -5, 0);
const info = finished.metadata[partData] as PartData | undefined;
```

## Signature

```ts
type ModelMetadata = Readonly<Record<symbol, unknown>>;
// Members of every model, including GroupModel:
readonly metadata: ModelMetadata;
withMetadata(entries: ModelMetadata): ModelForKind<Elements, Kind>;
```

Import the functions and named types from `@code3d/core`.

## Keys, values and replacement

Use a package-owned `symbol` as the key. Distinct symbols remain independent,
even when their descriptions match. Reusing a key replaces that entry; other
keys remain unchanged. Reading an absent key returns `undefined`.

The public value type is `unknown`. A symbol does not associate a TypeScript
value type with the entry; a package-specific accessor can validate or narrow its
own data. The example's type assertion is not runtime validation.

`withMetadata` copies the dictionary and preserves the original model's entries.
Stored values are opaque references, not recursively cloned or frozen. Treat
nested objects and arrays as immutable so later mutations do not affect other
model values holding those references. No metadata history is replayed.

## Inheritance through modeling operations

| Operation                                                 | Result metadata                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| Origin edits, rotate, scaled, material, expose and relate | Retains the input's current entries.                              |
| Extrude, revolve, sweep and thicken                       | Inherits the profile or face's entries.                           |
| Wrap and loft                                             | Inherits the first profile's entries.                             |
| Cut                                                       | Inherits the stock's entries.                                     |
| Union and intersect                                       | Inherits the first input's entries, without merging other inputs. |
| Fillet, chamfer and shell                                 | Retains the source solid's entries.                               |
| A newly constructed group                                 | Starts with empty metadata; children retain their own entries.    |

`withMetadata` preserves the model kind and named-reference types. Metadata does
not change geometry, appearance or placement. Core does not interpret units,
scale numbers in entries or rebind references stored inside them. After a
package operation changes their meaning, explicitly calculate and write new
entries. For geometric interfaces use [expose](expose.md), so references follow
the resulting model's coordinate changes. A package can retain invariant
metadata and derive dimensions from those current references.

## Lifetime and transport

Metadata is in-process model state. Render snapshots, Worker messages and
geometry exports omit it. It is not a persistence, cache serialization or
source-inspection data protocol. Use [captureInspectData](inspectors.md#call-data)
for facts belonging to one inspected invocation.
