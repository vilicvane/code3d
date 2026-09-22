---
title: axisLine
description: Rotate a placement about a self or external straight line reference.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/axis-line.ts
      sha256: 64d5178cc0ebaea5301d6bd0a2f3c1a47052500905b6d4dc7f394ce9bec23231
      commit: 757c8003e4ef2c3e4b4e85561e186a82a1dd1c39
    - path: packages/core/src/library/runtime.ts
      sha256: fc22c45a8a4fd68eaf51c43b8dc100f9337fc8bcb59760e2cc2e0dcbc437b337
    - path: packages/core/src/library/spatial.ts
      sha256: 810c4fa69352c26c32fb04a0e7867f6327698e02f3212669f17d777784322a78
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
sidebar:
  hidden: true
head:
  - tag: title
    content: axisLine — Code3D TypeScript API reference
---

Rotate a placement about a self or external straight line reference.

## Example

```ts
import {axisLine, box, group, on} from '@code3d/core';

const axisBase = box(32, 4, 24);
const axisPart = box(12, 10, 8).relate(self => [
  on(axisBase.up),
  axisLine(self.axis).axisOffset(3, 0, 0).rotate(40),
]);
export const lineAxisAssembly = group([axisBase, axisPart]);
```

![Rotate a placement about a self or external straight line reference.](../../../web/src/assets/models/placement-axis-line.png)

Complete example: [groups and placement](../../../app/examples/constraints/placement-api.ts).

## Signature

```ts
function axisLine(axis: LineAnchor): AxisChain;
chain.axisOffset(x: number, y: number, z: number): AxisRotation;
chain.rotate(angle: number): Transformation;
```

Import the functions and named types from `@code3d/core`.

## Line and placement

`axis` accepts a line anchor such as a model's `axis`, a straight edge or a line
model. A curved edge is rejected. The supporting line defines the axis regardless
of its finite endpoints. Reversing the reference reverses the positive rotation
sense without changing the reference coordinate axes.

A self reference uses the current placement of self. An external axis is resolved
from its owner's placement in the composition. These are different choices:
`axisLine(self.axis)` refers to the returned new part; `axisLine(original.axis)`
keeps the original model's identity. Use the actual occurrence for nested or
repeated members.

The example offsets self's axis 3 units along that axis frame's X direction before
turning. An external fixed axis can make transformation order particularly visible:
translating first then rotating can differ from rotating first then translating.

## Offset and rotate

`AxisChain` provides `.rotate(angle)` directly, or one `.axisOffset(x, y, z)`
followed by `.rotate(angle)`. The offset returns `AxisRotation`, which supports
the final rotation but no further axisOffset. Components are finite distances
in the selected axis's reference frame. Moving along the axis itself does not
change the rotation. Offset changes the selected line's position while retaining
its direction; it does not directly translate self.

`angle` is a finite signed degree value, positive by the right-hand rule about
the directed axis. Negative and multi-turn values are allowed. Required numeric
arguments use zero defaults only while the App edits incomplete calls.
The final result is one complete `Transformation` for [relate](relate.md).
Finish selectors before returning them from the callback. Later transformations
are separate entries; the chosen axis applies to this rotation only.
