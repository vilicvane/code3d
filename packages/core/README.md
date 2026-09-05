# `@code3d/core`

The code3d authoring runtime. Model projects install this package directly and
may execute the same ESM TypeScript source in code3d or a supported Node.js
runtime.

Studio also offers zero-install authoring with built-in core and screws. When
the project's root `package.json` declares `@code3d/core`, Studio uses the
project's installed packages exclusively, including their declarations; missing
dependencies are errors rather than a reason to substitute built-in packages.
Direct Node execution requires installing the project dependencies.

The public API includes solid primitives and Boolean operations, first-class
planar face models (`circle`, `ellipse`, `rectangle`, `regularPolygon`), 3D
curve models (`line`, `arc`, `bezier`, `spline`), point models, and
through-section or spine-guided `loft`. Every geometric model is immutable,
renderable, and relation-aware. Topology capabilities follow dimension:
vertices provide `.vertex(id)`, edges add `.edge(id)`, and faces and solids
add `.surface(id)`; only solids provide `fillet` and `chamfer`. Groups retain
the common relation, expose, and paint capabilities without pretending to
contain geometry. Stable topology references can be used as complete relation anchors.
`relate()` records placement for composition with other values; inspecting or
rendering the resulting value by itself keeps its intrinsic local frame.

## Editable sketches

Sketches are immutable 2D definitions, separate from geometric models and B-Reps:

```ts
import {sketch} from '@code3d/core';

const sketch1 = sketch([
  ['point', 1, [0, 0]],
  ['point', 2, [30, 0]],
  ['line', 3, [1, 2]],
]);
const sketch2 = sketch1.derive([
  ['point', 1, [10, 20]],
  ['line', 2, [sketch1.point(2), 1]],
]);
```

Each tuple is `[kind, ID, data]`. Numeric line endpoints name local points;
`sketch1.point(id)` names a point owned by an upstream layer. Each layer has an
independent positive-integer ID space shared by points and lines. Definitions
may be empty, open, or contain crossing lines; crossings do not automatically
split entities. Missing point references are errors.

In Studio, select a sketch expression or variable to open its 2D editor. Add
points or lines, drag literal-coordinate points, and delete local entities.
Deleting a point also deletes connected local lines. Upstream geometry stays
locked but can supply endpoints for new lines. Coordinates using expressions
remain editable in code, not by dragging. The editor preserves existing IDs and
allocates new IDs from the current local maximum, without `nextId` metadata.
Deleted IDs may therefore be reused; downstream references are not automatically
rewritten. Constraint solving, trimming and conversion to faces/solids are not
part of this initial point/line API. See the [sketch example](../app/examples/sketches.ts).

## Origins and rotation

Geometric models (solids, faces, curves, and points) support immutable origin
editing and rotation:

```ts
const part = box(24, 6, 14)
  .originVertex(3)
  .originOffset(0, 2, 0)
  .rotate(15, 35, 0);
```

- `origin(x, y, z)` sets the origin to local geometry coordinates.
- `originVertex(id)` sets it to the selected vertex of the input model.
- `originCenter()` sets it to the model's `center` anchor.
- `originOffset(dx, dy, dz)` adds a local-coordinate offset to the current origin.
- `rotate(x, y, z)` rotates geometry about that origin in degrees, applying
  fixed local X, then Y, then Z rotations. Repeated calls compose in source order.

All three setters replace previous origin settings and accumulated offsets. Setting
an origin leaves geometry in place, preserves the anchor's orientation, and
changes the model's own relation anchor. Existing named anchors remain where
they were. The default origin is the model's intrinsic anchor: zero for solids
and profiles, the point itself for points, and the start for curves.
Rotation carries named anchors along with the shape and preserves topology IDs.
`center` starts at the body's local bounding-box center and follows its
translation, rotation, and scaling. It is not recomputed from the rotated
shape's axis-aligned bounds. All geometric models expose this point anchor;
changing the origin leaves it in place. `model.originCenter().originOffset(1, 0, 0)`
sets the origin one local X unit beyond that center.
Changing the origin afterward does not undo geometry already rotated. Existing
relations retain the source anchor captured when they were authored; relations
created afterward use the updated anchors. `scaled()` retains its existing
geometric scaling about coordinate zero, including the origin position.
Groups expose composition capabilities rather than these geometric operations.

