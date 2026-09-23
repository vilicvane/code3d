---
title: pivotPoint
description: Use a positioned point reference as a placement rotation center.
sourceReview:
  packageVersion: 0.0.1-alpha.16
  sources:
    - path: packages/core/src/library/pivot-point.ts
      sha256: 65201ff5dade0bcccdf9797e38ce89246dde449d5772a7f9083c740a7d0d74b9
      commit: 757c8003e4ef2c3e4b4e85561e186a82a1dd1c39
    - path: packages/core/src/library/runtime.ts
      sha256: dcee3d2388a9b7b3819bb4897edd894463daa0e5b519e832a3349fac98c3bff8
    - path: packages/core/src/library/spatial.ts
      sha256: 810c4fa69352c26c32fb04a0e7867f6327698e02f3212669f17d777784322a78
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
sidebar:
  hidden: true
head:
  - tag: title
    content: pivotPoint — Code3D TypeScript API reference
---

Use a positioned point reference as a placement rotation center.

## Example

```ts
import {box, group, on, pivotPoint} from '@code3d/core';

const pointBase = box(32, 4, 24);
const pointPart = box(12, 10, 8).relate(self => [
  on(pointBase.up),
  pivotPoint(self.vertex(3)).rotate(0, 0, 30),
]);
export const pointPivotAssembly = group([pointBase, pointPart]);
```

![Use a positioned point reference as a placement rotation center.](../../../web/src/assets/models/placement-pivot-point.png)

Complete example: [groups and placement](../../../app/examples/constraints/placement-api.ts).

## Signature

```ts
function pivotPoint(point: PointAnchor): PivotChain;
chain.pivotOffset(x: number, y: number, z: number): PivotRotation;
chain.rotate(x: number, y: number, z: number): Transformation;
```

Import the functions and named types from `@code3d/core`.

## Point identity

`point` is a point reference: a vertex, origin, center, curve endpoint, exposed
point or point model. A raw tuple is not accepted; use [pivot](pivot.md) for
coordinates. Non-point references are rejected.

The referenced point may belong to self or an external model. External points
use that model's solved placement. `pivotPoint(self.center)` follows the new
part; a reference selected from the original receiver keeps the original owner's
identity. Nested and repeated members require an unambiguous occurrence.

Only the rotation center comes from the point. Rotation axes remain self's
local XYZ axes, not the point owner's axes. The example uses the new part's own
vertex; changing its dimensions moves the pivot with that vertex.

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
