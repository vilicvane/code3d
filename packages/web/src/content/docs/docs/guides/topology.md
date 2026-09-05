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

Derived operations preserve IDs with a one-to-one history, allocate new IDs
for new or ambiguous elements, and do not reuse retired IDs. Always select
from the model that is the input to the operation you are editing.

After a fillet, some original edges no longer exist. A later chamfer must use
IDs from the filleted model. Do not copy a list from the original box and assume
it still selects the same edges.

Shelling follows the same history rules. An unchanged boundary keeps its ID,
and offset walls get new IDs. An opening rim can retain its former cap's surface
ID when the kernel records it as a one-to-one modification.

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
const face = base.surface(1);
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
