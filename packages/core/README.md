# `@code3d/core`

The code3d authoring runtime. Model projects install this package directly and
may execute the same ESM TypeScript source in code3d or a supported Node.js
runtime.

The App also offers zero-install authoring with built-in core and screws. When
the project's root `package.json` declares `@code3d/core`, the App uses the
project's installed packages exclusively, including their declarations; missing
dependencies are errors rather than a reason to substitute built-in packages.
Direct Node execution requires installing the project dependencies.

The public API includes solid primitives and Boolean operations, first-class
planar face models (`circle`, `ellipse`, `rectangle`, `regularPolygon`), 3D
curve models (`line`, `arc`, `bezier`, `spline`), point models, and
through-section or spine-guided `loft`. Every geometric model is immutable,
renderable, and relation-aware. Topology capabilities follow dimension:
vertices provide `.vertex(id)`, edges add `.edge(id)`, and faces and solids
add `.surface(id)`; only solids provide `fillet`, `chamfer`, and `shell`. Groups retain
the common relation, expose, and paint capabilities without pretending to
contain geometry. Stable topology references can be used as geometric relation anchors.
`Vertex`, `Edge`, and `Surface` references expose readonly `kind` and `id`
properties. For example, `model.edges().map(edge => edge.id)` collects edge IDs
for a later operation on that model. Their `kind` values are `vertex`, `edge`,
and `surface`; IDs belong to that model and topology kind. Plain named anchors
such as `model.up` do not expose these topology properties.
`relate()` records placement for composition with other values; inspecting or
rendering the resulting value by itself keeps its intrinsic local frame.

## Type imports

Types used by public signatures, generic constraints, and return values are
exported alongside the authoring API, including their named type dependencies.
This includes `ElementKind`, `ModelKind`, `ModelGeometryKind`, `TopologyKind`,
the named-element and expose result types, and the model capability interfaces.

```ts
import type {
  Anchor,
  ElementKind,
  NamedElements,
  SolidModel,
} from '@code3d/core';

type Mount<Kind extends ElementKind> = Anchor<Kind>;
type Part<Elements extends NamedElements> = SolidModel<Elements>;
```

Code3d model types come from `@code3d/core`; Replicad builder types such as
`Shape3D` come from `@code3d/core/replicad`. Type exports do not add runtime
properties or operations. `Quaternion` belongs to the tooling transform API;
author rotations use `rotate(x, y, z)` in degrees.

## Colors

`paint(color)` returns a new model value. On a group, it recursively overrides
every descendant's color, including already-painted parts and nested groups.
The outermost painted group wins within that composition; shared parts retain
their own colors when used elsewhere. Painting the same value again uses the
latest color. Previews and exports use the same effective colors.

```ts
import {box, group} from '@code3d/core';

const redPart = box(10, 10, 10).paint('#ff0000');
const assembly = group([redPart, group([box(4, 4, 4)])]).paint('#345678');
// Both parts in assembly use #345678; redPart still renders red on its own.
```

## Bound relations and rotation

`geometry.on(target.up)` translates the source's matching bounding boundary
onto a directional `Bound`. Targets are `up` (+Y), `down` (−Y), `right` (+X),
`left` (−X), `front` (+Z), and `back` (−Z), in the target model's local frame.
Bounds describe the current finite geometry, including solved children of a
group. They are references owned by the model, not topology surfaces or extra
box models. Their calculation uses analytic geometry independently of meshing.

The source can be a model, vertex, edge, surface, or finite point anchor.
Only the selected geometry contributes its extent. Its support boundary is
computed in the target's direction, even when the geometry is tilted. `on`
never rotates or centers a model. A single contact preserves tangential
position; multiple contacts solve their translation conditions together and
report conflicting positions. Mathematical lines and planes without finite
geometry cannot be sources. Arbitrary models, points, lines, and surfaces
cannot be targets.

```ts
import {box, group} from '@code3d/core';
const base = box(10, 10, 10);
const part = box(20, 20, 20).relate(self => [
  self.on(base.right),
  self.on(base.down),
]);
export default group([base, part]); // part at [15, -15, 0]
```

An explicit `.offset(x, y, z)` pins the matching bound centers in all three
coordinates of the target reference frame, including an all-zero offset.
Repeated offsets add. `bound.flip()` reverses facing and therefore the side
from which the source touches it, while leaving the reference frame unchanged.
Surface `flip()` likewise reverses facing metadata; neither operation mirrors
or rotates geometry. Two flips restore the original facing.

`relate` always owns the placement. These forms are legal:

```ts
part.relate(self => self.on(base.up));
part.relate(() => part.on(base.up));
part.relate(self => base.on(self.up)); // moves part below base
```

References to the original receiver are rebound to the new self. Every
returned relation must involve self or the original receiver. Old model values
and old references keep their meaning.

Explicit rotation belongs to a particular contact chain:

```ts
self.on(base.up).rotate(0, 30, 0);
self.on(base.up).pivot(50, 0, 0).rotate(0, 0, 45);
self.on(base.up).pivotVertex(3).rotate(0, 0, 45);
self.on(base.up).around(base.axis).rotate(30);
```