In Studio, origin coordinates and offsets have translation arrows; `originVertex`
uses vertex picking and an origin marker. Dragging an `originCenter()` or
`originVertex()` marker adds or edits an `originOffset()` call. Rotation rings edit the corresponding
angle about its effective axis, including when other angles are nonzero. Dragging
previews the change; release writes source and Escape cancels. The
[origin and rotation example](../app/examples/origin-and-rotation.ts) demonstrates
these scopes.

## Tubes

`tube(outerRadius, innerRadius, y)` creates a concentric, constant-section
straight tube with a through bore. Like `cylinder(radius, y)`, it is centered
at the origin and extends along Y. All dimensions must be positive and finite,
and `innerRadius` must be smaller than `outerRadius`; use `cylinder` for a solid
cross-section. There are no wall-thickness overloads, tapers, or path options.

```ts
import {tube} from '@code3d/core';

export const collar = tube(6, 4, 12).paint('#8ed5d1');
```

## Coils

`coil(coilRadius, wireRadius, pitch, turns)` creates a right-handed coil with a
circular wire section and plain ends. `coilRadius` measures from the Y axis to
the wire centerline, `pitch` is the Y advance per turn, and `turns` can be any
positive finite number, including a fraction. The centerline's Y interval is
centered at the origin; the end sections extend slightly beyond that interval.
The named axis stays on Y even for a partial turn.

All dimensions must be positive and finite. The wire radius must be smaller
than the coil radius, the pitch must exceed the wire diameter, and neighboring
turns must remain separated. This is geometry, not a spring specification:
there are no spring end treatments, force parameters, or material assumptions.

```ts
import {coil} from '@code3d/core';

export const winding = coil(5, 0.75, 4, 2.5).paint('#d8ff3e');
```

See the [primitive showcase](../app/examples/primitives.ts) for a coil composed
with the other built-in primitives.

## Custom primitives

`definePrimitive` turns a synchronous Replicad builder into a normal code3d
solid model. Replicad stays behind an explicit author-interoperability entry so
raw shapes do not become part of the root model API. Import `definePrimitive`
and `replicad` from `@code3d/core/replicad`.

The runnable [custom primitive example](../app/examples/custom-primitives.ts)
builds a twisted knob with a D-shaped shaft bore, then composes two instances.
It demonstrates direct parameter annotations, a default argument, Replicad
extrusion and booleans, and intermediate resource cleanup. The screws package's
private [thread builder](../screws/src/library/thread.ts) is another consumer.
Built-in tubes and coils should be imported directly from core, not reimplemented
in author examples.

The builder's argument types, names, and optional parameters are preserved.
Write validation inside the builder. It executes on every call, including when
the same arguments are reused, so changes to captured state remain observable.
Core caches the actual returned B-Rep, so identical output can reuse downstream
operations and meshes across evaluations without skipping the builder. Each
model owns its disposable geometry and uses the standard mesh tolerance.

Returning a shape transfers its ownership to code3d; do not mutate, delete, or
return it again. Intermediate resources remain the builder's responsibility,
following Replicad's ownership rules. A single-solid aggregate produced by
Replicad booleans is normalized; shells, multiple-solid aggregates, and stray
lower-dimensional geometry are rejected, and rejected returned shapes are
released. Kernel installation and replacement remain owned by code3d.

Place `@code3d.param` annotations directly on the exported function variable to
enable its call-site tool panel, including when consumed through emitted
declarations. No wrapper or definition options are needed. For a standalone
preview, export an ordinary example invocation; `@code3d.arguments`
is not expanded to recognize primitive factory definitions.

## Tooling evaluation lifetime

Studio uses the selected runtime's `@code3d/core/tooling` entry, from the project
when core is declared or from the built-in package otherwise. Protocol 4
adds sketch definitions and layer snapshots to the origin and spatial-operation
snapshots, alongside `beginModelEvaluation(): void`: call it before each serial source
evaluation to reset source locations, parameter provenance, and operation
traces. Geometry, model identity, relations, and kernel caches are unaffected.
Already-created snapshots keep their previous evaluation's metadata.

Packages may retain model values privately. Studio therefore drops its own
references after creating snapshots instead of forcibly disposing every model
it encounters. Unreachable Replicad wrappers release their native resources
through their finalizers; explicit disposal is appropriate only when the caller
owns the complete model lifetime. This boundary is tooling-only: ordinary
model authors do not initialize an evaluation session.
