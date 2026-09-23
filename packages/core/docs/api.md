---
title: Modeling API
description: Browse the Code3D TypeScript API by modeling task, from primitives and sketches to solid operations, placement, topology and measurements.
sidebar:
  order: 1
  hidden: true
---

Construct geometry, combine models and query the result with the public Core
API. For a first runnable model, see the [Core example](../README.md#example).

## Browse by task

Choose a starting shape, build the part, then place and measure it. Functions,
model methods and reference properties are grouped by what they do.

| Category                         | APIs and reading                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solid primitives                 | [box, cylinder, sphere, ellipsoid, frustum, regularPrism, tube and coil](#solid-primitives)                                                                                                                                                             |
| Points, curves and profiles      | [point, line, arc, bezier, spline, circle, ellipse, rectangle and regularPolygon](#profiles-and-curves)                                                                                                                                                 |
| Sketches                         | [sketch](api/sketch.md), [entities](api/sketch-entities.md), [constraints](api/sketch-constraints.md), [point / derive](api/sketch-derive.md), [face / faces](api/sketch-faces.md), [plane / relate](api/sketch-relate.md)                              |
| Text and fonts                   | [text](api/text.md), [font](api/font.md), [googleFont](api/google-font.md)                                                                                                                                                                              |
| Shape construction               | [extrude and loft](#profiles-and-curves), [revolve](#rotational-solids), [sweep](#path-sweeps), [wrap and thicken](#curved-surface-wrapping)                                                                                                            |
| Booleans and solid modifications | [union, cut and intersect](#composition-and-boolean-operations); [fillet, chamfer and shell](#model-operations)                                                                                                                                         |
| Origins and local transforms     | [originPoint, originVertex, originOffset, originCenter and model.rotate](#origins-and-rotation); [scaled](#scaling)                                                                                                                                     |
| Groups and placement             | [group and expose](#composition-and-boolean-operations); [frame](api/frame.md); [relate, on and align](#anchors-and-relations); [offset, rotate and pivot/axis selectors](#independent-placement-transformations); [coupleRotation](#rotation-coupling) |
| Topology and references          | [vertex / vertices](api/vertex.md), [edge / edges](api/edge.md), [surface / surfaces](api/surface.md); [reference elements](api/reference-elements.md), [directional bounds](api/directional-bounds.md), [flip / reverse](api/flip-reverse.md)          |
| Geometry measurements            | [distance](api/distance.md), [length](api/length.md), [area](api/area.md), [volume](api/volume.md), [bounds](api/bounds.md), [position](api/position.md)                                                                                                |
| Materials and appearance         | [material and colors](api/material.md), [Three.js integration](api/three.md)                                                                                                                                                                            |
| Parameters, time and caching     | [input](api/input.md), [timeOffset](api/time-offset.md) and [cache](api/cache.md)                                                                                                                                                                       |

For reusable library development, see [definePrimitive and Replicad](api/define-primitive.md),
[model data](api/model-data.md) and [custom inspectors](api/inspectors.md), [group member inspection](api/inspect-group-members.md) and [annotations](api/annotations.md).
Execution hosts use the separate [tooling integration API](api/tooling.md).
The [model values guide](values.md) explains the capabilities of different
model kinds.

## Imports and types

The [complete export index](api/exports.md) maps every public function, type and
model member to its primary reference, including tooling and interoperability.

[Model types and capabilities](api/model-types.md) explains all model aliases,
kind mappings, capability interfaces, named elements and common vectors.

Import these functions from `@code3d/core`. The editor's TypeScript signatures
provide exact overloads and inferred model interfaces.

Types used by the authoring API are also exported, including generic constraints,
named-element result types, and capability interfaces. Use `import type` from
`@code3d/core` for types such as `ElementKind`, `ModelKind`, `ModelForKind`, `TopologyKind`,
`NamedElements`, `ExposedElements`, `Bound`, and `TopologyId`. Replicad builder types such as `Shape3D`
are available from `@code3d/core/replicad` alongside `definePrimitive`.

Use `input('Width', 40, {min: 4, max: 100, step: 1})` for a
[numeric form parameter with a slider](runtime.md#numeric-inputs); the options
argument is optional.
It returns a number that can drive ordinary model code.

For time-dependent assembly motion, read `timeOffset()` and derive angles
or offsets with ordinary TypeScript. See [time offset](runtime.md#time-offset)
for playback and evaluation semantics.

## Solid primitives

| Function                                                            | Meaning                           |
| ------------------------------------------------------------------- | --------------------------------- |
| [`box(x, y, z)`](api/box.md)                                        | Box dimensions along X, Y, and Z  |
| [`cylinder(radius, y)`](api/cylinder.md)                            | Cylinder with its axis along Y    |
| [`sphere(radius)`](api/sphere.md)                                   | Sphere of the given radius        |
| [`ellipsoid(xRadius, yRadius, zRadius)`](api/ellipsoid.md)          | Ellipsoid with three axis radii   |
| [`frustum(bottomRadius, topRadius, y)`](api/frustum.md)             | Truncated cone                    |
| [`regularPrism(radius, y, sides, rotation?)`](api/regular-prism.md) | Regular polygonal prism           |
| [`tube(outerRadius, innerRadius, y)`](api/tube.md)                  | Straight tube with a through bore |
| [`coil(coilRadius, wireRadius, pitch, turns)`](api/coil.md)         | Circular-wire coil along Y        |

Choose a constructor by its section: rectangular, circular, spherical,
ellipsoidal, tapered, polygonal, hollow or helical. Each reference explains its
own dimensions, local origin, reference elements, measurements and constraints.
See the [basic shapes example](../../app/examples/primitives/primitives.ts) to
inspect all eight solids in one source file.

Use [`@code3d/screws`](../../screws/docs/assembly.mdx) for standard fasteners and matching hole tools.
Use [`@code3d/gears`](../../gears/README.md) for nominal spur, helical and internal gear parts.

To build a solid beyond these primitives, import `definePrimitive` and
`replicad` from `@code3d/core/replicad`. See
[custom primitives](custom-primitives.mdx) for a complete example.

## Profiles and curves

Planar profiles lie in the local XZ plane with a +Y normal.

| Function                                                              | Meaning                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`circle(radius)`](api/circle.md)                                     | Circular face                                                             |
| [`ellipse(xRadius, zRadius)`](api/ellipse.md)                         | Elliptical face                                                           |
| [`rectangle(x, z)`](api/rectangle.md)                                 | Rectangular face                                                          |
| [`regularPolygon(radius, sides, rotation?)`](api/regular-polygon.md)  | Regular polygonal face                                                    |
| [`point()`](api/point.md) or [`point([x, y, z])`](api/point.md)       | Vertex model                                                              |
| [`line([x, y, z])`](api/line.md) or [`line(start, end)`](api/line.md) | Straight edge                                                             |
| [`arc(start, middle, end)`](api/arc.md)                               | Arc through three points                                                  |
| [`bezier(points)`](api/bezier.md)                                     | Bézier curve                                                              |
| [`spline(points)`](api/spline.md)                                     | B-spline fitted to ordered samples                                        |
| [`loft(sections, options?)`](api/loft.md)                             | Solid through sections; optional curve spine                              |
| [`extrude(faceOrFaces, distance)`](api/extrude.md)                    | Solid extruded along one face's local normal                              |
| [`revolve(profile, axis, config)`](api/revolve.md)                    | Solid rotated about a straight directed axis, with optional axial advance |
| [`sweep(profile, spine)`](api/sweep.md)                               | Solid formed by carrying one face along an open curve                     |
| [`wrap(profiles, target, options?)`](api/wrap.md)                     | Curved faces mapped from one planar layout onto a finite surface          |
| [`thicken(faceOrFaces, thickness)`](api/thicken.md)                   | Solids offset along oriented surface normals                              |

See [local coordinates and placement](local-coordinates.md) for
the coordinate frame of a model, reference, or composition.

Position coordinates use arrays; dimensions, offsets and angles use scalar
arguments. `point([x, y, z])` equals `point().originOffset(-x, -y, -z)`.
`line([x, y, z])` starts at zero; the two-array form uses both supplied local
endpoints. Curve tangents do not redefine the model's XYZ axes.

Profiles and curves are model values that can be inspected and related to
other models.

See [extrude](api/extrude.md) for signed straight extrusion and
[loft](api/loft.md) for ordered sections and optional spine guidance.

### Rotational solids

[revolve](api/revolve.md) covers planar profiles, directed axes and optional axial
advance. [coil](api/coil.md) provides a circular-wire shortcut with pitch checks.

### Path sweeps

[sweep](api/sweep.md) explains open paths, starting alignment and supported holes.

### Curved surface wrapping

[wrap](api/wrap.md) maps one shared planar layout to a finite curved surface.
[thicken](api/thicken.md) adds signed thickness for relief or engraving.
See their references for localization, seams, curvature and numerical limits.

## Measurements

Read numeric geometry results using these references. Results are ordinary values
computed at the call; later model values do not update earlier measurements.

### Length and area

[length](api/length.md) measures finite edge arc length;
[area](api/area.md) measures trimmed faces or every boundary face of a solid.
See their references for units, model capabilities, scale and read-only inspection.

### Volume

[volume](api/volume.md) measures solid material, excluding holes and cavities.

### Distance between references

[distance](api/distance.md) measures shortest distance or projected clearance
between finite geometry in its solved placement. Its reference explains axis
forms, groups, finite versus infinite anchors, query timing and the fitted-beam example.

## Independent placement transformations

Use [offset](api/offset.md) and [rotate](api/rotate.md) as separate placement steps
inside [relate](api/relate.md). Complete a chosen rotation center or axis with
one rotation: [pivot](api/pivot.md), [pivotVertex](api/pivot-vertex.md),
[pivotPoint](api/pivot-point.md), [axisEdge](api/axis-edge.md) or
[axisLine](api/axis-line.md). Their references describe frame conventions,
pivotOffset/axisOffset and the resulting transformation types.

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

| Method or utility parameter                          | Runtime defaults |
| ---------------------------------------------------- | ---------------- |
| Model/group `rotate` and independent/pivot `rotate`  | `0, 0, 0`        |
| Model/group `originOffset` and relation `offset`     | `0, 0, 0`        |
| Relation `pivot`                                     | `[0, 0, 0]`      |
| Selector `pivotOffset` and `axisOffset`              | `0, 0, 0`        |
| `axisLine(axis).rotate`                              | `0`              |
| Geometric model `scaled`                             | `1`              |
| Face `extrude` and the `extrude` utility's distance  | `10`             |
| Face `thicken` and the `thicken` utility's thickness | `1`              |
| Solid `fillet`, `chamfer` and `shell`                | `1`              |

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
[parameter defaults](../../web/src/content/docs/docs/guides/model-tools.mdx#describe-an-omitted-arguments-default).

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

[sketch](api/sketch.md) creates an immutable two-dimensional definition. See
[entity tuples](api/sketch-entities.md) for points, lines, circles and arcs;
[constraints](api/sketch-constraints.md) for the complete condition union;
[point and derive](api/sketch-derive.md) for upstream references and local layers;
and [face and faces](api/sketch-faces.md) for closed regions, holes and islands.
The [editor workflow](sketches.md) explains selection and drag behavior.

### Sketch placement and model context

[plane and relate](api/sketch-relate.md) places an empty, open or closed sketch
against model geometry. It explains the callback's self identity, inherited
relations, finite/infinite geometry limits and editing in a model context.

## Composition and boolean operations

| Function                                  | Result                                        |
| ----------------------------------------- | --------------------------------------------- |
| [`group(models, options?)`](api/group.md) | Composition that preserves its separate parts |
| [`union(solids)`](api/union.md)           | Fused solid                                   |
| [`cut(stock, tools)`](api/cut.md)         | Stock with the tool volumes removed           |
| [`intersect(solids)`](api/intersect.md)   | Shared solid volume                           |

See [group](api/group.md) for supported members, nested hierarchy and coordinate
frames. [expose](api/expose.md) publishes typed member references for reuse.

Use `{name: 'Assembly', frame: base}` to name the group and explicitly select
its local coordinate system. `frame` accepts an independent `frame()` value,
a model's `.frame`, or an exposed frame. It contributes a reference, not an
output member. Without this option, the first member defines the coordinates.
See [independent coordinate frames](#independent-coordinate-frames).

Relations are resolved at composition and geometry evaluation boundaries.
Solids also provide [`.union(operands)`](api/union.md),
[`.intersect(operands)`](api/intersect.md) and [`.cut(tools)`](api/cut.md).
These methods accept a single solid or a nonempty readonly array, with the
receiver as the first operand. Free boolean functions take arrays.
Arrays in booleans and
loft describe the inputs of one operation; they do not automatically map it.
`intersect()` requires a common solid volume across all inputs. Disjoint inputs
or inputs that only touch produce a diagnostic rather than an empty solid.

## Model operations

Available operations depend on the kind of geometry. TypeScript completion
shows which operations are supported by the value you hold.

- [`.fillet(radius, edgeIds?)`](api/fillet.md): round selected edges, or all edges.
- [`.chamfer(distance, edgeIds?)`](api/chamfer.md): bevel selected edges, or all edges.
- [`.shell(thickness, removedSurfaceIds?)`](api/shell.md): hollow one connected solid. Positive
  thickness offsets inward; negative thickness offsets outward. Selected surfaces
  become openings; omission or `[]` creates an enclosed cavity. See
  [making hollow parts](shells.mdx).
- `.scaled(factor)`: uniformly scale a geometric model about local coordinate zero.
- `.material(value)`: replace the complete material with a native Three.js material
  or a CSS color shorthand; a group overrides every descendant's material.
- [`.relate(self => constraint)`](api/relate.md) or `.relate(self => [first, second])`: attach
  one or more relations for placement in a composition.
- [`.expose({name: element})`](api/expose.md): publish a typed named-element interface.

## Materials

[material](api/material.md) captures complete appearance on a new model value,
including colors, transparency and group-wide replacement. [Three.js integration](api/three.md)
covers `@code3d/core/three`, loaded textures, UV mapping and the supported
serialization boundary. Use [@code3d/materials presets](../../materials/docs/presets.md)
for common surfaces.

## Scaling

[`.scaled(factor)`](api/scaled.md) uniformly scales a geometric model around local
zero. See its reference for supported model kinds, factor validation, measurement
scaling and placement semantics.

## Rotation coupling

[`coupleRotation(other, {ratio, phase?})`](api/couple-rotation.md) couples the
current model's cumulative placement angle to another model's fixed axis.
See its reference for angular datums, full turns, translation freedom,
configuration fields and the supported acyclic driving graph.

## Origins and rotation

Every model has a [frame and origin](api/reference-elements.md#frame-and-origin).
Use [originPoint](api/origin-point.md), [originVertex](api/origin-vertex.md),
[originOffset](api/origin-offset.md) or [originCenter](api/origin-center.md) to
choose local zero. [Model rotate](api/model-rotate.md) rotates local geometry;
[relation rotate](api/rotate.md) places it in a composition.

### Independent coordinate frames

[`frame(name?)`](api/frame.md) creates an independent coordinate reference without geometry. Use it with `align` and select it in [`group` options](api/group.md#coordinate-frame).

### Model coordinate references

See [frame and origin](api/reference-elements.md#frame-and-origin) for references on model values.

### Centering a collection

[originCenter](api/origin-center.md) covers the free function's readonly
collection form, shared bounds and preserved member placement.

## Model metadata

[Model metadata](api/model-data.md) explains symbol-keyed snapshots, `withMetadata` and inheritance through modeling operations.

## Anchors and relations

[Reference elements](api/reference-elements.md) distinguishes finite geometry,
infinite axes/planes and coordinate frames. Build placement with
[relate](api/relate.md), [on](api/on.md), [align](api/align.md) and
[coupleRotation](api/couple-rotation.md). Their references explain callback
identity, supported geometry, solve order and remaining freedom.

Use separate [offset](api/offset.md) and [rotate](api/rotate.md) steps after
constraints. [pivot](api/pivot.md), [pivotVertex](api/pivot-vertex.md),
[pivotPoint](api/pivot-point.md), [axisEdge](api/axis-edge.md) and
[axisLine](api/axis-line.md) choose the rotation reference. Read the
[placement workflow](relations.mdx) for complete assemblies.

Package authors can attach [symbol-keyed model data](api/model-data.md) and
publish [named reference elements](api/expose.md). These serve distinct purposes:
package metadata and the model's public placement interface.

## Topology

Select finite geometry with [vertex / vertices](api/vertex.md),
[edge / edges](api/edge.md) and [surface / surfaces](api/surface.md).
Each reference retains its owning model and topology ID. Child queries validate
membership and keep the original namespace; see the individual selectors for
ID paths, ordering, duplicates and empty selections.

[Reference elements](api/reference-elements.md) explains frames, origins, centers,
axes, planes and curve points. [Directional bounds](api/directional-bounds.md)
provide finite contact boundaries; [flip / reverse](api/flip-reverse.md) changes
reference orientation without editing geometry.

See [topology lineage](topology.md#ids-belong-to-a-model) for identities across
construction and local edits, and the [exporting guide](../../web/src/content/docs/docs/guides/exporting.md#scale-and-orientation)
for choosing the physical scale of model units.

## Cached computations

[cache](api/cache.md) covers both invocation forms, deterministic arguments,
result value semantics, supported data, custom codecs and host persistence.
Read [input](api/input.md) and [timeOffset](api/time-offset.md) before entering a
cached computation and pass their values explicitly.

## Text

[text](api/text.md) creates connected planar faces with a shared baseline, then
ordinary extrusion, union and cut build raised or engraved lettering.
[font](api/font.md) loads local/remote font bytes;
[googleFont](api/google-font.md) loads a named family and style with its subsets.
Await font loading before synchronous geometry construction. Their references
cover signatures, all options, coordinates, supported formats and caching.
See the [text workflow](text.md) for complete layout and curved lettering.

## Geometry measurements

[bounds](api/bounds.md) returns finite axis-aligned extents in the model's own
frame or an explicit reference model's solved frame. [position](api/position.md)
returns the model origin in an explicit reference frame. Both support groups;
their references explain nested occurrences, ambiguity and value semantics.
