---
title: Local coordinates and placement
description: Understand positions, origin offsets, model axes, and where a part sits in a composition.
---

Every model has its own local coordinates. Its origin is `[0, 0, 0]`.
The geometry can be away from that origin: a point at `[10, 0, 0]` still
belongs to a model whose origin is zero.

## Positions, dimensions, and displacements

Use coordinate arrays for positions and separate numbers for dimensions,
displacements, and angles:

| Expression                     | Meaning                                              |
| ------------------------------ | ---------------------------------------------------- |
| `box(10, 20, 30)`              | Dimensions along local X, Y, and Z; centered at zero |
| `point()`                      | A point at local zero                                |
| `point([10, 2, -3])`           | A point at the supplied local coordinates            |
| `line([10, 0, 0])`             | A line from zero to the supplied endpoint            |
| `line([10, 0, 0], [20, 0, 0])` | A line between two local positions                   |
| `originOffset(10, 0, 0)`       | Move the origin by a local displacement              |
| `constraint.pivot([10, 0, 0])` | Choose a rotation center in self's local coordinates |
| `constraint.offset(10, 0, 0)`  | Set a relation offset in the target reference axes   |
| `rotate(0, 90, 0)`             | Rotate geometry by 90° around local Y                |

Curve control points use the returned model's local coordinates too. A common
offset in their coordinates is retained; the curve does not automatically move
its start or center to zero.

## Changing the origin changes point coordinates

`originOffset(dx, dy, dz)` chooses a new origin at that displacement in the
input model. In the result, that origin is zero and each point has coordinates:

```text
p_new = p_old - [dx, dy, dz]
```

For example, the point in `point([10, 2, -3]).originOffset(4, 0, 0)` is at
`[6, 2, -3]`. Conversely, `point().originOffset(-10, -2, 3)` creates the same
local geometry as `point([10, 2, -3])`.

The shape and distances between points stay the same. Geometry, `center`,
named anchors, and topology positions use the new coordinates together.
Directions and normals keep their direction. The operation returns a new
model value and preserves topology IDs; earlier values and references retain
their meaning. Successive origin offsets add and opposite offsets cancel.

Use `originVertex(id)` to make a chosen vertex zero, or `originCenter()` to
make the center anchor zero. The [origin and rotation guide](../../guides/origins-and-rotation/)
shows how to select and drag these in the viewport.

## The origin, center, and axes have different roles

`line([10, 0, 0])` has its origin at zero and its midpoint at `[5, 0, 0]`.
Rotating it with `.rotate(0, 90, 0)` gives a line from zero to `[0, 0, -10]`.
Calling `.originCenter()` first puts the endpoints at `[-5, 0, 0]` and
`[5, 0, 0]`, so the same rotation now turns the line around its midpoint.

Geometric `rotate()` and `scaled()` act around the current local zero.
The `center` anchor follows these transformations; rotation does not replace
it with the center of the new axis-aligned bounding box.

The model's XYZ axes remain its local coordinate axes. `up` means local +Y
even after the geometry rotates. A line's tangent or a face's normal belongs
to that geometric reference and can point in a different direction. Relation
offsets use the target reference's axes; an explicit `pivot([x, y, z])` uses
self's model coordinates. See [relations](../../guides/relations/) for those
placement rules.

## Placing a part in a composition

`relate()` describes placement relative to other parts. Inspect a related
part by itself to see its local geometry; inspect the relation or a consuming
composition to see the solved placement. An `originOffset()` changes the
part's local geometry coordinates, while a relation's `offset()` participates
in its placement conditions.

Several relations on one model are solved together. Their offsets belong to
those conditions, and any remaining freedom uses the solver's default result.
See [combining conditions](../../guides/relations/#combine-conditions) before
using an offset in a system with multiple relations.

New model values also have a coordinate frame:

- A boolean result uses the main operand's local coordinates.
- A loft uses its first section's local coordinates.
- A group retains the placement of the parts in the resulting composition.
- `expose()` brings a reference into the outer model's local space. For a
  repeated part, use the reference from its specific instance.

Export uses these same coordinates: a standalone part has local geometry,
and a composition includes its parts' resolved placement. The chosen output
scale and up axis are applied afterward. See [exporting models](../../guides/exporting/).
