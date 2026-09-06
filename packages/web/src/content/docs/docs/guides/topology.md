---
title: Selecting vertices, edges, and faces
description: Pick topology for fillets, chamfers, shells, origins, and relation anchors.
---

Start with a box:

```ts
import {box} from '@code3d/core';

const base = box(36, 4, 24).fillet(1);
```

## Round all edges

`fillet(radius)` rounds every edge. `chamfer(distance)` bevels every edge.
The number must fit the geometry: an operation can fail when its size consumes
a small face or creates an invalid intersection.

## Choose edges visually

Place the cursor inside the `fillet` argument area. The edge tool lets you
select the edges to round. Selecting specific edges adds their IDs as the
second argument, for example `fillet(1, [2, 4])`.

The tool keeps the operation's input edges available for selection while
showing its result. Use the panel to adjust the radius or distance; those
edits return to the source as you type.

**Use all edges** removes the second argument. Deselecting every explicit edge
also returns to all-edge mode; an empty array is not an explicit no-op.

Selections write back immediately. Pressing `Esc` does not discard them or
close the tool; move the editor cursor away from the call to leave it, and
use Undo to revert an edit.

## Hollow a solid

`shell(thickness, removedSurfaceIds?)` creates uniform walls in a connected solid.
Positive thickness offsets inward and preserves its outside boundary; negative
thickness offsets outward and preserves the original boundary on the inside.
Outward offsets use rounded joins where neighboring offset faces separate.

```ts
const enclosure = box(40, 24, 30).shell(1.5, [4]);
const sealed = box(40, 24, 30).shell(1.5);
```

For this box, S4 is its +Y face. Removing it makes an open enclosure. Place the
cursor inside `shell(...)` to adjust **Wall thickness** and toggle **Openings**
on the input model while viewing the result. IDs belong to that input model.
The picker retains removed faces so you can close an opening again.

Omitting the surface array, or passing `[]`, creates an enclosed cavity.
**Close all openings** removes the array. Selecting every face is an error:
at least one surface must remain as a wall. Thickness must be finite and nonzero.
Offsets can fail around narrow features and complex curves; the input remains
available to correct the thickness or openings.

## IDs belong to a model

Edge, face, and vertex IDs have separate namespaces within each model. An ID
is not a position in a JavaScript array or a globally unique identifier.

Primitives use numbers starting at `1`. An operation that changes topology gives
an inherited element a path: `[inputIndex, ...previousId]`, with input indices
starting at `1`. New elements receive numeric IDs starting at `1` in that result.

For `loft([start, end])`, the two cap faces are `surface([1, 1])` and
`surface([2, 1])`; side faces are `surface(1)`, `surface(2)`, and so on. Changing
the number of side faces does not move the cap IDs. Boolean operations use the
same rule for every input, including cutting tools. Edges and vertices follow
the same rules in their own namespaces.

Single-input operations (`fillet`, `chamfer`, and `shell`) also add a path level.
After a fillet, an unambiguous original `E10` becomes `E[1,10]`. A later chamfer selects it with
`rounded.chamfer(0.5, [[1, 10]])`. The outer array is the selection list;
`[1, 10]` inside it is one edge ID. A subsequent operation prefixes the path
again, such as `[1, 1, 10]`.

Only one-to-one descendants inherit a path. Deleted elements have no descendant;
ambiguous splits and merges receive new numeric IDs. A middle loft section is
not a cap, and a section edge split by loft compatibility does not retain a
single edge identity. New-element numbering follows deterministic construction
and can change when that construction changes.

Rotation, scaling, placement, and exposed references keep complete IDs. Always
select IDs from the model passed into the operation being edited; IDs are not
interchangeable between a source and its result.

Shelling follows the same history rules: an unchanged boundary inherits
`[1, ...previousId]`, and offset walls get new numeric IDs. An opening rim can
inherit its former cap's surface path when the kernel records a one-to-one
modification. To open both ends of a two-section loft, use
`body.shell(1, [[1, 1], [2, 1]])`.

## Use topology as a relation anchor

`model.surface(id)`, `model.edge(id)`, and `model.vertex(id)` return
face, line, and point anchors. Use their plural forms to obtain a collection;
omitting the ID array returns all elements of that kind.

Place the cursor in one of these calls to pick its topology in the viewport.
Singular forms select one ID; plural forms let you toggle multiple IDs and
can explicitly use `[]` for no elements. That is different from fillet and
chamfer's all-edge behavior.

Continue querying a selected face or edge:

```ts
const face = base.surface([1, 1]);
const boundary = face.edges();
const corners = boundary[0].vertices();
const center = face.center;
```

Queries use the original model's IDs and stay within the selected element.
`face.edge(id)` reports an error if that edge is outside the face. The viewport
picker offers only the eligible edges or vertices, including when the geometry
is exposed from an assembly.

`center` is the selected geometry's local bounding-box center, carried through
transforms. Edges also provide `start`, `midpoint`, and `end` point anchors at
curve parameters 0, 0.5, and 1. A curve midpoint can differ from its center or
half-length point. Calculated points do not acquire vertex IDs; `.vertices()`
returns the actual topology, including a single vertex on a closed edge.

To choose a vertex as a rotation pivot, use `.originVertex(id)`. See
[origins and rotation](../origins-and-rotation/).

A named element exposed by a reusable part usually communicates intent better
than a caller maintaining its internal topology IDs. See
[reusable models](../reusable-models/).

## Recover from an operation failure

Check the input edges first, then reduce the radius or distance. A failed
fillet or chamfer can still expose its input model to the contextual tool,
so you can correct the operation without deleting it.
