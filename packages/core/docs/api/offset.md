---
title: offset
description: Translate a placement result along fixed composition axes.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/offset.ts
      sha256: bb50275bba37e361cafd3bdf16229f809323e6b89bf1cd55dc2e6c0993c34288
      commit: 757c8003e4ef2c3e4b4e85561e186a82a1dd1c39
    - path: packages/core/src/library/runtime.ts
      sha256: fc22c45a8a4fd68eaf51c43b8dc100f9337fc8bcb59760e2cc2e0dcbc437b337
    - path: packages/core/src/library/relation-solver.ts
      sha256: 57d7233eb74cba8255805756053b2385a4dca8a78dad6a9a09590bda68630e47
      commit: 91ff6d31aa4440565eb7ffc4ef30dd1ffd50707a
    - path: packages/core/src/library/validation.ts
      sha256: dae9300aea522c8aee83ef09e6716f31cd17f0cf6fb6df537218ecb72c63419d
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
sidebar:
  hidden: true
head:
  - tag: title
    content: offset — Code3D TypeScript API reference
---

Translate a placement result along fixed composition axes.

## Example

```ts
import {box, group, offset, on} from '@code3d/core';

const shiftBase = box(32, 4, 24);
const shiftPart = box(8, 10, 8).relate(() => [
  on(shiftBase.up),
  offset(7, 0, 0),
]);
export const shiftedAssembly = group([shiftBase, shiftPart]);
```

![Translate a placement result along fixed composition axes.](../../../web/src/assets/models/placement-offset.png)

Complete example: [groups and placement](../../../app/examples/constraints/placement-api.ts).

## Signature

```ts
function offset(x: number, y: number, z: number): Transformation;
```

Import the functions and named types from `@code3d/core`.

## Fixed axes

`x`, `y` and `z` are signed distances in model units along the fixed axes of the
composition's solve frame. They do not follow the moving part's orientation and
are not necessarily the viewport's world axes. The same convention applies
regardless of which argument of an `on` or `align` constraint names self.

The example first places the part on the base, then moves it 7 units along the
composition's +X direction. An offset in Y could leave a gap or move the part
into the base; previous contact conditions are not re-enforced after the step.
A nested group carries its placement frame into the enclosing composition.

There is no `model.offset()` method. To change local geometry coordinates, use
[originOffset](origin-offset.md); to place a part, use this transformation inside
`relate`.

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
