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
| `pivot([10, 0, 0])`            | Choose a rotation center in self's local coordinates |
| `offset(10, 0, 0)`             | Move a relate result along fixed composition axes    |
| `rotate(0, 90, 0)`             | Rotate geometry by 90° around local Y                |

Curve control points use the returned model's local coordinates too. A common
offset in their coordinates is retained; the curve does not automatically move
its start or center to zero.

## Default origin rules

Constructors define a local coordinate frame. Derived operations inherit their
main input's frame; they do not automatically recenter the resulting geometry.
Only an explicit origin operation chooses a different local zero.

| Constructor or operation                          | Origin and coordinate frame                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `box`, `sphere`, `circle`, `ellipse`, `rectangle` | Geometry is constructed around local zero.                                                                                                 |
| `cylinder`, `tube`, `frustum`, `regularPrism`     | The central axis passes through zero; height is centered on Y. This is not a center-of-mass rule.                                          |
| `regularPolygon`                                  | The polygon's construction-circle center, which need not equal its bounding-box center.                                                    |
| `coil`                                            | The helix axis passes through zero; the centerline's axial span is centered on Y.                                                          |
| `point`, `line`, `arc`, `bezier`, `spline`        | Retain the supplied coordinates relative to zero; neither endpoints nor curve centers are automatically moved to zero.                     |
| Faces made from a sketch                          | Retain the sketch's local frame.                                                                                                           |
| `text`                                            | All returned faces share the text layout's baseline origin, including its glyph advances and offsets. Individual letters are not centered. |
| `definePrimitive`                                 | Retain the frame used by the returned geometry; no automatic recentering.                                                                  |
| `extrude`                                         | Inherit the input face's frame, without centering the extrusion.                                                                           |
| `union`, `intersect`                              | Inherit the first operand's frame.                                                                                                         |
| `cut`                                             | Inherit the stock's frame.                                                                                                                 |
| `loft`                                            | Inherit the first section's frame.                                                                                                         |
| `group`                                           | Inherit the first member's frame after solving placement; an empty group uses the default frame.                                           |
| `rotate`, `scaled`, `fillet`, `chamfer`, `shell`  | Retain the input model's frame, even when its geometric bounds change.                                                                     |
| `relate`, `material`, `expose`                    | Retain the model's local frame; relations describe its placement within a composition.                                                     |

For example, `point([10, 0, 0])` has geometry at X = 10 and an origin at zero.
Similarly, `rectangle(10, 10).extrude(20)` keeps its origin on the starting
plane, while `box(10, 20, 10)` is centered on its origin.

Explicit choices are `originOffset(dx, dy, dz)` for a displacement,
`originPoint(pointRef)` for a referenced point, `originVertex(id)` for an own
topology vertex, and `originCenter()` for the existing center anchor. The last
two require geometry and are not available on groups. A carried center anchor
is not necessarily the center of the current axis-aligned bounding box.

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

Use `originPoint(pointRef)` on any model to make a referenced point zero.
For geometric models, `originVertex(id)` selects an own topology vertex and
`originCenter()` selects the carried center anchor. The [origin and rotation guide](../../guides/origins-and-rotation/)
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
- A group uses its first member's local coordinates, retaining relative placement.
- `expose()` brings a reference into the outer model's local space. For a
  repeated part, use the reference from its specific instance.

Export uses these same coordinates: a standalone part has local geometry,
and a composition includes its parts' resolved placement. The chosen output
scale and up axis are applied afterward. See [exporting models](../../guides/exporting/).

## Group origins

A group first solves the placement of its direct members, then expresses all
members in the **first member's local coordinate frame**, including its origin
and axes. This is the same reference rule used by `union`, `intersect`, and
`loft`; `cut` uses the stock's frame. Reordering members can change the group's
frame, while preserving their relative placement. A nested group is one member,
with its own existing frame. An empty group uses the default origin and axes.
A relation's rotation affects that solved member frame; rotating the member's
geometry directly with `.rotate()` does not redefine its local axes.

```ts
import {box, group} from '@code3d/core';

const base = box(20, 4, 10).originOffset(0, 2, 0);
const lid = box(20, 2, 10).originOffset(0, -1, 0);
const assembly = group([base, lid]);
const mounted = assembly.originPoint(lid.center);
```

Here the unrestrained member origins coincide at the contact plane. That point
becomes the group origin. `originPoint(lid.center)` chooses the lid's center in
the assembled coordinates; `originOffset()` can then shift it further. Both
operations re-express the whole group, preserving member spacing and internal
relations. The default is chosen once and does not overwrite explicit edits.

Changing the first member's origin before constructing a new group changes the
reference frame, even if constraints keep its physical geometry in place.
Changing a later member's origin does not select a different reference member;
its placement still follows the assembly constraints.
Within an existing model, origin edits also update its own stored relation
references, so a constraint on a selected geometric point still follows that
same point.

For repeated geometry, select an instance's named reference, such as
`assembly.originPoint(rightPart.body.center)`. A reference to the shared source
alone is ambiguous and is rejected. The same instance resolution applies to
`expose()`.
