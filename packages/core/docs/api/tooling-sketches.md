---
title: Sketch snapshots and solving
description: Snapshot sketch layers, retain point identities and run the same constrained solver used for evaluation and dragging.
sourceReview:
  packageVersion: 0.0.1-alpha.16
  sources:
    - path: packages/core/src/library/sketch-solver.ts
      sha256: 176f9f8a38507100328aaba71a2ef226b6e914e5718cf3a00b2bc018a7bab565
      commit: 63b63837410721d7f9c44db1e721e5c52250f8d4
    - path: packages/core/src/library/sketch.ts
      sha256: a10941c6a1bba4b92ab8c7d84a3ec1a09758c41aa72dfd754ffb08402db42832
    - path: packages/core/src/library/sketch-incidence.ts
      sha256: 187cca5b0b2c8fd49713400de40911f04cf7d0878e77dd0a97483e26977166db
sidebar:
  hidden: true
head:
  - tag: title
    content: Sketch snapshots and solving — Code3D TypeScript API reference
---

Tooling hosts use these APIs to snapshot sketch layers, retain point identities and run the same constrained solver used for evaluation and dragging.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {sketch} from '@code3d/core';
import {
  snapshotSketch,
  solveSketchSnapshot,
  sketchPointResolver,
} from '@code3d/core/tooling';

const profile = sketch([
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 5]],
]);
const snapshot = snapshotSketch(profile, () => 'profile');
const solved = solveSketchSnapshot([snapshot]);
const resolvePoint = sketchPointResolver([solved]);
const center = resolvePoint({layer: 'profile', id: 1});
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## Definitions, frames and identity

`isSketch(value)` is the runtime guard. `sketchDefinition(sketch)` returns the
current solved definition: optional `base`, original `input` / `inputOptions`
for source tracing, authored `entries`, `constraints`,
resolved `points`, `radii`, `degreesOfFreedom` and `redundant` constraint indices.
Treat this runtime-owned definition as read-only; change authors through the
public [sketch API](sketch.md).

`sketchSource(value)` is the previous spatial value sharing that geometry
definition; it is not the base of a derived sketch layer. `sketchFrame(value)`
returns its relation participant, also inherited by generated faces. Its concrete
frame class and definition types are inferred from these calls; they are not
separate named imports from the tooling entry.

`snapshotSketch(value, identity)` records only the layer's own entities and
constraints. Supply a stable, unique string identity per sketch layer; the `base`
field links its lineage. Point references use `{layer, id}`, including aliases
that retain an authored local ID while referencing the same upstream point.
Do not use array order as a persistent entity identity.

`sketchPointResolver(layers)` returns an address-to-canonical-address function.
Supply the complete base-to-derived lineage. It resolves aliases, rejects missing
points and detects alias cycles; it does not itself return point coordinates.

## Solving and dragging

`installSketchSolver(instance)` installs the initialized PlaneGCS module before
constrained solves. `solveSketchSnapshot(layers, edit?)` solves the final local
layer with upstream layers available as fixed references. It returns a new local
snapshot, with solved parameters, degrees of freedom and redundant constraints.
The arrays must contain at least the local layer in base-to-derived order.

A drag specifies a local point `id` and 2D `position`. Its optional `reference`
is gesture-start geometry, while the current snapshot supplies the numeric seed.
Optional `locks` are edit-only `{id, parameter, value}` parameter locks;
they are not new authored constraints. Source replay should call
`sketchConnectionsPreserved(layers, reference)` before accepting the edit; it
returns false if an edit-start point-on-curve connection was lost. The reference
and replay must share the same entity topology and layer identities.

An edit with `reference` and no pointer `id` / `position` applies the current
snapshot's constraints while retaining connections from that reference. Seed
the snapshot with the edit-start geometry and the newly evaluated constraints.
Lines and arcs retain finite bounds; points and radii prefer their original
values where the constraints leave freedom. Both interactive modes keep the input
snapshot's constraint metadata. Persist only editable parameters, replay the
ordinary source solve, and use that replay's constraint metadata and geometry
for the final view. Neither edit-only connections nor parameter locks become
persistent constraints.

`sketchDragRequiresSolver(layers)` detects local constraints, arcs or incidences
requiring the solver. It is not a test that the sketch is fully constrained.
`SketchConstraintError` extends `Error` and exposes readonly `constraints` indices
for the reported conflict, together with the normal error message. Indices and
`redundant` entries belong to the current constraint array, not persistent IDs.

## Entity parameter arrays

`sketchEntityParameters(entity)` returns `[x, y]` for an unaliased point,
`[radius]` for a circle or arc, and `[]` for lines and aliased points.
`withSketchEntityParameters(entity, parameters)` returns the corresponding new
record (or the unchanged line/alias). Supply the exact parameter count and valid
numbers; this helper is not a high-level validation or constraint solver.

## Snapshot branches

`SketchEntitySnapshot` is the point/line/circle/arc union below. Points have
`position` and optional `alias`; lines hold two point addresses; circles have a
center address and radius; arcs add endpoint addresses and `direction`. All three
curve snapshots normalize the authored `aux:` prefix to optional `construction`,
retained by solving and numeric
parameter updates. It affects region extraction, not solver participation.
`SketchSnapshot` has `id`, optional `base`, local `entities`, address-based
`constraints`, `degreesOfFreedom` and `redundant` indices.

