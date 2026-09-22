---
title: scaled
description: Uniformly scale geometric models around local zero by a positive factor.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: 308d85faa087cba7b1c91eb29fd5c36b3936914186cbb0a6493b31f7a1f39adc
    - path: packages/core/src/library/spatial.ts
      sha256: 810c4fa69352c26c32fb04a0e7867f6327698e02f3212669f17d777784322a78
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
    - path: packages/core/src/library/kernel-shapes.ts
      sha256: 4b28f672f9c5ac43a1dfa04ced8d2f1eacce9a2c7eaaaac561d885f7efc95ac8
      commit: 1baef99a1318fc694825ec0a48d4d39635a3a130
    - path: packages/core/src/library/validation.ts
      sha256: dae9300aea522c8aee83ef09e6716f31cd17f0cf6fb6df537218ecb72c63419d
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
sidebar:
  hidden: true
head:
  - tag: title
    content: scaled — Code3D TypeScript API reference
---

Uniformly scale a geometric model around its current local zero.

## Example

```ts
import {box} from '@code3d/core';

export const enlarged = box(12, 4, 8).originOffset(-10, 0, 0).scaled(2);
```

![A box enlarged around local zero after rebasing.](../../../web/src/assets/models/local-scaled.png)

Complete example: [origins and local transforms](../../../app/examples/operations/local-transforms.ts).

## Signature

```ts
model.scaled(factor: number): ModelForKind<Elements, Kind>;
```

Import the functions and named types from `@code3d/core`.

## Scale factor

`factor` is a positive finite number. Values above 1 enlarge, values between 0
and 1 shrink, and 1 preserves size. Zero, negative values, NaN and infinity
throw. Negative factors are not a mirroring API. TypeScript requires the factor;
the App editing default is 1.

Scaling is uniform on all axes and acts around local zero. Every local point
coordinate is multiplied by the factor. The example's box center moves from
`[10, 0, 0]` to `[20, 0, 0]` and its size becomes `[24, 8, 16]`. Choosing a
different origin before scaling changes the point that remains fixed.

## Measurements and references

Lengths scale by `factor`, areas by `factor ** 2`, and volumes by
`factor ** 3`. The example volume is 3072. Geometric reference positions and
exposed members follow the same scale. The model origin remains zero and the
local frame axes keep their directions.

The result is a new value with the same geometric kind and exposed interface;
the input is unchanged. Topology IDs are preserved. Solid, face, edge and vertex
models support scaling; groups do not. Scale their geometric parts explicitly
before composing if that is the intended modeling operation.

## Placement and operation order

Own geometry references used by existing placement conditions are scaled
consistently; explicit relation offsets are placement values, not dimensions
of the geometry. Arrange a part with `relate` after establishing its dimensions
when that makes the design clearer.

Scaling and rebasing generally do not commute: a preceding origin offset is
part of the coordinates being scaled. For a size change about the current
bounding-box center, call [originCenter](origin-center.md) first. Use
[model.rotate](model-rotate.md) for rigid rotation.
