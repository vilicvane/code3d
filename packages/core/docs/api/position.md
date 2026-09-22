---
title: position
description: Read the model origin in another model’s solved local frame.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: fc22c45a8a4fd68eaf51c43b8dc100f9337fc8bcb59760e2cc2e0dcbc437b337
    - path: packages/core/src/library/spatial.ts
      sha256: 810c4fa69352c26c32fb04a0e7867f6327698e02f3212669f17d777784322a78
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
sidebar:
  hidden: true
head:
  - tag: title
    content: position — Code3D TypeScript API reference
---

Read the model origin in another model’s solved local frame.

## Example

```ts
import {on, box, group, offset} from '@code3d/core';

const base = box(20, 4, 20);
const part = box(8, 12, 4).relate(() => [on(base.up), offset(20, 0, 0)]);
export const size = part.bounds().size; // [8, 12, 4]
export const origin = part.position(base); // [20, 8, 0]
export const minimum = part.bounds(base).minimum; // [16, 2, -2]
export default group([base, part]);
```

## Signature

```ts
model.position(relativeTo: Model): Vec3;
type Vec3 = readonly [number, number, number];
```

Import the functions and named types from `@code3d/core`.

## Required reference model

Every model kind, including groups, supports `position`. `relativeTo` is required
and must be a model; the result is an XYZ coordinate tuple in its local frame.
Existing relations are solved, and a unique member occurrence inside a nested
reference group is respected. It is neither camera coordinates nor an implicit
application-global position.

The example's part origin is `[20, 8, 0]` in the base frame: the contact puts
its half-height 6 above the base top at Y = 2, followed by an X offset of 20.
`part.position(part)` is always `[0, 0, 0]`.

## Origin versus geometry

Position measures the model's coordinate origin, not its geometric center or
minimum bound. A `point([10, 0, 0])` model still has origin zero in its own frame;
its actual vertex is at X = 10. Origin edits change the relationship between
geometry and the frame, so use [bounds](bounds.md) or [distance](distance.md)
when the geometry itself is the measurement target.

Unrelated models use coincident origins and matching axes. A group keeps its
composition frame. A bare source with multiple occurrences in a reference group
is ambiguous and throws; select an unambiguous instance or create distinct part
values. `position` is a reserved model member name and cannot be exposed over.

## Returned value

The result is ordinary numeric data in model units. Reading it changes neither
model. It reflects relationships already attached at the call; constraints still
being constructed inside a `relate` callback are not yet attached. Creating
additional related model values later does not update a previously stored tuple.
