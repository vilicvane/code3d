---
title: Sketch face and faces
description: Extract finite faces from closed sketch boundaries, including holes and separate regions.
sourceReview:
  packageVersion: 0.0.1-alpha.16
  sources:
    - path: packages/core/src/library/sketch.ts
      sha256: a10941c6a1bba4b92ab8c7d84a3ec1a09758c41aa72dfd754ffb08402db42832
    - path: packages/core/src/library/sketch-regions.ts
      sha256: 3519e575f6eaccc71b549176e937e86d3dd077df100829a9b3d5928e6a163c01
    - path: packages/core/src/library/sketch-face.ts
      sha256: d7e04ff3e3e17766080f0c4916114d2ec97b42b0bcfd57c9df88d3726c2ba51c
      commit: 05622140a97db31781700f6cb55e6ac7a36029ad
    - path: packages/core/src/library/runtime.ts
      sha256: 1caf8c92de983f0c22b4da70e0af4216472b9ff8fe8e2f0ebc34ec9a84e259b0
      commit: b4fe7de02f59acbd2614a592a4b8ce0586243b22
sidebar:
  hidden: true
head:
  - tag: title
    content: Sketch face and faces — Code3D TypeScript API reference
---

Extract finite faces from closed sketch boundaries, including holes and separate regions.

## Example

```ts
import {sketch} from '@code3d/core';

export const holesProfile = sketch([
  ['point', 1, [-10, 0]],
  ['circle', 2, [1, 3]],
  ['point', 3, [10, 0]],
  ['circle', 4, [3, 3]],
]);
export const regionParts = holesProfile.faces().map(face => face.extrude(5));
```

![Extract finite faces from closed sketch boundaries, including holes and separate regions.](../../../web/src/assets/models/sketch-faces.png)

Complete example: [sketch API example](../../../app/examples/sketches/sketch-api.ts).

## Signature

```ts
sketchValue.face(): FaceModel;
sketchValue.faces(): readonly FaceModel[];
```

Import the functions and named types from `@code3d/core`.

## face

`face()` requires exactly one closed material region and returns one `FaceModel`.
That region can include holes. An empty sketch or multiple disconnected material
regions causes an error with the region count; use `faces()` when several are
intended. This is the bridge from 2D definitions to B-Rep modeling.

## faces

`faces()` returns an ordinary readonly array of all regions. An empty definition
has no regions and returns `[]`. The example returns two radius-3 disks and then
two solids, each with volume `45 * Math.PI`. Array order is not a persistent region
identity and there is no broadcast modeling method on the array. Use `map` for
separate modeling operations or pass a face array to a supported overload such
as [extrude](extrude.md).

## Boundaries, holes and islands

Extraction includes all ordinary local and upstream-layer boundaries.
[Construction curves](sketch-entities.md#construction-geometry) are excluded before
contour validation: they cannot split regions, create holes or prevent a unique
face. A sketch containing only construction geometry returns `[]` from `faces()`
and reports zero regions from `face()`. Separate contours
produce separate faces. Nested contours alternate material, holes and islands:
an outer circle with an inner circle gives one annular face; a third circle
inside that hole adds another material island. Standalone point entities do not
create regions, and aliases do not duplicate boundaries.

Line, circle and arc intersections divide boundaries into finite regions without
changing the authored entities or IDs. An endpoint can meet the interior of another
curve; open tails and bridges do not add regions or invalidate closed areas.
Crossings can create multiple faces: a square with an ordinary diagonal has two,
while making that diagonal auxiliary leaves one. A sketch with only open curves
returns `[]`. Duplicate or partially overlapping boundaries still report an error;
trim the duplicate portions before requesting a face.

## Coordinates and model operations

Sketch `[x, y]` becomes model `[x, 0, -y]`, preserving its authored origin. Faces
inherit the sketch's [placement relations](sketch-relate.md). Positive extrusion
follows the local +Y plane normal; negative extrusion reverses it. Rotating a
face rotates that normal. These are finite model values with ordinary face
capabilities, including area, topology and extrusion.

The returned `FaceModel` does not expose authored sketch point IDs as B-Rep IDs.
Persistent region IDs and general automatic hole correspondence are unavailable.
For [loft](loft.md), use one face per section and observe its supported matching
hole count; a successful face extraction alone does not guarantee any subsequent
solid operation will succeed.
