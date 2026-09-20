---
title: Model values and measurements
description: Understand immutable models, geometry measurements and composition.
sidebar:
  order: 2
---

Build models from reusable values, then measure their geometry or relative
placement. Queries return ordinary numbers and vectors; modeling operations
return new model values.

## Model values and coordinates

Operations produce new model values. Building another result must not change an
already-observable model's geometry, material, topology, or relations.

In `part.relate(self => ...)`, the callback parameter represents the new value.
`part` and any aliases or element references selected from it still refer to the
original value. Each constraint must involve the callback value.

A model's local geometry and its placement in a composition are separate.
`relate()` records how a part is placed when composed with other parts; observing
that part alone shows its local geometry. `originOffset()` changes geometry
coordinates without changing the shape. Position arrays use `[x, y, z]`; scalar
angles use degrees. Read [local coordinates](local-coordinates.md)
and [relations](relations.mdx) before mixing
origin changes, alignment, and rotation.

Constraints express `on`, `align` and fixed-axis [rotation coupling](api.md#rotation-coupling); relative `offset` and `rotate` operations
follow them as separate items in the `relate` array. For pivots, reference axes
and operation order, see the [placement guide](relations.mdx#transform-a-joint-result)
and [transformation example](../../app/examples/constraints/transformations.ts).

Build readable models from named intermediate values and public operations. A
profile followed by extrusion, or solids combined with Boolean operations,
keeps the construction understandable and editable by both people and agents.

## Measure geometry for another part

`distance(a, b, axis?)` measures models, finite topology, bounds or point anchors
in their solved placement and returns a normal non-negative number. Omit the axis
for shortest geometric distance; supply `x`, `y`, `z`, a direction vector or a
straight edge/axis reference for the gap between projected intervals. Overlap
returns zero. Existing relations are resolved on demand, before any group is
needed; subsequent relations do not update the number.

See the [measurement reference](api.md#measurements)
and the [fitted beam example](../../app/examples/operations/distance.ts). They cover
finite geometry, nested occurrences, axis frames and source-order dependencies.

## Geometry measurements

Read a model's dimensions in its own frame, or query its bounds and position
relative to another model:

```ts
import {box, group, offset} from '@code3d/core';

const base = box(20, 4, 20);
const part = box(8, 12, 4).relate(self => [self.on(base.up), offset(20, 0, 0)]);
const size = part.bounds().size; // [8, 12, 4]
const origin = part.position(base); // [20, 8, 0]
const minimum = part.bounds(base).minimum; // [16, 2, -2]
export default group([base, part]);
```

Finite edges and edge models provide readonly `.length`; finite surfaces and
face models provide `.area`. Solids provide `.area` for their total boundary
surface, including inner walls, and `.volume` for material volume, excluding holes
and cavities. These are plain numbers, follow geometry scaling, and retain the
original value when later operations create a new model. Infinite axes/planes
and groups do not have these measurements. See [length and area](api.md#length-and-area)
and [volume](api.md#volume), and select these properties in App for a read-only
visual measurement.

`model.bounds(relativeTo?)` returns readonly `minimum`, `maximum` and `size`
XYZ vectors for tight finite geometry bounds. By default it uses the model's
own local frame. An explicit reference includes solved placement and nested
member occurrences in that reference's frame. Empty groups have no finite
bounds; a source occurring more than once in the reference is ambiguous.

`model.position(relativeTo)` returns the model origin in the explicit reference's
local frame. A model's origin in its own frame is always `[0, 0, 0]`, including
point models whose geometry may be offset from that origin. Neither query
changes the model or its placement. These methods are available on every model
kind, including groups. As model members, `bounds` and `position` are reserved
names and cannot be used as exposed element names.

## Editing incomplete calls

Dimension-based primitives and numeric modeling methods retain required TypeScript
signatures while providing runtime defaults for omitted or `undefined` values.
Rotations and displacements default to zero, scaling to one, extrusion distance
to ten, and fillet radius, chamfer distance and shell thickness to one. Relation
rotation selectors use the same angle defaults; `pivot()` defaults to local zero.
Explicit invalid values retain their normal errors. These defaults work in
ordinary JavaScript execution as well as App previews.

The App displays defaults as placeholders without inserting source arguments.
Committing a spatial drag fills all remaining omitted defaults in that operation;
for example, dragging the X ring of `rotate()` writes `rotate(angle, 0, 0)`. The
edit and completion share one undo step. Use explicit dimensions in finished
models; the [reference](api.md#runtime-defaults-while-editing)
lists the actual defaults.

## Composition and topology

Topology capabilities follow dimension: vertices expose vertex selection, edges
add edge selection, and faces and solids add surface selection. Only solids
provide `fillet`, `chamfer`, and `shell`. Groups compose values and support
relations, exposed elements, and materials without pretending to be geometry.

Groups are model values and can be nested directly with `group([inner, other])`,
including in mixed `Model[]` collections. Nesting preserves each group's hierarchy;
`expose()` adds named references when callers need to address members.

A topology ID belongs to its owning model and element kind. It is a number or a
flat numeric path, such as `.edge([1, 3])`. Local edits (`fillet`, `chamfer`, `shell`)
preserve one-to-one IDs and allocate fresh IDs for new elements without reusing
retired numbers. Loft, extrusion and Booleans prefix inherited IDs by input;
transforms preserve complete paths. Inspect the result after topology changes
instead of assuming IDs from a different model still apply.
