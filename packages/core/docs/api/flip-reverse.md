---
title: flip / reverse
description: Reverse reference orientation without changing finite geometry or parameter points.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: e3658b0ffa55da9d2c612f442ce1d5f190923aea1870122823677faa60fb0b84
    - path: packages/core/src/library/topology.ts
      sha256: f9f0d048fe30cc80046a25123aa8101ca51e85cdb5b2e66260c6a68f43f84715
      commit: 67228dd8559d584852df7bfbd47ed89f1d8003e9
    - path: packages/core/src/library/spatial.ts
      sha256: 810c4fa69352c26c32fb04a0e7867f6327698e02f3212669f17d777784322a78
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
sidebar:
  hidden: true
head:
  - tag: title
    content: flip / reverse — Code3D TypeScript API reference
---

Reverse reference orientation without changing finite geometry or parameter points.

## Example

```ts
import {line, rectangle} from '@code3d/core';

export const segment = line([0, 0, 0], [10, 0, 0]);
export const backward = segment.reverse();
export const sheet = rectangle(12, 8);
export const downward = sheet.flip();
```

Complete example: [topology and references](../../../app/examples/operations/topology-api.ts).

## Signature

```ts
lineAnchor.reverse(): typeof lineAnchor;
faceAnchor.flip(): typeof faceAnchor;
bound.flip(): Bound;
edgeModel.reverse(): Edge;
faceModel.flip(): Surface;
```

Import the functions and named types from `@code3d/core`.

## reverse

`LineAnchor.reverse()` returns a reference with opposite direction sense.
An `Edge` retains its ID, finite curve, length and reference axes. Its
`start`, `midpoint` and `end` still select the same underlying parameter positions;
reverse does not swap those properties or reverse the stored curve geometry.

Use it when [align](align.md) should match opposite curve directions, or when a
straight [axisLine](axis-line.md) should use the opposite positive rotation sense.
Point membership on a curve ignores direction, so it is unchanged. The original
reference remains unchanged too.

## flip

`FaceAnchor.flip()` returns a reference with reversed normal sense. A selected
`Surface` keeps its ID, finite region, area, position and reference axes. It does
not modify the BRep face or produce a new solid. Plane coincidence can use the
opposite normal, while point-on-surface membership is unchanged.

A `Bound` also supports flip: its boundary stays in place and only its directed
contact sense reverses. `up.flip()` stays on the upper boundary; it does not
select the lower one.

## Model shortcuts return references

`EdgeModel.reverse()` selects its edge and returns an `Edge` reference.
`FaceModel.flip()` selects its surface and returns a `Surface` reference.
These shortcuts do not return new edge or face models. In the example,
`backward.length` remains 10 and `downward.area` remains 96. The results are useful
in constraints and queries, but cannot be passed as standalone geometry children
or as model inputs to extrude, sweep or thicken.

For changing local geometry, use modeling transforms on the original model.
For choosing coordinate zero use the origin methods. Reversing a reference twice
restores its orientation sense; reference object identity is not an equality test
for geometry or topology.
