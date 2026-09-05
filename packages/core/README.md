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
contain geometry. Stable topology references can be used as geometric relation anchors.
`relate()` records placement for composition with other values; inspecting or
rendering the resulting value by itself keeps its intrinsic local frame.

## Geometric relations

`relate(self => constraint | constraints)` solves the returned relations
together. `on()` constrains geometry according to the anchors:

| Anchors                           | Hard condition                                       |
| --------------------------------- | ---------------------------------------------------- |
| Point / point                     | Coincident points                                    |
| Point / line or face              | Point lies on the reference line or plane            |
| Line / line                       | Collinear reference lines                            |
| Line / face                       | Reference line lies in the plane                     |
| Face / face                       | Coincident planes with opposing normals              |
| Either anchor is a complete frame | Coincident complete frames with opposing orientation |

Centers and default orientation select among geometrically valid poses;
they do not add hard conditions. Face `.flip()` selects aligned normals.
Line directions are geometrically unoriented; `.flip()` reverses the preferred
direction. Point anchors do not impose orientation. An explicit
`.offset(x, y, z)` pins the source anchor position to that point in the target
anchor's frame, including `.offset(0, 0, 0)`. Repeated offsets add together.

```ts
import {box, group} from '@code3d/core';

const first = box(10, 10, 10);
const second = box(20, 20, 20).relate(self => [
  self.edge(3).on(first.edge(1)),
  self.top.on(first.bottom),
]);
export default group([first, second]);
```

Here the second box is placed at `[5, -15, 0]`. A line anchor represents its
infinite reference line, and a face anchor represents its reference plane;
this does not require finite edges or face boundaries to match. Curved
topology retains the sampled tangent/normal reference frame rather than
constraining complete curves or surfaces to coincide.

Related objects are solved together at composition, Boolean, and loft
boundaries. Models without relations provide fixed references. Each group's
children are solved in its local space, so relating the group moves the
assembled children as one rigid body. `expose()` rebinds member anchors into
that local space. The backend is [`@code3d/solver`](../solver/README.md);
an unsatisfied local solve is reported without claiming proof of infeasibility.

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
when core is declared or from the built-in package otherwise. Protocol 3
requires installing both OpenCascade and the constraint solver from that same
package dependency graph. Call `beginModelEvaluation(): void` before each serial source
evaluation to reset source locations, parameter provenance, and operation
traces. Geometry, model identity, relations, and kernel caches are unaffected.
Already-created snapshots keep their previous evaluation's metadata.

Packages may retain model values privately. Studio therefore drops its own
references after creating snapshots instead of forcibly disposing every model
it encounters. Unreachable Replicad wrappers release their native resources
through their finalizers; explicit disposal is appropriate only when the caller
owns the complete model lifetime. This boundary is tooling-only: ordinary
model authors do not initialize an evaluation session.
