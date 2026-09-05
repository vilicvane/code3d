# R-001 Object relationships and contextual preview

> Historical snapshot, frozen on 2026-09-05. Remaining work and discussion:
> [GitHub #2](https://github.com/vilicvane/code3d/issues/2). The text below
> records the pre-migration state, not a live backlog.

The source-occurrence slice is implemented; richer relationship UI remains
open.

## Request

- The object catalog should communicate relationships between objects.
- If `base` is produced from `plate` and `mountingHoles`, hovering or selecting
  `base` should reveal that relationship in some form.
- Selecting `mountingHoles` should not render the holes in isolation: `plate`
  should also appear as dimmed operation context.
- Relationships are directional. The exact rules for which related objects to
  show remain open.
- Placing the editor caret at a value declaration and at the same value used as
  an operation input are different interactions: the declaration shows only
  that value, while the operation use also shows its peer inputs as dimmed
  context. Mouse hover over source code does not change the viewport.
- Model Outline belongs above the editor. Clicking only navigates to a
  declaration or expression; hovering temporarily previews that entry and
  restores the caret-selected view on leave.

## Preliminary model

Do not reduce this to a parent/child object tree. Preserve a directed graph with
explicit operation nodes and typed roles:

```text
plate ───────────── receiver ─┐
                              ├─ cut/reduce ─ output ─ base
mountingHoles ─────── tools ──┘
```

This lets the UI distinguish several different meanings of “related”:

- operation inputs and output, such as boolean receiver, tools, and result;
- peer inputs participating in the same operation;
- assembly membership, such as children of a group;
- value derivation, copy, and pattern relationships;
- collection membership and source bindings;
- spatial relationships from the position-relation graph.

These relationship types should remain distinct even if the object catalog
projects them into one compact view.

## Earlier interaction sketch

This sketch motivated the runtime graph, but catalog-driven preview and pinning
were superseded by exact source-occurrence interactions:

- Hover is temporary; selection pins the same context.
- Focus objects render normally. Context objects render dimmed or as a quiet
  outline and should not compete with the focus selection.
- Focusing an operation result shows its immediate producing operation and
  highlights the direct inputs in the catalog.
- Focusing one operation input shows its peer inputs as dimmed context. This is
  the initial rule that makes `mountingHoles` appear together with `plate`.
- A selected result may expose an expandable one-hop upstream view. Do not
  recursively reveal the whole history by default.
- Downstream consumers should initially be indicated in the catalog rather
  than automatically rendered. Rendering them may obscure the object being
  inspected.
- If an object has multiple consumers or belongs to multiple operations, show
  the number of contexts and let the user choose one instead of guessing.
- For a collection entry, aggregate shared relations and avoid drawing one edge
  per runtime instance until the entry is expanded.

## Implementation implications

- Capture relationships from runtime modeling operations, not by guessing from
  the final B-Rep or source syntax alone.
- Runtime operation records need stable IDs, evaluation order, typed input
  roles, output node IDs, and source references.
- The catalog needs to map bindings and collections onto those runtime nodes.
- The viewport needs a separate contextual render state so dimmed objects do
  not become selected objects or gain gizmos.
- This work naturally fits the runtime-catalog lineage milestone, but the graph
  schema should be compatible with the later immutable position-relation graph.

## Prototype decisions

- The editor caret at a traced value or declaration renders only the value
  produced there.
- The editor caret at a traced operation input renders that value normally and
  its peer inputs as neutral dimmed context. Clicking a peer switches focus to
  its exact operation-input source target.
- Repeated executions of one source site remain under the same source target
  but retain separate evaluation results. A collection returned by one
  evaluation remains grouped as one value.
- A selected `cut` tool renders its complete shape normally and overlays the
  exact volume removed from the receiver with a distinct emphasis.
- A selected `union` input distinguishes exact overlap volume; when operands
  only touch, it marks the exact B-Rep contact section instead.
- Boolean operation decorations hide during transient movement. Cancel restores
  the compiled decoration; commit waits for the next compile's exact topology.
- Model Outline aggregates bindings and local expressions; repeated runtime
  instances do not become redundant navigation rows. Clicking is navigation
  only, while hovering temporarily renders the entry's runtime values without
  changing the caret selection.

## Deferred decisions

- Whether boolean tools need a distinct context color rather than neutral dim.
- Whether later source relation lenses need a different ranking policy.
- Whether assembly membership belongs in the same visual lens as construction
  operations or uses a separate mode.
