---
title: Modeling API
description: A curated map of the public core modeling operations.
---

Import these functions from `@code3d/core`. The editor's TypeScript signatures
provide exact overloads and inferred model interfaces.

Types used by the authoring API are also exported, including generic constraints,
named-element result types, and capability interfaces. Use `import type` from
`@code3d/core` for types such as `ElementKind`, `ModelKind`, `ModelForKind`, `TopologyKind`,
`NamedElements`, `ExposedElements`, `Bound`, and `TopologyId`. Replicad builder types such as `Shape3D`
are available from `@code3d/core/replicad` alongside `definePrimitive`.

## Solid primitives

| Function                                     | Meaning                           |
| -------------------------------------------- | --------------------------------- |
| `box(x, y, z)`                               | Box dimensions along X, Y, and Z  |
| `cylinder(radius, y)`                        | Cylinder with its axis along Y    |
| `sphere(radius)`                             | Sphere of the given radius        |
| `frustum(bottomRadius, topRadius, y)`        | Truncated cone                    |
| `regularPrism(radius, y, sides, rotation?)`  | Regular polygonal prism           |
| `tube(outerRadius, innerRadius, y)`          | Straight tube with a through bore |
| `coil(coilRadius, wireRadius, pitch, turns)` | Circular-wire coil along Y        |

Tubes are centered on Y; the inner radius must be smaller than the outer
radius. For coils, `coilRadius` is measured to the wire centerline and
`pitch` is the advance per turn. Fractional turns are supported; the wire
must fit inside the coil radius and neighboring turns must remain separated.
Use [`@code3d/screws`](../screws/) for standard fasteners and matching hole tools.

To build a solid beyond these primitives, import `definePrimitive` and
`replicad` from `@code3d/core/replicad`. See
[custom primitives](../../guides/custom-primitives/) for a complete example.

## Profiles and curves

Planar profiles lie in the local XZ plane with a +Y normal.

| Function                                   | Meaning                                      |
| ------------------------------------------ | -------------------------------------------- |
| `circle(radius)`                           | Circular face                                |
| `ellipse(xRadius, zRadius)`                | Elliptical face                              |
| `rectangle(x, z)`                          | Rectangular face                             |
| `regularPolygon(radius, sides, rotation?)` | Regular polygonal face                       |
| `point()` or `point([x, y, z])`            | Vertex model                                 |
| `line([x, y, z])` or `line(start, end)`    | Straight edge                                |
| `arc(start, middle, end)`                  | Arc through three points                     |
| `bezier(points)`                           | Bézier curve                                 |
| `spline(points)`                           | Interpolating spline                         |
| `loft(sections, options?)`                 | Solid through sections; optional curve spine |
| `extrude(faceOrFaces, distance)`           | Solid extruded along one face's local normal |

See [local coordinates and placement](../../concepts/local-coordinates/) for
the coordinate frame of a model, reference, or composition.

Position coordinates use arrays; dimensions, offsets and angles use scalar
arguments. `point([x, y, z])` equals `point().originOffset(-x, -y, -z)`.
`line([x, y, z])` starts at zero; the two-array form uses both supplied local
endpoints. Curve tangents do not redefine the model's XYZ axes.

Profiles and curves are model values that can be inspected and related to
other models.

Face models also support `face.extrude(distance)`. Both forms accept a finite,
non-zero signed distance and preserve the starting face's coordinates. For an
unrotated profile, positive distance extends along +Y; negative distance extends
along −Y. Rotating the face rotates its extrusion direction; changing its origin
does not recenter the result. The returned solid supports Boolean operations,
fillets, chamfers, and shells. `extrude(faces, distance)` accepts a readonly array
of profiles and returns a readonly array of solids in the same order, preserving
each face's placement. An empty input returns `[]`; a single face still returns
a single solid. Both overloads retain required TypeScript distances and use the
same runtime default of 10 while editing.

