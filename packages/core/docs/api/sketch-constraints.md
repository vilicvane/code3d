---
title: Sketch constraints
description: Constrain sketch points and curves while preserving explicit geometric freedom.
sourceReview:
  packageVersion: 0.0.1-alpha.17
  sources:
    - path: packages/core/src/library/sketch-solve-model.ts
      sha256: fbcc49233a2e3242abb2eeaf232f8c731deeb0857cdb975ad77f05e690c6bf29
    - path: packages/core/src/library/sketch-solve-analysis.ts
      sha256: 2b54edc7f5bf1a1ddd34215b784f66866601bd8cda34095b088fe23bcc32c272
    - path: packages/core/src/library/sketch.ts
      sha256: 805a2f412703c50b2c9cd30ade43b682f5085155795d038efd00cd1aaaf2b018
    - path: packages/core/src/library/sketch-solver.ts
      sha256: ff7805f44d03438cf20333d56aa33a41ca829cf94b3ead98d6bac20303ed8ded
    - path: packages/core/src/library/sketch-drag-rules.ts
      sha256: 11d13103949d4455c546ddf47b2d99edbdd106060f4b281ae1b5c8f05f25c6e4
    - path: packages/core/src/library/sketch-incidence.ts
      sha256: 1fb5fe3e23476131948fb6491cd78004ca69d20e872aa43df595ea479514b270
sidebar:
  hidden: true
head:
  - tag: title
    content: Sketch constraints — Code3D TypeScript API reference
---

Constrain sketch points and curves while preserving explicit geometric freedom.

## Example

```ts
import {sketch} from '@code3d/core';

export const constrainedProfile = sketch(
  [
    ['point', 1, [0, 0]],
    ['point', 2, [40, 0]],
    ['point', 3, [40, 25]],
    ['point', 4, [0, 25]],
    ['line', 5, [1, 2]],
    ['line', 6, [2, 3]],
    ['line', 7, [3, 4]],
    ['line', 8, [4, 1]],
  ],
  {
    constraints: [
      ['fixed', 1],
      ['horizontal', 5],
      ['horizontal', 7],
      ['vertical', 6],
      ['vertical', 8],
      ['length', 5, 40],
    ],
  },
);
export const constrainedPart = constrainedProfile.face().extrude(3);
```

![Constrain sketch points and curves while preserving explicit geometric freedom.](../../../web/src/assets/models/sketch-constraints.png)

Complete example: [sketch API example](../../../app/examples/sketches/sketch-api.ts).

## Signature

```ts
type SketchOptions = Readonly<{constraints?: readonly SketchConstraint[]}>;
// P defaults to number | SketchPoint; tuples below are readonly.
type SketchConstraint<P = number | SketchPoint> =
  | readonly ['fixed', P]
  | readonly ['horizontal' | 'vertical', number]
  | readonly ['parallel' | 'perpendicular', readonly [number, number]]
  | readonly ['equalLength' | 'equalRadius', readonly [number, number]]
  | readonly ['pointOn', readonly [P, number]]
  | readonly ['tangent', readonly [number, number], ('external' | 'internal')?]
  | readonly ['angle', readonly [number, number], number]
  | readonly ['coincident', readonly [P, P]]
  | readonly ['midpoint', readonly [P, P, P]]
  | readonly ['length' | 'angle' | 'radius' | 'sweep', number, number]
  | readonly ['x' | 'y', P, number];
```

Import the functions and named types from `@code3d/core`.

## Constraint tuples

Pass constraints in the second argument of [sketch](sketch.md) or
[derive](sketch-derive.md). They have no persistent IDs; an array index identifies
a condition only in the current definition. Numbers referring to points or
curves are local IDs. Point targets may also be upstream `SketchPoint` values;
curve targets must be local curves of the required kind. Construction curves
participate in the same constraint solve; the auxiliary type prefix only excludes
them from face boundaries.