`pivot` coordinates, `pivotVertex` IDs, and XYZ axes use relate's **self**,
regardless of which side of `on` contains self. Direct rotation uses self's
origin. Angles are degrees, applied X, then Y, then Z. Each pivot or axis
selection lasts for its next rotation; intermediate chains only complete with
`rotate`. An axis reference includes position and direction; external axes use
their resolved composition pose. Rotations compose in call order, following
that chain's contact placement. Other contacts constrain the final pose.
Explicit orientations on one self must agree. Remaining translations minimize
changes at the authored contact stages; duplicate stages do not add bias.

Related objects are solved at composition, Boolean, and loft boundaries.
Standalone views keep the object's own geometry. A group moves its assembled
children rigidly. `expose()` carries finite references into the group frame.
Core and App use the same linear translation solver; there is no automatic
angular solve or extra constraint-solver WASM initialization.

In the App, selecting a directional property shows the target rectangle and
matched source boundary. `pivot` has translation handles, `pivotVertex` uses
self's vertex picker, `around` shows the referenced axis, and `rotate` has
three angle rings or one axis ring. Source edits retain parameter provenance,
preview/cancel behavior, and undo. See the
[bent loft example](../app/examples/bound-rotation.ts).

## Exposed geometry and topology

`expose()` preserves geometry as a reference in the returned model's frame.
A solid, face, edge, or vertex model becomes a `Solid`, `Surface`, `Edge`, or
`Vertex` reference. Existing topology references retain their identity; pure
point, line, plane, and frame anchors retain their reference-geometry meaning.
Named members remain available, including on an exposed group frame.
Selected topology contributes its own finite extent to bound positioning; a
custom model origin does not change that extent.

```ts
const plate = box(32, 4, 24);
const assembly = group([plate]).expose({body: plate, mount: plate.surface(1)});
const boundary = assembly.mount.edges();
const corners = boundary[0].vertices();
const center = assembly.mount.center;
```

References support geometric queries and `on()`. They do not have model
operations such as `rotate`, `scaled`, `fillet`, or `relate`. A relation authored
through `self.mount.center` acts on `self`, including when `self` is an assembly.
Every chained result carries that assembly context while its geometry and IDs
continue to refer to the original immutable source. Exposing an upstream value
captures that source; later modeling operations do not reinterpret its IDs in
a different geometry. To expose result topology, select it from that result.

Subtopology access follows dimension: a surface can query its edges and
vertices, and an edge its vertices. Singular queries validate membership;
plural queries retain authored order and allow `[]`. IDs always use the source
geometry's namespace, so a shared edge has the same ID through either face.
An edge's vertices are its actual topological vertices; a closed edge can have
one vertex. A source used in multiple occurrences must be exposed through the
intended child's reference, such as `left.body`, to select its placement.

Every geometric reference has a local bounding-box `center` point, carried
through rotation and scaling. `Edge.start`, `.midpoint`, and `.end` sample curve
parameters 0, 0.5, and 1; the midpoint need not be the bounding-box center or the
half-length point. These calculated points are anchors, not topology vertices.
`edge.on()` and `surface.on()` use finite geometry extents rather than their
sampled tangent or normal; `.center.on()` uses only the calculated point.

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
changes the default pivot for later explicit rotations. Existing named anchors remain where
they were. The default origin is the model's intrinsic anchor: zero for solids
and profiles, the point itself for points, and the start for curves.
Rotation carries named anchors along with the shape and preserves topology IDs.
`center` starts at the body's local bounding-box center and follows its
translation, rotation, and scaling. It is not recomputed from the rotated
shape's axis-aligned bounds. All geometric models expose this point anchor;
changing the origin leaves it in place. `model.originCenter().originOffset(1, 0, 0)`
sets the origin one local X unit beyond that center.
Changing the origin afterward does not undo geometry already rotated. Existing
bound references retain their captured geometry and facing; newly queried
bounds describe the current model. Origin changes do not shift bound contact. `scaled()` retains its existing
geometric scaling about coordinate zero, including the origin position.
Groups expose composition capabilities rather than these geometric operations.

In the App, origin coordinates and offsets have translation arrows; `originVertex`
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

The App uses the selected runtime's `@code3d/core/tooling` entry, from the project
when core is declared or from the built-in package otherwise. This internal
integration surface evolves with the App during prototyping and does not promise
API stability. It includes topology source identities, assembly transforms, and
calculated-anchor frames alongside origin and spatial-operation snapshots. It
requires installing OpenCascade from that same package dependency graph.
Call `beginModelEvaluation(): void` before each serial source
evaluation to reset source locations, parameter provenance, and operation
traces. Geometry, model identity, relations, and kernel caches are unaffected.
Already-created snapshots keep their previous evaluation's metadata.

Packages may retain model values privately. The App therefore drops its own
references after creating snapshots instead of forcibly disposing every model
it encounters. Unreachable Replicad wrappers release their native resources
through their finalizers; explicit disposal is appropriate only when the caller
owns the complete model lifetime. This boundary is tooling-only: ordinary
model authors do not initialize an evaluation session.

Rendering snapshots contain serializable meshes and model metadata, without
native shapes. File export uses a separate `ModelGeometrySnapshot` retained
by the compiler Worker. Core clones each distinct source shape once; the
compiler releases these copies before the next compilation, when replacing
the runtime, or when it is disposed. The snapshot's shapes are borrowed by
consumers: each export clones them before transformations or consuming kernel
operations and releases its temporary geometry on both success and failure.
Repeated exports therefore preserve the retained geometry and author models.

Core owns snapshot creation; the App owns export placement and file generation,
using Replicad from the same runtime. This division already serves the current
consumers and changes only when a concrete use case calls for it.
