---
title: axisEdge
description: Rotate a placed model about one of its own straight topology edges.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/axis-edge.ts
      sha256: 78760cbd39c9647ec89e57f0d35f3adf83c96fcd491b62ddfe6dea59dcbddff0
      commit: 757c8003e4ef2c3e4b4e85561e186a82a1dd1c39
    - path: packages/core/src/library/runtime.ts
      sha256: e3658b0ffa55da9d2c612f442ce1d5f190923aea1870122823677faa60fb0b84
    - path: packages/core/src/library/topology.ts
      sha256: f9f0d048fe30cc80046a25123aa8101ca51e85cdb5b2e66260c6a68f43f84715
      commit: 67228dd8559d584852df7bfbd47ed89f1d8003e9
    - path: packages/core/src/library/topology-id.ts
      sha256: 49b2812aa89e5a886759166c89e32cf01a629fe888bcc57452ede2feeba7dc01
      commit: 904463d8c4405f4a2b1c073ba9a5edc997732e23
    - path: packages/core/src/library/spatial.ts
      sha256: 810c4fa69352c26c32fb04a0e7867f6327698e02f3212669f17d777784322a78
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
sidebar:
  hidden: true
head:
  - tag: title
    content: axisEdge — Code3D TypeScript API reference
---

Rotate a placed model about one of its own straight topology edges.

## Example

```ts
import {axisEdge, box, group, on} from '@code3d/core';

const edgeBase = box(32, 4, 24);
const edgePart = box(12, 10, 8).relate(() => [
  on(edgeBase.up),
  axisEdge(2).rotate(40),
]);
export const edgeAxisAssembly = group([edgeBase, edgePart]);
```

![Rotate a placed model about one of its own straight topology edges.](../../../web/src/assets/models/placement-axis-edge.png)

Complete example: [groups and placement](../../../app/examples/constraints/placement-api.ts).

## Signature

```ts
function axisEdge(id: EdgeId): AxisChain;
chain.axisOffset(x: number, y: number, z: number): AxisRotation;
chain.rotate(angle: number): Transformation;
```

Import the functions and named types from `@code3d/core`.

## Edge selection

`id` selects an edge belonging to the callback's self. Use a positive integer or
an inherited path of at least two positive integers. Unknown, retired or malformed
IDs fail. The edge must be straight: a curved edge does not define one rotation
axis. The supporting line extends beyond the finite edge's endpoints.

The example turns around the input box's E2. Edge direction determines the
positive angular sense. To explicitly reverse a chosen reference, use
[axisLine](axis-line.md) with `self.edge(id).reverse()`.

A group or sketch has no aggregate model edge IDs. Use `axisLine` with a member's
straight edge or another positioned line reference. For self-local XYZ rotation
about a point, use [pivotVertex](pivot-vertex.md).

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
