---
title: fillet
description: Round selected edges of a solid with a constant radius.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: 308d85faa087cba7b1c91eb29fd5c36b3936914186cbb0a6493b31f7a1f39adc
    - path: packages/core/src/library/topology.ts
      sha256: f9f0d048fe30cc80046a25123aa8101ca51e85cdb5b2e66260c6a68f43f84715
      commit: 67228dd8559d584852df7bfbd47ed89f1d8003e9
    - path: packages/core/src/library/topology-id.ts
      sha256: 49b2812aa89e5a886759166c89e32cf01a629fe888bcc57452ede2feeba7dc01
      commit: 904463d8c4405f4a2b1c073ba9a5edc997732e23
    - path: packages/core/src/library/validation.ts
      sha256: dae9300aea522c8aee83ef09e6716f31cd17f0cf6fb6df537218ecb72c63419d
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
sidebar:
  hidden: true
head:
  - tag: title
    content: fillet — Code3D TypeScript API reference
---

Round selected edges of a solid with a constant radius.

## Example

```ts
import {box} from '@code3d/core';

export const rounded = box(30, 16, 20).fillet(2, [2, 4, 6, 8]);
```

![Round selected edges of a solid with a constant radius.](../../../web/src/assets/models/solid-fillet.png)

Complete example: [solid operations](../../../app/examples/operations/solid-operations.ts).

## Signature

```ts
model.fillet(radius: number, edgeIds?: readonly EdgeId[]): SolidModel<Elements>;
```

Import the functions and named types from `@code3d/core`.

## Parameters and result

| Parameter | Meaning                                                         |
| --------- | --------------------------------------------------------------- |
| `radius`  | Positive finite distance in model units; required in TypeScript |
| `edgeIds` | Optional readonly array of IDs from the input solid             |

Omit `edgeIds` to round all edges. An explicit empty array is rejected. Duplicate
IDs are accepted and resolved once, in the input topology's order. IDs must be
positive integers or paths of at least two positive integers; for example
`[2, 4]` selects two edges, while `[[2, 4]]` selects one inherited edge. Unknown
or retired IDs throw rather than silently selecting another edge.

The App can supply `radius = 1` while editing an incomplete call. Completed
TypeScript calls should specify the value. In the example, IDs 2, 4, 6 and 8
select the four edges parallel to Y on the input box.

## Frame, members and topology

The method returns a new `SolidModel<Elements>` and keeps the input local frame,
placement, material and exposed interface. It does not mutate the input.
Surviving one-to-one topology retains its full ID; replaced edges are retired and
new faces or edges receive fresh IDs. A preserved TypeScript interface does not
guarantee that every exposed topology reference survives the edit.

Pick the next operation's IDs from the current result. See
[topology lineage](../topology.md#ids-belong-to-a-model). The method is available
on solids only; it is not a free function and cannot round a standalone curve.

## Geometry limits

A positive value is not enough to guarantee a buildable result. Small faces,
tight corners, interacting modifications and excessive `radius` can cause
degenerate or self-intersecting geometry. The kernel may propagate an edge
selection along tangent contours. Failures identify the requested edges and
amount, and may report that contour expansion.

Try a different amount or a smaller edge selection when construction fails.
A chamfer creates a flat bevel instead of a rounded transition; see [chamfer](chamfer.md).
Use [shell](shell.md) to create hollow walls.
