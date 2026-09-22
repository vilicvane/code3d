---
title: model.rotate
description: Rotate model geometry around local zero in fixed X, Y, Z order.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: 308d85faa087cba7b1c91eb29fd5c36b3936914186cbb0a6493b31f7a1f39adc
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
    content: model.rotate — Code3D TypeScript API reference
---

Rotate model geometry around its current local zero, preserving its model coordinate axes.

## Example

```ts
import {box} from '@code3d/core';

export const rotated = box(20, 4, 8).originOffset(-10, 0, 0).rotate(0, 0, 45);
```

![A box rotated around its rebased end.](../../../web/src/assets/models/local-model-rotate.png)

Complete example: [origins and local transforms](../../../app/examples/operations/local-transforms.ts).

## Signature

```ts
model.rotate(x: number, y: number, z: number): ModelForKind<Elements, Kind>;
```

Import the functions and named types from `@code3d/core`.

## Angles and order

`x`, `y` and `z` are finite angles in degrees. All three are required in
TypeScript; the App can use zero for missing components in an incomplete call.
Negative and multi-turn angles are accepted.

Within one call, rotations act in fixed local X, then Y, then Z order. Positive
angles follow the right-hand rule. For example, rotating `[10, 0, 0]` by
`(0, 90, 0)` gives `[0, 0, -10]`. Successive method calls apply in written order;
rotations around different axes generally do not commute.

## Pivot and coordinates

The pivot is current local `[0, 0, 0]`. First choose a different zero with
[originPoint](origin-point.md), [originVertex](origin-vertex.md),
[originOffset](origin-offset.md) or [originCenter](origin-center.md) if needed.
In the example, rebasing puts the box's left-end center at zero before the 45°
rotation.

The geometry, geometric references and exposed members rotate together. The
model frame's local XYZ axes do not rotate; its `up` bound still means local +Y.
A face normal or an edge tangent can point in a different direction. Length,
area and volume stay the same, while axis-aligned bounds may change.

## Groups and value behavior

All models, including groups, support this method. A group rotates its assembled
layout as a whole, retaining nested membership and internal relative placement.
The method returns a new model of the same kind and exposed interface. The input
is unchanged, and topology IDs are preserved.

Use the standalone [rotate transformation](../api.md#independent-placement-transformations)
inside `relate` to rotate a placed part. Pivot and axis selection chains belong
to that placement API; they are not methods chained from `model.rotate()`.
