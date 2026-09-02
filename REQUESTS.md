# code3d request inbox

This file captures unscheduled product requests without changing the active
order in `PLAN.md`. When a request is ready for implementation, move its
accepted design into the relevant milestone while keeping the original intent
here.

## R-001 Object relationships and contextual preview

Status: captured, not scheduled

### Request

- The object catalog should communicate relationships between objects.
- If `base` is produced from `plate` and `mountingHoles`, hovering or selecting
  `base` should reveal that relationship in some form.
- Selecting `mountingHoles` should not render the holes in isolation: `plate`
  should also appear as dimmed operation context.
- Relationships are directional. The exact rules for which related objects to
  show remain open.

### Preliminary model

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
- spatial relationships, once the position-relation graph exists.

These relationship types should remain distinct even if the object catalog
projects them into one compact view.

### Initial interaction policy

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

### Implementation implications

- Capture relationships from runtime modeling operations, not by guessing from
  the final B-Rep or source syntax alone.
- Runtime operation records need stable IDs, evaluation order, typed input
  roles, output node IDs, and source references.
- The catalog needs to map bindings and collections onto those runtime nodes.
- The viewport needs a separate contextual render state so dimmed objects do
  not become selected objects or gain gizmos.
- This work naturally fits the runtime-catalog lineage milestone, but the graph
  schema should be compatible with the later immutable position-relation graph.

### Open decisions

- Whether selecting a result should also ghost its inputs in the viewport or
  only highlight them in the catalog by default.
- Whether boolean tools need a distinct context color rather than neutral dim.
- How to choose the initially visible context when an object has multiple
  producing or consuming operations.
- Whether assembly membership belongs in the same visual lens as construction
  operations or uses a separate mode.

## R-002 Unified collapsible GUI panels

Status: captured, not scheduled

### Request

- Object catalog, object properties, and similar GUI panels should be collapsed
  by default so the model viewport remains visually dominant.
- A compact title or handle should show the panel name and its shortcut.
- Hovering the handle temporarily expands the panel.
- Clicking the handle or pressing its shortcut toggles a persistent expanded
  state.
- This should become a shared mechanism for small dialogs and tool panels, not
  separate behavior implemented by each panel.

### Preliminary state model

Use one reusable panel controller with three visible states:

```text
collapsed ── hover ──> peek
    │                   │
 click / shortcut       │ pointer leave
    ▼                   ▼
 pinned <────────── collapsed
```

- `collapsed`: only the compact title/shortcut handle is visible.
- `peek`: temporary expansion caused by hover; leaving the handle and panel
  returns it to `collapsed`.
- `pinned`: persistent expansion toggled by click or shortcut; hover state no
  longer controls visibility.

### Interaction rules

- Moving from the handle into the panel must not close it; use the combined
  handle-and-panel hover region or a short close grace period.
- Keyboard focus, pointer capture, text input, sliders, and gizmo/tool drags
  must keep a peeked panel open until the interaction finishes.
- Clicking or using the shortcut while pinned collapses the panel.
- On touch devices, where hover is unavailable, tapping the handle toggles the
  pinned state directly.
- Only one transient peek may need to be visible at a time, while multiple
  pinned panels may remain open if space permits.
- Panel visibility is UI state, not model state, and must never write into the
  model source file.
- The shared mechanism needs accessible focus behavior, `aria-expanded`, and a
  non-hover keyboard path.

### Architecture direction

- Introduce a reusable `PeekPanel` or `DockPanelController` rather than adding
  catalog-specific CSS and listeners.
- Separate panel state from panel content so the catalog, inspector, relation
  views, and future tool dialogs can reuse it.
- Let the layout layer coordinate placement, overlap, z-order, and which
  transient panel is currently peeking.
- Shortcut registration should be centralized so titles can display the actual
  assigned key and conflicts can be detected.

### Open decisions

- Exact shortcuts and whether they use plain keys, number keys, or modifier
  chords.
- Whether pinned/collapsed preferences survive reloads or reset each session.
- Whether opening one pinned panel should collapse another on narrow viewports.
- Whether `Escape` only dismisses a transient peek or also unpins the active
  panel.
