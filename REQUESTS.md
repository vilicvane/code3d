# code3d request inbox

This file captures unscheduled product requests without changing the active
order in `PLAN.md`. When a request is ready for implementation, move its
accepted design into the relevant milestone while keeping the original intent
here.

## R-001 Object relationships and contextual preview

Status: source-occurrence slice implemented; richer relation UI deferred

### Request

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

### Earlier interaction sketch

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

### Prototype decisions

- The editor caret at a traced value or declaration renders only the value
  produced there.
- The editor caret at a traced operation input renders that value normally and
  its peer inputs as neutral, non-interactive dimmed context.
- Repeated executions of one operation-input source site are aggregated into
  the same preview target.
- Model Outline aggregates bindings and local expressions; repeated runtime
  instances do not become redundant navigation rows. Clicking is navigation
  only, while hovering temporarily renders the entry's runtime values without
  changing the caret selection.

### Deferred decisions

- Whether boolean tools need a distinct context color rather than neutral dim.
- Whether later source relation lenses need a different ranking policy.
- Whether assembly membership belongs in the same visual lens as construction
  operations or uses a separate mode.

## R-002 Unified collapsible GUI panels

Status: implemented

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

### Prototype decisions

- Shortcuts are `Alt+1` for Model Outline and `Alt+2` for Properties.
- Panel state resets each session; multiple panels may be pinned.
- `Escape` dismisses only a transient peek and does not unpin panels.

### Deferred decisions

- Whether opening one pinned panel should collapse another on narrow viewports.
- Whether shortcuts should become user-configurable.

## R-003 User-defined primitives over OpenCascade

Status: captured, not scheduled

### Request

- Give users a supported path to build their own primitives from OpenCascade
  capabilities instead of waiting for code3d to wrap every modeling operation.
- This escape hatch is especially important while code3d's built-in primitive
  library is still incomplete.
- A custom primitive should behave like a built-in one: it must support normal
  composition, booleans, rendering, source tracing, parameters, and the object
  catalog.

### Architecture direction

- Put OpenCascade behind an explicit kernel/interoperability boundary. Do not
  expose a raw OpenCascade shape as the public `ModelObject` representation.
- Let a user-defined builder produce an opaque, code3d-owned geometry value,
  then adopt that value into a normal `ModelObject` with a fresh position
  relation.
- Keep geometry ownership and OpenCascade lifetime management inside code3d;
  raw handles must not escape a builder scope or be deleted by both user code
  and the runtime.
- Consider two layers: a stable, typed kernel facade for common topology and
  construction operations, plus a clearly marked low-level OpenCascade escape
  hatch for capabilities the facade does not yet cover.
- The API should work as ordinary JavaScript/TypeScript functions so custom
  primitives remain reusable modules rather than a separate plugin-only model.

Illustrative shape only; names are deliberately undecided:

```ts
const gear = definePrimitive(
  'gear',
  ({kernel}, teeth: number, radius: number) =>
    kernel.build(scope => {
      // Use the typed facade, or deliberately enter low-level OC here.
      return scope.adopt(/* kernel result */);
    }),
);

const driveGear = gear(24, 18).move(30, 0, 0);
```

### Required contracts

- Define exactly which returned topology types can become model geometry and
  how invalid, null, or non-solid results are reported.
- Ensure custom primitives run only after the OpenCascade kernel is ready and
  in the same worker/runtime boundary as built-in primitives.
- Preserve source and parameter provenance at the custom primitive call site;
  internal implementation details may optionally expose deeper diagnostics.
- Make meshing tolerance, serialization, caching, and geometry disposal follow
  the same policies as built-in primitives.
- Keep the interoperability layer versioned so upgrading OpenCascade does not
  silently break every user module.

### Open decisions

- Whether the first version exposes replicad's `Shape3D`, a code3d-owned
  `KernelShape`, or both through separate stable and unsafe APIs.
- Whether low-level builders may be asynchronous or must stay synchronous
  inside the compiler worker.
- How custom primitives publish editor types and documentation without
  requiring a full plugin system.
- Whether builder internals appear in the runtime lineage or collapse into one
  semantic primitive operation by default.

## R-004 Source-local modeling diagnostics

Status: captured, not scheduled

### Request

- Modeling errors should appear near the source expression where concrete
  evaluation failed, instead of only in a global error bar.
- For example, if constraints do not have a unique consistent solution while
  evaluating `union(...)`, `cut(...)`, or another composition boundary, mark
  that call site.
- Keep the marker compact. Hovering or clicking it should reveal the detailed
  diagnostic.

### Architecture direction

- Propagate structured modeling diagnostics with a source span, error kind,
  summary, and details; do not infer locations later from error strings.
- Attribute an evaluation failure to the nearest source-level operation that
  requested the solve. Related constraint expressions may be offered as
  secondary locations when they can be traced precisely.
- Render the primary diagnostic through Monaco markers or decorations while
  retaining a global summary for errors whose source cannot be identified.

### Open decisions

- Whether an inconsistent constraint system should mark only the composition
  boundary, every contributing constraint, or the boundary plus expandable
  secondary locations.
- Whether hover details are sufficient or clicking should also select and
  preview the related models and constraints.
