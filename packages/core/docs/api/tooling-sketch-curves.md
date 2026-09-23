---
title: Sketch curves and regions
description: Evaluate analytic sketch curves, find intersections and extract finite closed regions from snapshot layers.
sourceReview:
  packageVersion: 0.0.1-alpha.16
  sources:
    - path: packages/core/src/library/sketch-curve-intersections.ts
      sha256: f61343b0b2e0e7a5917f21f6846b8a639136bedbd369919226406350701c3aa6
      commit: 9c1b6ae059ec9b0c1c9be31d6f9fad3749a5732b
    - path: packages/core/src/library/sketch-curves.ts
      sha256: 943169600e554a0f24d2b9dc14aef5d201538199fdffa3d0463b93d7f257ce64
      commit: 81c6e51b8e207da937338763e45f27d3469ae097
    - path: packages/core/src/library/sketch-precision.ts
      sha256: 6c86bbf71f337099519045cc68944247c009da4e9887abdf8a9af6712f486144
      commit: 81c6e51b8e207da937338763e45f27d3469ae097
    - path: packages/core/src/library/sketch-regions.ts
      sha256: 3519e575f6eaccc71b549176e937e86d3dd077df100829a9b3d5928e6a163c01
sidebar:
  hidden: true
head:
  - tag: title
    content: Sketch curves and regions — Code3D TypeScript API reference
---

Tooling hosts use these APIs to evaluate analytic sketch curves, find intersections and extract finite closed regions from snapshot layers.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {
  sketchArcGeometry,
  sketchCurvePosition,
  sketchCurveClosestParameter,
  sketchCurveIntersections,
  type SketchCurve,
} from '@code3d/core/tooling';

const arc = sketchArcGeometry([0, 0], [5, 0], [0, 5], 'ccw');
const midpoint = sketchCurvePosition(arc, 0.5);
const nearest = sketchCurveClosestParameter(arc, [4, 4]);
const line: SketchCurve = {
  kind: 'line',
  points: [
    [0, 0],
    [6, 0],
  ],
};
const contacts = sketchCurveIntersections(line, arc);
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## Analytic coordinates

These helpers use 2D sketch coordinates. `SketchCurve` contains a finite line
segment (`points`), a circle (`center`, `radius`), or an arc (`center`, `radius`,
`start`, `sweep`). Arc `start` and signed `sweep` are **radians**, unlike the
public authored sketch sweep constraint's degrees. Curve parameters are local
calculation values, never authored IDs.

| Function                                           | Behavior                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sketchPositiveAngle(angle)`                       | Wrap radians into `[0, 2π)`.                                                                                                                          |
| `sketchArcGeometry(center, start, end, direction)` | Build an arc from points and cw/ccw sense; radius comes from the center-to-start distance. Supply valid consistent endpoints.                         |
| `sketchCurveGeometry(entity, point)`               | Resolve snapshot addresses through the supplied coordinate function; point entities return `undefined`. Arc radius uses the snapshot's solved radius. |
| `sketchCurvePosition(curve, t)`                    | Evaluate line interpolation, a full circle turn, or an arc fraction. The usual finite domain is `0 ≤ t ≤ 1`; this function does not clamp inputs.     |
| `sketchCurveClosestParameter(curve, position)`     | Nearest finite parameter, including arc endpoints rather than its full circle.                                                                        |
| `sketchCurveBounds(curve)`                         | Return extreme candidate points sufficient for 2D bounds; this is not a `{minimum, maximum}` record.                                                  |
| `sketchCurveTolerance(curve)`                      | Geometry-relative tolerance including floating-point coordinate scale.                                                                                |
| `sketchCurveIntersections(first, second)`          | Finite contacts with coordinates and parameters ordered `[first, second]`.                                                                            |

Inputs should already describe valid, solved geometry; low-level helpers do not
repeat all authoring validation. Intersections are ordered along the first curve and include finite overlap
boundaries. Coincident full circles have no isolated boundaries and return no
contacts; an empty result alone is not proof of disjoint geometry.
Intersections are geometric contacts, not an
instruction to split the authored curves or assign new stable IDs.

## Regions

`sketchRegions(layers)` reads complete snapshot lineage and returns connected
material regions, ignoring snapshot curves marked `construction: true` in every
layer. Analytic curve and intersection helpers still include those curves for
editing and snapping. Each `SketchRegion` has one ordered `outer` boundary and zero
or more `holes`, all arrays of analytic curves. Nested closed loops alternate
material and holes; separate islands become separate regions.

Analytic intersections split finite boundaries for region extraction. Directed
edge traversal retains bounded cells and discards open tails and bridges; authored
entities and IDs stay unchanged. Nested contours still alternate holes and islands.
Duplicate or partially overlapping boundaries throw diagnostics. Open-only and
point-only sketches yield no regions. Region order and kernel wires are not
persistent entity identities. Use public [face / faces](sketch-faces.md) to construct
CAD models and [sketch snapshots](tooling-sketches.md) for resolved layer data.

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### sketchCurveIntersections

```ts
function sketchCurveIntersections(
  first: SketchCurve,
  second: SketchCurve,
): readonly SketchCurveIntersection[];
```

### SketchCurveIntersection

```ts
type SketchCurveIntersection = Readonly<{
  position: SketchPosition;
  parameters: readonly [first: number, second: number];
}>;
```

### sketchArcGeometry

```ts
function sketchArcGeometry(
  center: SketchPosition,
  start: SketchPosition,
  end: SketchPosition,
  direction: SketchArcDirection,
): Extract<
  SketchCurve,
  {
    kind: 'arc';
  }
>;
```

### sketchCurveBounds

```ts
function sketchCurveBounds(curve: SketchCurve): readonly SketchPosition[];
```

### sketchCurveClosestParameter

```ts
function sketchCurveClosestParameter(
  curve: SketchCurve,
  position: SketchPosition,
): number;
```

### sketchCurveGeometry

```ts
function sketchCurveGeometry<E extends SketchEntitySnapshot>(
  entity: E,
  point: (address: SketchPointAddress) => SketchPosition,
): E extends {
  kind: 'point';
}
  ? undefined
  : Extract<
      SketchCurve,
      {
        kind: E['kind'];
      }
    >;
```

### sketchCurvePosition

```ts
function sketchCurvePosition(curve: SketchCurve, t: number): SketchPosition;
```

### sketchCurveTolerance

```ts
function sketchCurveTolerance(curve: SketchCurve): number;
```

### sketchPositiveAngle

```ts
const sketchPositiveAngle: (angle: number) => number;
```

### SketchCurve

```ts
type SketchCurve =
  | Readonly<{
      kind: 'line';
      points: readonly [SketchPosition, SketchPosition];
    }>
  | Readonly<{
      kind: 'circle';
      center: SketchPosition;
      radius: number;
    }>
  | Readonly<{
      kind: 'arc';
      center: SketchPosition;
      radius: number;
      start: number;
      sweep: number;
    }>;
```

### sketchRegions

```ts
function sketchRegions(
  layers: readonly SketchSnapshot[],
): readonly SketchRegion[];
```

### SketchRegion

```ts
type SketchRegion = Readonly<{
  outer: readonly SketchCurve[];
  holes: readonly (readonly SketchCurve[])[];
}>;
```