Shared authoring types are documented on [sketch](sketch.md),
[entity tuples](sketch-entities.md), [constraints](sketch-constraints.md) and
[derived layers](sketch-derive.md). `SketchPosition` is a readonly 2D tuple;
`SketchArcDirection` is `'cw' | 'ccw'`. Geometry utilities and closed regions are
covered by [sketch curves and regions](tooling-sketch-curves.md).

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### SketchConstraintError

```ts
class SketchConstraintError extends Error {
  readonly constraints: readonly number[];
  constructor(constraints: readonly number[], message: string);
}
```

### installSketchSolver

```ts
function installSketchSolver(instance: ModuleStatic): void;
```

### sketchConnectionsPreserved

```ts
function sketchConnectionsPreserved(
  layers: readonly SketchSnapshot[],
  reference: SketchSnapshot,
): boolean;
```

### isSketch

```ts
function isSketch(value: unknown): value is Sketch;
```

### sketchDefinition

```ts
function sketchDefinition(value: Sketch): Definition;
```

### sketchDragRequiresSolver

```ts
function sketchDragRequiresSolver(layers: readonly SketchSnapshot[]): boolean;
```

### sketchEntityParameters

```ts
function sketchEntityParameters(
  entity: SketchEntitySnapshot,
): readonly number[];
```

### sketchFrame

```ts
function sketchFrame(value: Sketch): SketchFrame;
```

### sketchPointResolver

```ts
function sketchPointResolver(
  layers: readonly SketchSnapshot[],
): (ref: SketchPointAddress) => SketchPointAddress;
```

### sketchSource

```ts
function sketchSource(value: Sketch): Sketch | undefined;
```

### snapshotSketch

```ts
function snapshotSketch(
  value: Sketch,
  identity: (sketch: Sketch) => string,
): SketchSnapshot;
```

### solveSketchSnapshot

```ts
function solveSketchSnapshot(
  layers: readonly SketchSnapshot[],
  edit?: Readonly<{
    /** Edit-start geometry; previous-frame geometry remains the numeric seed. */
    reference?: SketchSnapshot;
    /** Numeric, edit-only parameter locks; never author constraints. */
    locks?: readonly Readonly<{
      id: number;
      parameter: number;
      value: number;
    }>[];
  }> &
    (
      | Readonly<{id: number; position: SketchPosition}>
      | Readonly<{reference: SketchSnapshot}>
    ),
): SketchSnapshot;
```

### withSketchEntityParameters

```ts
function withSketchEntityParameters(
  entity: SketchEntitySnapshot,
  parameters: readonly number[],
): SketchEntitySnapshot;
```

### Sketch

Re-exported authoring type. See [Sketch](sketch.md) for its complete contract and member behavior.

### SketchArcDirection

Re-exported authoring type. See [SketchArcDirection](sketch-entities.md) for its complete contract and member behavior.

### SketchArcSnapshot

```ts
type SketchArcSnapshot = Readonly<{
  kind: 'arc';
  id: number;
  center: SketchPointAddress;
  radius: number;
  points: readonly [SketchPointAddress, SketchPointAddress];
  direction: SketchArcDirection;
  construction?: boolean;
}>;
```

### SketchCircleSnapshot

```ts
type SketchCircleSnapshot = Readonly<{
  kind: 'circle';
  id: number;
  center: SketchPointAddress;
  radius: number;
  construction?: boolean;
}>;
```

### SketchConstraint

Re-exported authoring type. See [SketchConstraint](sketch-constraints.md) for its complete contract and member behavior.

### SketchEntitySnapshot

```ts
type SketchEntitySnapshot =
  | SketchPointSnapshot
  | SketchLineSnapshot
  | SketchCircleSnapshot
  | SketchArcSnapshot;
```

### SketchEntry

Re-exported authoring type. See [SketchEntry](sketch-entities.md) for its complete contract and member behavior.

### SketchLineSnapshot

```ts
type SketchLineSnapshot = Readonly<{
  kind: 'line';
  id: number;
  points: readonly [SketchPointAddress, SketchPointAddress];
  construction?: boolean;
}>;
```

### SketchOptions

Re-exported authoring type. See [SketchOptions](sketch.md) for its complete contract and member behavior.

### SketchPointAddress

```ts
type SketchPointAddress = Readonly<{
  layer: string;
  id: number;
}>;
```

### SketchPointSnapshot

```ts
type SketchPointSnapshot = Readonly<{
  kind: 'point';
  id: number;
  position: SketchPosition;
  /** Same geometric point, retaining this authored ID for references. */
  alias?: SketchPointAddress;
}>;
```

### SketchPosition

Re-exported authoring type. See [SketchPosition](sketch-entities.md) for its complete contract and member behavior.

### SketchSnapshot

```ts
type SketchSnapshot = Readonly<{
  id: string;
  base?: string;
  entities: readonly SketchEntitySnapshot[];
  constraints: readonly SketchConstraint<SketchPointAddress>[];
  degreesOfFreedom: number;
  /** Evaluation-local indices into constraints, not persistent identity. */
  redundant: readonly number[];
}>;
```
