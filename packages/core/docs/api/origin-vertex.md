---
title: originVertex
description: Set a geometric model origin to one of its topology vertices.
sourceReview:
  packageVersion: 0.0.1-alpha.16
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: dcee3d2388a9b7b3819bb4897edd894463daa0e5b519e832a3349fac98c3bff8
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
    content: originVertex — Code3D TypeScript API reference
---

Choose one of a geometric model’s own topology vertices as local zero.

## Example

```ts
import {box} from '@code3d/core';

export const cornerZero = box(24, 6, 14).originVertex(3);
```

![A box rebased to vertex 3.](../../../web/src/assets/models/local-origin-vertex.png)

Complete example: [origins and local transforms](../../../app/examples/operations/local-transforms.ts).

## Signature

```ts
model.originVertex(id: VertexId): ModelForKind<Elements, Kind>;
```

Import the functions and named types from `@code3d/core`.

## Vertex IDs

`id` selects a vertex from the current input model. Use a positive integer, or a
path containing at least two positive integers for inherited topology. The ID
must exist; malformed, unknown and retired IDs throw. See
[topology IDs](../topology.md#ids-belong-to-a-model).

The chosen vertex becomes `[0, 0, 0]`; all other geometry shifts by the opposite
of that vertex's old position. The operation is equivalent to
`model.originPoint(model.vertex(id))` and preserves the vertex's ID in the result.

This method is available on solid, face, edge and vertex models. Groups do not
have aggregate topology IDs. For a group, use
[originPoint](origin-point.md) with a member's vertex instead.

## Choosing a rotation pivot

After selecting the corner, [model.rotate](model-rotate.md) rotates geometry
around that corner. Setting a new origin is explicit; filleting, chamfering,
cutting or constructing a loft does not automatically recenter the result.

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