```ts
import {circle, extrude, rectangle} from '@code3d/core';

export const plate = rectangle(30, 20).extrude(3).fillet(0.5);
export const pin = extrude(circle(2), -10);
```

## Independent placement transformations

`relate` callbacks return a `Constraint`, a `Transformation`, or a readonly array of both.
Independent constructors are `offset(x, y, z)`, `rotate(x, y, z)`,
`pivot([x, y, z]).rotate(x, y, z)`, `pivotVertex(id).rotate(x, y, z)`,
`pivotPoint(pointRef).rotate(x, y, z)`, `axisEdge(id).rotate(angle)`, and
`axisLine(lineRef).rotate(angle)`. Values can be built in helper functions and reused.

| Selector               | Reference                               |
| ---------------------- | --------------------------------------- |
| `pivot([x, y, z])`     | Coordinates in self                     |
| `pivotVertex(id)`      | A vertex of self                        |
| `pivotPoint(pointRef)` | A local or external point reference     |
| `axisEdge(id)`         | A straight edge of self                 |
| `axisLine(lineRef)`    | A local or external line/axis reference |

Point references change the rotation center while retaining self's XYZ axes.
External references use their owning model's solved placement in the composition.
Curved edges do not define a rotation axis.

Each independent transformation is one completed operation, with no further
chaining methods. Use an array to combine steps: `[offset(0, 8, 0), rotate(0, 25, 0)]`.
These five reference selectors return an unfinished selection with a
`rotate` method; its result is again a completed transformation.
Point selectors additionally accept one `pivotOffset(dx, dy, dz)`; axis selectors
accept one `axisOffset(dx, dy, dz)`. The resulting selector only exposes `rotate`.
Point offsets use self local axes. Axis offsets use the selected axis reference
frame, retaining its direction. Both retain the original point/axis reference.

