---
title: Modeling API
description: A curated map of the public core modeling operations.
---

Import these functions from `@code3d/core`. The editor's TypeScript signatures
provide exact overloads and inferred model interfaces.

Types used by the authoring API are also exported, including generic constraints,
named-element result types, and capability interfaces. Use `import type` from
`@code3d/core` for types such as `ElementKind`, `ModelKind`, `TopologyKind`,
`NamedElements`, and `ExposedElements`. Replicad builder types such as `Shape3D`
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
  [shelling](../../guides/topology/#hollow-a-solid).
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
changes the model's own relation anchor. Rotation moves geometry and named
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

Solid primitives expose `center`, `top`, `bottom`, and `axis`. Profiles,
curves, and other geometry provide elements suited to their own shape.

Use `selfAnchor.on(targetAnchor)` to constrain geometry. Points coincide,
lines become collinear, and faces become coplanar with opposing normals.
Mixed dimensions constrain a point to a line or plane, or a line to a plane.
Solid and group intrinsic anchors constrain the complete frame.

Return an array from `relate()` to combine conditions. Default centering and
orientation choose among valid solutions; they do not force every anchor's
center to coincide. `.flip()` selects aligned face normals or reverses a line's
preferred direction. An explicit `.offset(x, y, z)` pins the source anchor
position in the target frame, even when all three values are zero.

Line and face anchors describe infinite reference lines and planes, including
the sampled reference frames of curved topology. They do not require the
finite boundaries of two shapes to match. Related groups move their assembled
children as rigid bodies.

## Topology

- `.vertex(id)`, `.edge(id)`, `.surface(id)`: one point, line, or face anchor.
- `.vertices(ids?)`, `.edges(ids?)`, `.surfaces(ids?)`: arrays of anchors.

These topology references expose readonly `kind` (`vertex`, `edge`, or
`surface`) and `id` properties. Use `model.edges().map(edge => edge.id)` to
collect edge IDs for an operation on that model. Plain named anchors such as
`model.top` do not have these topology properties.

IDs are model-local. See [topology selection](../../guides/topology/) for
selection behavior and derived-model identity.

Model dimensions use a consistent coordinate scale. When
[exporting](../../guides/exporting/#scale-and-orientation), choose how many
millimeters each model unit represents. This scales the output without changing
the source model.
