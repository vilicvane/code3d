---
title: Sketch face and faces
description: Extract finite faces from closed sketch boundaries, including holes and separate regions.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/sketch.ts
      sha256: d50769e828b4ab70584e1a217c6022d3a1c254a825bcc24bd5444039ef0e6488
      commit: e29dfd1ac9d22a728186d68bdd9129b60c908091
    - path: packages/core/src/library/sketch-regions.ts
      sha256: 62233d8c0216d2c4106b4b62a46b7a161f3a7da842f55ec130697869989c9d90
      commit: 05622140a97db31781700f6cb55e6ac7a36029ad
    - path: packages/core/src/library/sketch-face.ts
      sha256: d7e04ff3e3e17766080f0c4916114d2ec97b42b0bcfd57c9df88d3726c2ba51c
      commit: 05622140a97db31781700f6cb55e6ac7a36029ad
    - path: packages/core/src/library/runtime.ts
      sha256: e3658b0ffa55da9d2c612f442ce1d5f190923aea1870122823677faa60fb0b84
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

Extraction includes all local and upstream-layer boundaries. Separate contours
produce separate faces. Nested contours alternate material, holes and islands:
an outer circle with an inner circle gives one annular face; a third circle
inside that hole adds another material island. Standalone point entities do not
create regions, and aliases do not duplicate boundaries.

Lines and arcs must form closed, nonbranching contours. Open, crossing, touching,
overlapping, degenerate or branching boundaries report an error; extraction does
not infer arbitrary trims or split a crossing into regions. Complete or trim
these boundaries before requesting a face. An unfinished sketch remains useful
for editing and inspection even when face construction cannot succeed.

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
