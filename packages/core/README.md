# `@code3d/core`

The code3d authoring runtime. Model projects install this package directly and
may execute the same ESM TypeScript source in code3d or a supported Node.js
runtime.

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
