---
title: Modeling API
description: A curated map of the public core modeling operations.
---

Import these functions from `@code3d/core`. The editor's TypeScript signatures
provide exact overloads and inferred model interfaces.

Types used by the authoring API are also exported, including generic constraints,
named-element result types, and capability interfaces. Use `import type` from
`@code3d/core` for types such as `ElementKind`, `ModelKind`, `TopologyKind`,
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
| `point(x, y, z)` or `point([x, y, z])`     | Vertex model                                 |
| `line(x, y, z)` or `line(start, end)`      | Straight edge                                |
| `arc(start, middle, end)`                  | Arc through three points                     |
| `bezier(points)`                           | Bézier curve                                 |
| `spline(points)`                           | Interpolating spline                         |
| `loft(sections, options?)`                 | Solid through sections; optional curve spine |

Profiles and curves are model values that can be inspected and related to
other models.

## Composition and boolean operations

| Function               | Result                                        |
| ---------------------- | --------------------------------------------- |
| `group(models, name?)` | Composition that preserves its separate parts |
| `union(solids)`        | Fused solid                                   |
| `cut(stock, tools)`    | Stock with the tool volumes removed           |
| `intersect(solids)`    | Shared solid volume                           |

Relations are resolved at composition and geometry evaluation boundaries.

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
- `.paint(color)`: return a recolored model; a group recursively overrides
  every descendant's color, including already-painted parts and nested groups.
- `.relate(self => constraint)` or `.relate(self => [first, second])`: attach
  one or more relations for placement in a composition.
- `.expose({name: element})`: publish a typed named-element interface.

The outermost painted group determines the color of its complete subtree.
Painting again replaces that override. Original models and shared parts used
elsewhere retain their colors; previews and exports use the same result.

## Scaling

Solids, faces, curves, and points support `.scaled(factor)`. The factor must be
positive and finite. For example, `box(20, 8, 12).scaled(0.5)` returns a new box
with dimensions 10, 4, and 6, leaving the original model unchanged.

Scaling uses local coordinate zero even after an origin edit. Geometry, named
anchors, the `center` anchor, and the model's origin position scale together;
topology IDs are preserved. Groups do not provide `.scaled()`; scale their
geometric parts before composing them. To change only an exported file's unit
conversion, use the [export scale](../../guides/exporting/#scale-and-orientation).

## Origins and rotation

Solids, faces, curves, and points provide these operations:

| Method                      | Behavior                                                   |
| --------------------------- | ---------------------------------------------------------- |
| `.origin(x, y, z)`          | Set the origin in local geometry coordinates               |
| `.originVertex(id)`         | Set the origin to an input-model vertex                    |
| `.originCenter()`           | Set the origin to the model's center anchor                |
| `.originOffset(dx, dy, dz)` | Add a local-coordinate offset to the current origin        |
| `.rotate(x, y, z)`          | Rotate about the origin, in degrees, fixed X then Y then Z |

`origin`, `originVertex`, and `originCenter` replace previous origin settings and accumulated
offsets. Setting the origin leaves geometry and named anchors in place; it
changes the default pivot for later explicit rotations. Rotation moves geometry and named
anchors together, keeping topology IDs. Later origin settings do not undo
already-applied rotations.

Every geometric model exposes `center`: the body's local bounding-box center,
carried along by subsequent transforms. Rotation does not recalculate it from
the rotated shape's axis-aligned bounds. Changing the origin leaves `center`
in place. Use `.originCenter().originOffset(1, 0, 0)` to offset from this center.
Groups do not provide these geometric operations. For a runnable example and
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
positions report a conflict. `offset(x, y, z)` pins matching bound centers in
the target frame, including explicit zero. `bound.flip()` reverses contact
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
Point membership ignores direction. `align(...).offset(x,y,z)` translates self
in the target axes after alignment, before explicit rotations; zero preserves
the relation's free modes. Use point references for additional positioning.

- `constraint.rotate(x, y, z)`: rotate around self's origin.
- `constraint.pivot(x, y, z).rotate(x, y, z)`: a pivot in self's local frame.
- `constraint.pivotVertex(id).rotate(x, y, z)`: a vertex belonging to self.
- `constraint.around(axis).rotate(angle)`: a positioned local or external axis.

Angles are degrees; XYZ rotations apply X, then Y, then Z. Pivot/axis selections
are intermediate values and must be completed with rotate. Rotation follows
its chain's contact placement; other contacts constrain the final pose. Groups
move their assembled children as rigid bodies. Standalone geometry is unchanged.

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
