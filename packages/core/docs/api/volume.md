---
title: volume
description: Read the volume occupied by solid material, excluding holes and cavities.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: 1caf8c92de983f0c22b4da70e0af4216472b9ff8fe8e2f0ebc34ec9a84e259b0
    - path: packages/core/src/library/topology.ts
      sha256: f9f0d048fe30cc80046a25123aa8101ca51e85cdb5b2e66260c6a68f43f84715
      commit: 67228dd8559d584852df7bfbd47ed89f1d8003e9
sidebar:
  hidden: true
head:
  - tag: title
    content: volume — Code3D TypeScript API reference
---

Read the volume occupied by solid material, excluding holes and cavities.

## Example

```ts
import {box, group, tube} from '@code3d/core';

const block = box(20, 30, 10);
const pipe = tube(15, 10, 40).originOffset(-60, 0, 0);

// Select .volume to inspect the solid and the space occupied by its material.
const blockVolume = block.volume; // 6000
const pipeVolume = pipe.volume; // 5000 * Math.PI; the bore is excluded.
const enlargedVolume = block.scaled(2).volume; // 48000

export default group([block, pipe]);
```

![Read the volume occupied by solid material, excluding holes and cavities.](../../../web/src/assets/models/volume.png)

Complete example: [measurement example](../../../app/examples/operations/volume.ts).

## Signature

```ts
solidModel.volume: number;
solidReference.volume: number;
```

Import the functions and named types from `@code3d/core`.

## Receivers and units

`SolidModel` and an exposed `Solid` reference provide readonly `volume` in cubic
model units. It measures material occupancy. Through-holes, bores and enclosed
cavities are excluded. The example's block has volume 6000; the tube has volume
`5000 * Math.PI`, and scaling the block by 2 produces 48000.

Faces, edges, vertices, infinite anchors and groups do not have this property.
Summing group-member volumes counts overlapping parts separately. Use
[union](union.md) first when measuring the fused occupied region is intended.

## Transforms and measurement lifetime

Rotations, origin edits and placement preserve volume. Positive uniform
[scaled](scaled.md) multiplies volume by the cube of the scale factor. An exposed
solid reference includes the scale of its selected geometry.

This getter returns an ordinary number computed now. Creating a cut, shell or
other new model later does not update an old numeric result. Read the property
from the result you intend to measure. Kernel integration uses floating-point
arithmetic, so comparisons should allow a suitable tolerance.

## Inspection

Select `.volume` in App to show the solid and its volume label at the volume
centroid. The display uses the recorded result and does not create an editable
dimension. Use [area](area.md) for total boundary surface and [bounds](bounds.md)
for axis-aligned extents; their product is generally not the material volume.
