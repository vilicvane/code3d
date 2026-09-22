---
title: originOffset
description: Shift the local origin by a displacement while preserving shape and topology.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
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
    content: originOffset — Code3D TypeScript API reference
---

Choose a new local zero by a displacement in the input model coordinates.

## Example

```ts
import {box} from '@code3d/core';

export const bottomZero = box(24, 6, 14).originOffset(0, -3, 0);
```

![A box with its bottom face centered at local zero.](../../../web/src/assets/models/local-transforms.png)

Complete example: [origins and local transforms](../../../app/examples/operations/local-transforms.ts).

## Signature

```ts
model.originOffset(dx: number, dy: number, dz: number): ModelForKind<Elements, Kind>;
```

Import the functions and named types from `@code3d/core`.

## Displacement and coordinates

`dx`, `dy` and `dz` are finite distances in model units. TypeScript requires all
three; the App can fill omitted components with zero while editing.

If the chosen displacement is `d`, each point changes from `p` to `p - d`.
A positive origin displacement therefore reduces geometry coordinates on that
axis. The example chooses the center of the box's bottom as zero: its Y range
changes from `[-3, 3]` to `[0, 6]`.

Successive offsets add; opposite offsets cancel. The shape and distances between
its points do not change. Use [originPoint](origin-point.md) when the desired zero
is an existing point reference, or [originCenter](origin-center.md) for the current
geometric bounding-box center.

## Groups

All models support `originOffset`, including empty and nested groups. A group is
rebased as one already assembled layout. Member spacing and internal placement
are retained; the operation does not recenter each member independently.

## Value and reference behavior

The operation returns a new model with the same kind and exposed member types.
The original value and previously selected references keep their meaning.
Topology IDs are preserved. Geometry and named references are transformed
together; `model.origin` and `model.frame.origin` on the result still refer to
its local zero. Origin changes preserve directions, lengths, areas and volumes.

These operations work in the receiver's local coordinates. A relation's
[offset](../api.md#independent-placement-transformations) places a part in a
composition; it is a separate operation. For an already related model, its own
geometry references in stored placement conditions are transformed consistently.
See [local coordinates](../local-coordinates.md) for assembly frame rules.
