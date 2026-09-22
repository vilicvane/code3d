---
title: rotate
description: Rotate a placed model about its current origin and local XYZ axes.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/rotate.ts
      sha256: 298a2047aba9c193b3bb6f45d2382a5e5a2889c79e30ae0b492d7b2ee432ef43
      commit: 757c8003e4ef2c3e4b4e85561e186a82a1dd1c39
    - path: packages/core/src/library/runtime.ts
      sha256: 1caf8c92de983f0c22b4da70e0af4216472b9ff8fe8e2f0ebc34ec9a84e259b0
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
    content: rotate — Code3D TypeScript API reference
---

Rotate a placed model about its current origin and local XYZ axes.

## Example

```ts
import {box, group, on, rotate} from '@code3d/core';

const turnBase = box(32, 4, 24);
const turnPart = box(8, 10, 8).relate(() => [
  on(turnBase.up),
  rotate(0, 0, 25),
]);
export const turnedAssembly = group([turnBase, turnPart]);
```

![Rotate a placed model about its current origin and local XYZ axes.](../../../web/src/assets/models/placement-rotate.png)

Complete example: [groups and placement](../../../app/examples/constraints/placement-api.ts).

## Signature

```ts
function rotate(x: number, y: number, z: number): Transformation;
```

Import the functions and named types from `@code3d/core`.

## Angles and center

`x`, `y` and `z` are finite signed angles in degrees. They act about self's
current local origin, in fixed local X, then Y, then Z order. Positive angles
follow the right-hand rule. Negative and multi-turn values are valid.

This operates on the preceding solved placement. In the example the part first
touches the base, then turns 25° about its own origin and local Z direction.
Rotation can move it away from the previous contact. The axes are self's local
axes at this step, not the fixed composition axes used by [offset](offset.md).

Use [pivot](pivot.md), [pivotVertex](pivot-vertex.md) or
[pivotPoint](pivot-point.md) to change the center while keeping self's XYZ axes.
Use [axisEdge](axis-edge.md) or [axisLine](axis-line.md) for one directed axis.
[model.rotate](model-rotate.md) is the separate local geometry method.

## Cumulative angles

Placement rotation retains authored full turns for [coupleRotation](couple-rotation.md).
A 360° rotation can therefore matter to an angular ratio even though it has the
same final rigid orientation as 0°. This comes from the expression sequence,
not from previous animation frames.

## Placement value and sequence

The constructor returns a complete `Transformation` for [relate](relate.md).
It describes placement and does not change standalone model geometry. Place it
after an intended contact or alignment. Array entries execute in order; a later
constraint starts another solve segment. A zero value leaves the preceding pose
unchanged and does not add a condition.

A completed transformation has no chained offset, rotate or pivot methods.
Write separate entries such as `[on(...), offset(...), rotate(...)]`. Groups
transform as complete rigid assemblies. Angles and displacements are finite;
TypeScript requires the numeric arguments, while the App editing defaults are
zero for missing components.