Consecutive constraints form a joint solve segment. Transformations act after
its result; a subsequent constraint starts another segment and inherits the
previous pose in its free directions. Independent offset uses fixed composition
axes; rotation defaults to the current self origin and local XYZ axes. See
[the complete placement rules](../../guides/relations/#transform-a-joint-result).

## Runtime defaults while editing

The dimension-based primitives and numeric methods below keep their required TypeScript parameters,
but their implementations supply defaults for omitted or `undefined` arguments.
For example, `box()` previews a 10 × 10 × 10 box, while the editor still reports
the missing arguments; `box(20)` previews 20 × 10 × 10. Finish the arguments to
make the source type-correct. These defaults also apply in ordinary JavaScript
execution and do not depend on the App.

| Function         | Runtime defaults, in parameter order |
| ---------------- | ------------------------------------ |
| `box`            | `10, 10, 10`                         |
| `cylinder`       | `5, 10`                              |
| `sphere`         | `5`                                  |
| `frustum`        | `5, 3, 10`                           |
| `regularPrism`   | `5, 10, 6, 0`                        |
| `tube`           | `5, 3, 10`                           |
| `coil`           | `5, 1, 3, 3`                         |
| `circle`         | `5`                                  |
| `ellipse`        | `5, 3`                               |
| `rectangle`      | `10, 10`                             |
| `regularPolygon` | `5, 6, 0`                            |

| Method or utility parameter                         | Runtime defaults |
| --------------------------------------------------- | ---------------- |
| Model/group `rotate` and independent/pivot `rotate` | `0, 0, 0`        |
| Model/group `originOffset` and relation `offset`    | `0, 0, 0`        |
| Relation `pivot`                                    | `[0, 0, 0]`      |
| Selector `pivotOffset` and `axisOffset`             | `0, 0, 0`        |
| `axisLine(axis).rotate`                             | `0`              |
| Geometric model `scaled`                            | `1`              |
| Face `extrude` and the `extrude` utility's distance | `10`             |
| Solid `fillet`, `chamfer` and `shell`               | `1`              |

For example, `box(20, 30, 40).rotate()` previews the unchanged body, and
`.rotate(30)` previews a 30-degree X rotation. Their missing-angle diagnostics
remain until all three arguments are supplied. Relation `offset()` translates
self from the relation's solution in the target reference axes. Like explicit
`offset(0, 0, 0)`, omitting its arguments preserves that solution and adds no
tangential constraints. `pivot()` selects self's local origin. Geometry IDs, reference axes and input
models still need explicit values.

Explicit arguments remain subject to their normal validation: `box(0)`, for
example, still reports an error. The parameter panel shows omitted defaults as
placeholders and only writes arguments when you edit them. See
[parameter defaults](../../guides/model-tools/#describe-an-omitted-arguments-default).

Spatial controls use the rendered operation's position and frame, so omitted
arguments do not hide its translation arrows or rotation rings. Committing a
drag fills all remaining omitted defaults in that call: dragging the X ring of
`rotate()` writes `rotate(angle, 0, 0)`, and dragging `pivot()` writes all three
coordinates. This also applies when editing an existing or upstream parameter.
The parameter change and default completion form one undo step. Merely selecting a
tool, cancelling a drag or returning to its starting value leaves the source
unchanged. Existing editable expressions retain their normal editing behavior;
opaque inputs such as `pivot(coords)` or `rotate(...angles)` are replaced with
the current evaluated coordinates or angles when you commit the drag. Undo
restores the original expression.

## Editable sketch regions

Select a `sketch([...])` expression or variable in the App to open its 2D editor.
Points, lines, circles and arcs use explicit layer-local entity IDs. `face()`
requires exactly one closed region, including holes; `faces()` returns all regions
as an ordinary readonly array. Use `map` for independent modeling operations:

```ts
import {sketch} from '@code3d/core';

const profile = sketch([
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 12]],
  ['circle', 3, [1, 8]],
]);
const sleeve = profile.face().extrude(20);
const parts = profile.faces().map(face => face.extrude(10));
```

Geometry tuples store current data; the second argument's `constraints` array
specifies relations that must remain true. Constraints have no IDs and use
`['kind', target, value?]`. For local lines:

- `['horizontal', line]` and `['vertical', line]` set an axis direction;
  `['length', line, distance]` sets a positive length.
- `['angle', line, degrees]` sets Orientation relative to +X.
- `['parallel', [line1, line2]]` and `['perpendicular', [line1, line2]]`
  relate two lines without requiring their finite segments to intersect.
- `['angle', [line1, line2], degrees]` sets Angle between lines: the signed
  rotation from the first line's authored start-to-end direction to the second,
  positive counterclockwise and equivalent modulo 360.

In Select, an ordinary click or box selection replaces the selection, Ctrl
toggles elements, and Shift only adds them. Drag a box left-to-right for fully
enclosed geometry or right-to-left for intersecting geometry. A multi-selection
can remove any editable local constraint on its elements, while adding one
requires the entire selection to satisfy the tool's prerequisites. Parallel
accepts two or more local lines and creates pairwise relations; Perpendicular
and Angle between lines require exactly two. Rectangle tools still create
horizontal and vertical constraints by default.

Drag an arc endpoint to reshape it while preferring to keep its center in place.
Drag a circle or arc center to move it while preferring to keep its radius
unchanged. Hard constraints, expression-controlled values and read-only upstream
geometry take precedence; these preferences can keep the dragged point from
reaching the pointer. They apply only during the gesture and do not add persistent
fixed or radius constraints. To change an editable radius, drag the curve itself
or edit its source or dimension.
After the gesture-specific preferences, all other points prefer staying near
their gesture-start positions. This lowest-priority step only resolves remaining
freedom: it does not pull back a translated shape, weaken hard constraints or
add fixed-point constraints to the source.

Derived sketches include their read-only upstream boundaries. Separate contours
produce separate faces; nested contours alternate material, holes and islands.
Open, crossing, touching, overlapping and branched boundaries must be trimmed into
valid closed contours before creating faces. The editor leaves unfinished sketches
editable and previews valid regions without changing entity IDs.

Sketch `[x, y]` maps to model `[x, 0, -y]`, without recentering. `.extrude(distance)`
and `extrude(face, distance)` are equivalent single-face operations. Distance must
be finite and nonzero; positive follows the plane normal, negative reverses it.
Rotating the face rotates its extrusion direction too.

`loft` takes one face per section and preserves a single corresponding hole, with
or without a spine. Different hole counts or multiple unpaired holes report an
error rather than silently filling holes. Persistent region IDs and general
multi-hole correspondence are not available yet. Try `examples/sketches/regions.ts`
in the App for a plate, multiple cutting tools and a hollow loft.

### Sketch placement and model context

`sketch.relate(self => self.plane.align(target))` creates an immutable spatial
copy of the same local 2D definition. Empty and open sketches can relate before
`face()` is available. Targets include named model planes and planar
`model.surface(id)` references.

```ts
const host = box(40, 20, 30).rotate(0, 0, 25);
const profile = sketch([
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 4]],
]);
const opening = profile.relate(s => s.plane.align(host.surface(4)));
const result = host.cut([opening.face().extrude(-20)]);
```

Derived layers, faces and extrusion inherit these relations. Plane alignment does
not center on a trimmed face or rewrite sketch coordinates. The relation binds
the referenced immutable host value; later creating another transformed host does
not redirect it. Use `align()`, not finite-bound `on()`, for the sketch's unbounded
reference plane.

Select `opening` in the App to edit with read-only model outlines in the sketch's
local plane, or `profile` for the original local view. Both write the same geometry
array. The outlines do not become snapping targets or external geometry constraints.
See `examples/sketches/mounting-plate.ts` for a slotted plate. Create the relation
in code; selecting a face does not automatically generate a related sketch.

## Composition and boolean operations

| Function               | Result                                        |
| ---------------------- | --------------------------------------------- |
| `group(models, name?)` | Composition that preserves its separate parts |
| `union(solids)`        | Fused solid                                   |
| `cut(stock, tools)`    | Stock with the tool volumes removed           |
| `intersect(solids)`    | Shared solid volume                           |

`group()` accepts a `readonly Model[]`, including ordinary groups, empty groups,
and any depth of nested groups mixed with solids, faces, curves, or points. Each
nested group keeps its hierarchy. No type assertion or `expose()` call is needed
to compose it; use `expose()` when callers need named member references. Generic
helpers can use `ModelCapabilities<Elements, Kind>` and `ModelForKind<Elements, Kind>`
to preserve the concrete model kind and exposed members through chained calls.

Relations are resolved at composition and geometry evaluation boundaries.
`stock.cut(tools)` is equivalent to `cut(stock, tools)`. Arrays in booleans and
loft describe the inputs of one operation; they do not automatically map it.
`intersect()` requires a common solid volume across all inputs. Disjoint inputs
or inputs that only touch produce a diagnostic rather than an empty solid.

## Model operations

Available operations depend on the kind of geometry. TypeScript completion
shows which operations are supported by the value you hold.

- `.fillet(radius, edgeIds?)`: round selected edges, or all edges.
- `.chamfer(distance, edgeIds?)`: bevel selected edges, or all edges.
- `.shell(thickness, removedSurfaceIds?)`: hollow one connected solid. Positive
  thickness offsets inward; negative thickness offsets outward. Selected surfaces
  become openings; omission or `[]` creates an enclosed cavity. See
  [making hollow parts](../../guides/shells/).
- `.scaled(factor)`: uniformly scale a geometric model about local coordinate zero.
- `.material(value)`: replace the complete material with a native Three.js material
  or a CSS color shorthand; a group overrides every descendant's material.
- `.relate(self => constraint)` or `.relate(self => [first, second])`: attach
  one or more relations for placement in a composition.
- `.expose({name: element})`: publish a typed named-element interface.

## Materials

Use [`@code3d/materials`](../materials/) for common plastic, metal, glass,
ceramic and paint presets, such as `.material(aluminum({finish: 'polished'}))`.
Each preset returns a native Three.js material and follows the same rules below.

```ts
import {box} from '@code3d/core';
import {MeshPhysicalMaterial} from '@code3d/core/three';

const part = box(20, 10, 12).material(
  new MeshPhysicalMaterial({
    color: '#eb633e',
    roughness: 0.25,
    clearcoat: 1,
  }),
);
```

`@code3d/core/three` directly re-exports Core's native Three.js classes and types.
Use this entry in the model and its reusable packages to share the same instance.
Named imports and `import * as THREE from "@code3d/core/three"` both work in the
App and Node. Each `.material(value)` call captures a
complete material and its loaded texture pixels. It returns a new model;
subsequent changes to the original Three.js instance do not change that model.
Calling it again replaces everything, without merging fields. An outer group
replaces the material throughout its subtree; original parts used elsewhere
remain unchanged.

Use mesh materials for solids and surfaces, line materials for curves, and
`PointsMaterial` for vertices. Modeling emphasis uses preview copies; Render
mode and PNG images use the authored material. Loaded image, canvas, ImageBitmap,
data and cube textures are supported. Load images with `ImageBitmapLoader` in
the worker before assignment. Native face UVs are normalized to 0–1 per face;
texture `repeat`, `offset` and `rotation` control mapping. See
`/examples/materials.ts` in the App.

The transferable value follows Three.js's `toJSON()` / `MaterialLoader`
representation. Custom classes, callbacks such as `onBeforeCompile`, live
video/render-target textures, compressed/layered textures and manual mipmaps
are rejected. Material-local clipping, shadow-side and precision overrides are
not serialized by Three.js and are also rejected. Shader uniforms must be supported by Three.js JSON.

A CSS string replaces the whole material with the geometry's default material.
It accepts names, `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, `rgb(...)` and
`rgba(...)`. `.material('#f008')` equals `.material('#ff000088')`;
`.material('rgba(255, 0, 0, 0.5)')` and `.material('rgb(100% 0% 0% / 50%)')`
produce half-opaque red. Native materials use Three.js's `opacity` and
`transparent` settings. STEP and 3MF preserve base color and opacity, while
shaders and textures are rendered in PNG; STL contains geometry only.

## Scaling

Solids, faces, curves, and points support `.scaled(factor)`. The factor must be
positive and finite. For example, `box(20, 8, 12).scaled(0.5)` returns a new box
with dimensions 10, 4, and 6, leaving the original model unchanged.

Scaling uses local coordinate zero even after an origin edit. Geometry, named
anchors and the `center` anchor scale together; the model origin stays zero;
topology IDs are preserved. Groups do not provide `.scaled()`; scale their
geometric parts before composing them. To change only an exported file's unit
conversion, use the [export scale](../../guides/exporting/#scale-and-orientation).

## Origins and rotation

All models provide `originPoint()`, `originOffset()` and `rotate()`. Solids, faces,
curves and points additionally provide vertex/center selection:

| Method                      | Behavior                                                      |
| --------------------------- | ------------------------------------------------------------- |
| `.originPoint(pointRef)`    | Set the origin to a point reference, including a group member |
| `.originVertex(id)`         | Set the origin to an input-model vertex                       |
| `.originCenter()`           | Set the origin to the model's center anchor                   |
| `.originOffset(dx, dy, dz)` | Add a local-coordinate offset to the current origin           |
| `.rotate(x, y, z)`          | Rotate about the origin, in degrees, fixed X then Y then Z    |

The origin is always zero in model coordinates. `originOffset(dx, dy, dz)`
re-expresses every local point as `p - [dx, dy, dz]`; offsets accumulate and can
cancel. `originVertex` and `originCenter` make the selected point local zero.
Geometry, named anchors and topology positions use the resulting coordinates;
directions and topology IDs are preserved. Old model values remain unchanged.
Rotation and scaling act about current local zero.

Every geometric model exposes `center`: its initial local bounding-box center,
carried along by subsequent transforms. Rotation does not recalculate it from
the rotated shape's axis-aligned bounds. Origin edits change its coordinates;
`.originCenter().originOffset(1, 0, 0)` leaves it at `[-1, 0, 0]`.
A group inherits the first member's solved local coordinate frame, including
its origin and axes, while preserving relative member placement. Nested groups
keep their own frames; an empty group uses the default origin and axes. Member
order can change the group's frame. Group origin
edits move the entire assembly's local coordinates together; they preserve its
internal relations. `rotate(x, y, z)` turns the solved assembly about its current
origin, including nested instances. `originPoint(part.center)` resolves the member's actual
placement; repeated sources need a specific instance reference. Groups do not
have aggregate vertex IDs, a geometric center or scaling.
See [group coordinates](../../concepts/local-coordinates/#group-origins).

For a runnable example and
the vertex picker, origin arrows, and rotation rings, see
[choosing an origin and rotating a part](../../guides/origins-and-rotation/).

## Anchors and relations

Solid primitives expose `center` and `axis`; every model provides directional
bounds: `up` (+Y), `down` (−Y), `right` (+X), `left` (−X), `front` (+Z),
and `back` (−Z), in that model's local frame.

`geometry.on(target.up)` only translates. The source may be a model, point,
edge, or surface; its own finite extent is measured along the target direction.
Tangential position and orientation are preserved. Targets must be directional
bounds. Infinite reference lines and planes cannot supply a finite source extent.

Return an array from `relate()` to combine positional conditions. Inconsistent
positions report a conflict. `offset(x, y, z)` translates self from the original
solution in the target reference frame. Explicit zero changes nothing; use
point or axis alignment for centering. `bound.flip()` reverses contact
facing without changing geometry or reference axes.

`relate` owns self's placement, allowing `self.on(base.up)`,
`part.relate(() => part.on(base.up))`, and `base.on(self.up)` in the callback.
Returned relations must involve self or the original receiver.

`pointOrCurveOrSurface.align(target)` solves geometric position and orientation.
Same-dimensional references coincide; a lower-dimensional reference lies on the
whole supporting geometry of the other. Edges use their underlying curves and
faces their underlying surfaces, ignoring trims and parameter origins. Supported
types are points, straight lines, circles, ellipses, planes, cylinders, and
spheres. Select a solid's center, axis, vertex, edge, or surface first.

Curve–curve alignment is directed; `lineReference.reverse()` selects the opposite
direction. Surface–surface alignment matches normal sense; `faceReference.flip()`
selects the opposite facing. Neither changes the reference axes or geometry.
Point membership ignores direction. Constraints expose no transformation methods.
Place independent transformations after the constraints in the `relate` array:

- `offset(x, y, z)`: move self along fixed composition axes.
- `rotate(x, y, z)`: rotate around self's origin and local XYZ axes.
- `pivot([x, y, z]).rotate(x, y, z)`: a pivot in self's local frame.
- `pivotVertex(id).rotate(x, y, z)`: a vertex belonging to self.
- `pivotPoint(pointRef).rotate(x, y, z)`: a local or external point.
- `axisEdge(id).rotate(angle)`: a straight edge belonging to self.
- `axisLine(lineRef).rotate(angle)`: a positioned local or external axis.

Angles are degrees; XYZ rotations apply X, then Y, then Z. Pivot/axis selections
must be completed with `rotate`. Consecutive constraints solve jointly, followed
by transformations in array order. A later constraint starts a new segment from
the preceding pose. Groups move their assembled children as rigid bodies.
Standalone geometry is unchanged.

## Topology

- `.vertex(id)`, `.edge(id)`, `.surface(id)`: one point, line, or face anchor.
- `.vertices(ids?)`, `.edges(ids?)`, `.surfaces(ids?)`: arrays of anchors.

These topology references expose readonly `kind` (`vertex`, `edge`, or
`surface`) and `id` properties. Use `model.edges().map(edge => edge.id)` to
collect edge IDs for an operation on that model. Plain named anchors such as
`model.up` do not have these topology properties.

IDs are model-local. See [topology selection](../../guides/topology/) for
selection behavior and derived-model identity.

`TopologyId` (also used by `VertexId`, `EdgeId`, and `SurfaceId`) is a
positive integer or a flat numeric source path. A loft cap can be selected with
`body.surface([1, 1])`; a mixed selection uses an outer list, such as
`body.surfaces([1, [1, 1], [2, 1]])`. Each topology-changing operation prefixes
one-to-one inherited IDs with its one-based input index; new or ambiguous
elements receive numeric IDs in that result. Transforms preserve complete IDs.

A surface can query its edges and vertices; an edge can query its vertices.
These queries retain the source model's IDs and validate membership.
`.center` is a transformed local bounding-box center; edges also provide
`.start`, `.midpoint`, and `.end` at curve parameters 0, 0.5, and 1.
Calculated points are anchors, not topology vertices.

Model dimensions use a consistent coordinate scale. When
[exporting](../../guides/exporting/#scale-and-orientation), choose how many
millimeters each model unit represents. This scales the output without changing
the source model.

## Cached computations

```ts
import {cached} from '@code3d/core';

const profile = cached((radius: number, sides: number) =>
  Array.from({length: sides}, (_, index) => {
    const angle = (index * 2 * Math.PI) / sides;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  }),
);
```

`cached(fn, options?)` preserves synchronous parameter/result types. It caches
ordinary data; use `definePrimitive()` for Replicad geometry so Core also owns
native resources and creates fresh model metadata. Treat cached results as
immutable. A memory hit returns the retained computed or decoded value directly,
without decoding, copying or freezing it.

The default persistent codec supports plain objects, arrays, scalar values
(including `undefined`, nonfinite numbers and bigint), Date, Map, Set, ArrayBuffer,
standard TypedArrays and DataView. Shared references, cycles, sparse arrays and
shared buffer views survive restoration. Arguments use the same data encoding;
changing dynamic state must be supplied as arguments. Functions, native handles
and application class instances are not ordinary data arguments.

For custom result types, supply both functions as
`cached(fn, {encoder: value => bytes, decoder: bytes => value})`.
The encoder runs when saving to disk; the decoder runs once when restoring an
entry into memory. A subsequent memory hit never calls either codec. Async
computations are excluded: incomplete work is not admitted to the cache.

The model engine fingerprints static function definitions, their referenced
local declarations, imported implementation graphs and codec definitions. Aliases
and re-exports of Core cache factories are supported. Editing an unrelated local
binding, moving a definition or adding/removing `export` preserves its identity;
changing a referenced helper or dependency invalidates it. Functions supplied as parameters, dynamic factory results and closures capturing
enclosing function/loop bindings use memory-only object identity.
Outside the model engine, ordinary Node calls also use function object identity
and share the process-wide memory LRU. Authors do not provide cache IDs or versions.

Public cached computations, primitives, Core geometry, font parsing, glyph contours
and snapshot queries share one cache. The memory budget remains 2 GiB; browser
persistence shares the existing OPFS disk budget, min(1 GiB, 10% of origin quota).
Cancellation and exceptions retain completed entries and editing history.

## Text

```ts
import {font, text, extrude, group} from '@code3d/core';

const sans = font(new URL('./fonts/DejaVuSans.ttf', import.meta.url));
const profiles = text('B8i', sans, 10);
export const lettering = group(extrude(profiles, 1));
```

`font()` synchronously returns an immutable font resource. The App prepares literal
`new URL('./font.ttf', import.meta.url)` assets before evaluating model code, including
assets in imported modules. Changing the font file invalidates the resource; equal
file contents reuse parsed fonts and geometry. Node reads file URLs directly.
`font()` also accepts `ArrayBuffer` or `Uint8Array` bytes, captured at the call.
The engine also prepares static HTTP(S) font URLs before model execution:

```ts
const remote = font(new URL('https://example.com/fonts/SomeFont.ttf'));
const label = text('AV', remote, 10, {letterSpacing: 0.5, kerning: true});
```

Use a direct font-file URL whose server permits CORS access from the App. The URL
must be a literal in `new URL(...)`, including when declared in an imported module;
no `await` is needed in model code. The engine decodes remote WOFF2 files to SFNT
before synchronous font parsing.

Google Fonts can instead be selected by name:

```ts
import {googleFont, text, extrude, group} from '@code3d/core';

const play = googleFont('Play');
const medium = googleFont('Roboto', {weight: 450, italic: true});
export default group(extrude(text('Hello', play, 10), 1));
```

`googleFont(family, options?)` synchronously returns a `Font`. Both `weight` and
`italic` are optional. Omitted axes are omitted from the Google request, leaving
the defaults to Google; explicit weights apply to variable fonts as well as static
faces. The App prepares the CSS and all of its Unicode subsets before execution,
then selects the appropriate subset for each character. No stylesheet is installed.
The family and options must be literals or static `const` values, including imports,
aliases, object properties and spreads. Computed calls are reported at their source.
Large families such as Chinese fonts require downloading all returned subsets on
the first use; changing the text subsequently reuses those font resources.

Network resources use an engine-owned 64 MiB memory LRU and the shared OPFS disk
journal, then the network. CSS, compressed font bytes and content-addressed decoded
bytes are retained. The disk budget is the smaller of 1 GiB and 10% of the browser's
origin quota, including compaction space, shared with geometry. Fresh resources
need no request across edits or Worker/page restarts. Expired resources revalidate
through the browser HTTP cache; `no-store` resources are not retained. Concurrent
requests share one download. Failed or cancelled builds preserve completed resources;
partial downloads are discarded and can retry. Without OPFS, memory caching remains.
The active build's resource references are outside the historical memory limit.

Parsed fonts are memory-only entries in the existing 2 GiB kernel cache budget.
CSS interpretation, normalized glyph contours, B-Rep, bounds and meshes reuse the
existing memory/disk artifact cache. Font contents and requested variations identify
these artifacts; changing text position or spacing can reuse unchanged glyphs.
HTTP resource records remain reusable when the geometry runtime changes.

For computed URLs or Node execution outside the App engine, download TTF/OTF bytes
first (decode WOFF2 before passing its bytes):

```ts
const response = await fetch(fontUrl);
if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
const remote = font(await response.arrayBuffer());
```

TTF and OTF fonts are supported, including variable fonts and Chinese characters
when present in the font. HarfBuzz supplies glyph outlines, advances, kerning and
ligatures. Quadratic/cubic curves are preserved, and overlapping contours within
a glyph use the non-zero fill rule. Font collections (TTC), color glyph rendering,
full bidirectional/multiscript paragraph layout and multiline text are outside this
API. Missing glyphs report an error. Empty text and spaces create no faces; spaces
still advance subsequent characters.

`text(content, font, size, options?)` requires the first three arguments and returns connected planar
regions as ordinary readonly `FaceModel[]`: `B` has one face with two holes; `i` has
two faces. Size is the font em in model units, not the cap height. Coordinates are
+X right, -Z up, normal +Y, with all faces retaining the same baseline origin.
Faces are never individually centered,
so `group(extrude(...))`, origin operations and boolean tools preserve the layout.
Use positive/negative extrusion and `union`/`cut` for raised or engraved lettering.
Text is currently code-defined geometry rather than an editable sketch entity.

`options.letterSpacing` defaults to `0` and adds a finite distance in model units
between laid-out glyphs, including spaces. Negative values tighten the text. The
distance stays constant when size changes, and disconnected parts of one glyph move
together. `options.kerning` defaults to `true`; set it to `false` to disable the
font's pair adjustments. Extra letter spacing is added after kerning. Supported
ligatures remain single glyphs for spacing purposes.
