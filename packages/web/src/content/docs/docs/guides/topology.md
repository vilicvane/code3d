---
title: Selecting edges and faces
description: Apply fillets and chamfers and understand model-local topology IDs.
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

## IDs belong to a model

Edge, face, and vertex IDs have separate namespaces within each model. An ID
is not a position in a JavaScript array or a globally unique identifier.

Derived operations preserve IDs with a one-to-one history, allocate new IDs
for new or ambiguous elements, and do not reuse retired IDs. Always select
from the model that is the input to the operation you are editing.

After a fillet, some original edges no longer exist. A later chamfer must use
IDs from the filleted model. Do not copy a list from the original box and assume
it still selects the same edges.

## Use topology as a relation anchor

`model.surface(id)`, `model.edge(id)`, and `model.vertex(id)` return
face, line, and point anchors. Use their plural forms to obtain a collection;
omitting the ID array returns all elements of that kind.

A named element exposed by a reusable part usually communicates intent better
than a caller maintaining its internal topology IDs. See
[reusable models](../reusable-models/).

## Recover from an operation failure

Check the input edges first, then reduce the radius or distance. A failed
fillet or chamfer can still expose its input model to the contextual tool,
so you can correct the operation without deleting it.
