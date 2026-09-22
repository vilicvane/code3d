---
title: pivot
description: Choose a self-local point as the center of a placement rotation.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/pivot.ts
      sha256: e871a5fd2f2afad3d07d9a95994f007a695dd7fba5553a3d6df70ef06de53584
      commit: 757c8003e4ef2c3e4b4e85561e186a82a1dd1c39
    - path: packages/core/src/library/runtime.ts
      sha256: fc22c45a8a4fd68eaf51c43b8dc100f9337fc8bcb59760e2cc2e0dcbc437b337
    - path: packages/core/src/library/spatial.ts
      sha256: 810c4fa69352c26c32fb04a0e7867f6327698e02f3212669f17d777784322a78
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
    - path: packages/core/src/library/validation.ts
      sha256: dae9300aea522c8aee83ef09e6716f31cd17f0cf6fb6df537218ecb72c63419d
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
sidebar:
  hidden: true
head:
  - tag: title
    content: pivot — Code3D TypeScript API reference
---

Choose a self-local point as the center of a placement rotation.

## Example

```ts
import {box, group, on, pivot} from '@code3d/core';

const pivotBase = box(32, 4, 24);
const pivotPart = box(12, 10, 8).relate(() => [
  on(pivotBase.up),
  pivot([6, -5, 0]).rotate(0, 0, 35),
]);
export const pivotedAssembly = group([pivotBase, pivotPart]);
```

![Choose a self-local point as the center of a placement rotation.](../../../web/src/assets/models/placement-pivot.png)

Complete example: [groups and placement](../../../app/examples/constraints/placement-api.ts).

## Signature

```ts
function pivot(point: Vec3): PivotChain;
chain.pivotOffset(x: number, y: number, z: number): PivotRotation;
chain.rotate(x: number, y: number, z: number): Transformation;
```

Import the functions and named types from `@code3d/core`.

## Point coordinates

`point` is a three-component finite coordinate tuple in self's local frame.
It is a position, not a displacement in composition axes. The example chooses
the center of the part's right-bottom edge and turns about that center after
placing the part on the base. The model's authored origin is unchanged.

TypeScript requires the coordinate tuple. The App can complete a missing point
or tuple component with zero. Use [pivotPoint](pivot-point.md) to retain an
existing point reference, or [pivotVertex](pivot-vertex.md) for a topology ID.

## Complete the rotation

The returned `PivotChain` has two choices: call `.rotate(x, y, z)` directly, or
call `.pivotOffset(dx, dy, dz)` once and then `.rotate(x, y, z)`. The offset returns
`PivotRotation`, which supports the final rotation but no further pivotOffset.
All offset components and angles must be finite. Angles are degrees, applied
around fixed self-local X, then Y, then Z axes with right-hand positive sense.
The App uses zero defaults during editing; TypeScript requires every component.

`pivotOffset` moves the selected center along self's local axes while retaining
the chosen reference. It does not translate the model by itself. The final
`rotate` returns a `Transformation` for [relate](relate.md). The selector applies
to that one rotation; return a completed transformation, not an unfinished chain.
Subsequent transformations are separate array entries. Use [axisLine](axis-line.md)
for rotation about an arbitrary directed line instead of self's XYZ axes.