| Tuple                                | Condition and allowed targets                                      |
| ------------------------------------ | ------------------------------------------------------------------ |
| `['fixed', point]`                   | Keep both current coordinates of one point                         |
| `['x', point, value]`                | Set the point's sketch X coordinate to a finite value              |
| `['y', point, value]`                | Set sketch Y, which maps toward model -Z                           |
| `['coincident', [a, b]]`             | Make two point positions equal without merging authored IDs        |
| `['midpoint', [middle, start, end]]` | Place middle at the arithmetic midpoint of start/end               |
| `['horizontal', line]`               | Equal endpoint Y coordinates for a local line                      |
| `['vertical', line]`                 | Equal endpoint X coordinates for a local line                      |
| `['length', line, value]`            | Positive finite local line length in model units                   |
| `['angle', line, degrees]`           | Directed local line orientation relative to +X                     |
| `['parallel', [a, b]]`               | Parallel directions for two distinct local lines                   |
| `['perpendicular', [a, b]]`          | Perpendicular directions for two distinct local lines              |
| `['equalLength', [a, b]]`            | Equal lengths for two distinct local line segments                 |
| `['equalRadius', [a, b]]`            | Equal radii for two distinct local circles or arcs                 |
| `['pointOn', [point, curve]]`        | Point on a local finite line segment, circle or finite arc         |
| `['tangent', [a, b], mode?]`         | Tangent contact between a line and circle/arc, or two circles/arcs |
| `['angle', [a, b], degrees]`         | Signed rotation from first authored line direction to second       |
| `['radius', curve, value]`           | Positive finite radius of a local circle or arc                    |
| `['sweep', arc, degrees]`            | Local arc sweep magnitude, strictly between 0 and 360              |

Midpoint does not require a line entity between its endpoint references. Parallel
and perpendicular constrain directions even when the finite segments do not
intersect. `length` here is a line constraint, distinct from a B-Rep edge's
[readonly length measurement](length.md).

## Persistent geometric relationships

These conditions run whenever the source evaluates, including after changing a
dimension or recomputing a derived layer. Equal length compares line segments,
not arc lengths. Equal radius accepts circle–circle, circle–arc and arc–arc pairs.
Both preserve remaining position and direction freedom.

`pointOn` leaves the point free to slide along the curve, within its finite
extent. A point on a line's extension or the unused part of an arc's supporting
circle does not satisfy the condition. Curve endpoints are included. A point
may refer to an upstream `SketchPoint`, but the target curve must be local and
the upstream point remains read-only.

`tangent` also requires the contact point to belong to both finite curves.
For two circles or arcs, omitted mode means `'external'`; use `'internal'` for
one circle touching the other from inside. The mode refers to their supporting
circles. For a line and circle/arc, omit mode. Two lines are not valid tangent
targets. The relation does not create an authored contact point or merge point
identities. Incompatible fixed positions, radii or finite extents fail the solve.

Try the [persistent relationships example](../../../app/examples/sketches/persistent-constraints.ts).
Change `holeRadius` from `8` to `6`: both holes shrink, the lower hole stays
tangent to its construction guide, and both centers stay on the plate's median.
The two sloping edges retain equal length.

## Angles and orientation

Angular values use degrees and must be finite. Line orientation measures from
+X toward +Y counterclockwise in sketch coordinates. Two-line angle uses authored
start-to-end directions; reversing one tuple's endpoints changes that datum.
Angles are equivalent modulo 360. Parallelism allows either direction sense;
use the signed angle form when that distinction matters.

Arc `sweep` is positive magnitude. The arc entity's `cw` or `ccw` chooses its
sense. It cannot represent a full circle; use a circle entity instead. Arc
endpoint-on-circle equations are maintained automatically, without extra authored
constraints or separate persistent angle parameters.

## Freedom, aliases and upstream points

The example fixes the lower-left point and width while leaving the rectangle's
height free. Underconstrained sketches are valid. Initial coordinates help select
a solution; they do not imply fixed positions. `fixed` captures the current point
position when constructing that definition.

Aliases already share coordinates and need no coincidence condition. Upstream
geometry in a derived layer is read-only. Constraints may refer to it but cannot
move it; a condition contradicting a locked coordinate or radius fails. Adding
redundant conditions does not add useful design information; tool snapshots
report redundant constraint indices and remaining degrees of freedom.

## Failures and editor gestures

Missing targets, wrong curve kinds, repeated curve IDs in a pair condition,
nonfinite values and invalid positive dimensions throw. Inconsistent or
numerically unsolved systems throw `SketchConstraintError` from the tooling
entry when the solver can identify the failure. Its constraint indices are
zero-based and evaluation-local; do not store them as entity IDs. Some malformed
inputs throw ordinary validation errors before solving.

Dragging uses temporary preferences in addition to these hard conditions; it
does not silently add `fixed` or `radius` tuples. Read-only upstream geometry and
hard constraints take precedence over the pointer. See the [editor workflow](../sketches.md)
for selection, dimension tools and drag behavior.

GUI constraint edits synchronize solved editable coordinates in the same undo
step. Drawing and dragging can add visible snap relationships as authored
constraints. Both GUI edits and ordinary source evaluation use those constraints;
coordinates that happen to lie on a curve or form a tangent do not imply a
relationship. After removing a constraint, the old contact is free to separate.
