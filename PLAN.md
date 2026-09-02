# code3d working plan

This file is the durable working memory for decisions and multi-step work. Keep
stable product goals in `DESIGN.md` and source-editing/tool contracts in
`TOOLING.md`; update this file whenever the active design or milestone changes.
Unscheduled product feedback is captured separately in `REQUESTS.md` so it does
not silently reorder the active milestones.

## Confirmed direction

- Source code is the only persistent model state. GUI changes write back to it.
- Author code remains ordinary JavaScript/TypeScript and may freely construct,
  reuse, copy, collect, and derive model values.
- Rendering is driven primarily by source or GUI object selection. Exporting is
  a publishing boundary and only a preview fallback, not a render prerequisite.
- `model()` is not a required entry wrapper. Any runtime model object can be
  selected and rendered.
- `Model` and `Anchor` are both core abstractions. A model is also usable as its
  intrinsic origin anchor; named anchors such as `top`, `bottom`, and `axis`
  describe local frames on that model.
- `model.relate(self => constraint)` creates a new semantic-immutable model
  value that shares geometry and carries the returned constraints. The callback
  parameter is that new value.
- Anchor methods return immutable constraint expressions. `on()` relates two
  complete local frames and `offset(x, y, z)` adjusts the relation in the target
  anchor's frame.
- Standalone `union`, `cut`, and `intersect` functions are geometry-evaluation
  boundaries. They collect and solve operand relations without introducing an
  author-facing composition object.
- Chained calls are the human-facing syntax for constraint derivation; they do
  not imply mutation or a persistent CAD feature history.
- A composite is broad: any connected set of occurrences and spatial relations
  is a composite, including copy, pattern, boolean operands, groups, and named
  assemblies. A composite can itself be reused as geometry in a larger model.
- Object replacement/deletion is not a core modeling primitive. JavaScript
  bindings, reachability, derivation, and runtime occurrences describe what
  exists.
- Model Outline lives with the editor. Clicking navigates source while hovering
  provides a transient object preview; it is not a scene tree or persistent
  viewport controller. A lineage or execution timeline is an optional view over
  runtime derivation, not the persisted source of truth.
- Monaco multi-selection and automatic boolean code generation are deferred
  until single-object discovery, rendering, and position relations are solid.

## Invariants

- Public model values do not expose OpenCascade or Three.js details.
- GUI tools resolve an explicit source-edit scope and use the common tool intent
  and transaction mechanism.
- Tool commits preserve the editor caret and its rendering scope. A non-focusing
  GUI popover shows a trimmed, syntax-highlighted source excerpt with the
  changed range marked.
- Units remain UI metadata; no implicit runtime conversion occurs.
- Runtime trace data may explain and locate values, but must not constrain which
  JavaScript/TypeScript construction patterns users can write.
- The editor caret resolves the exact source occurrence being inspected. A
  value site renders that value alone; an operation-input site may also render
  its peer inputs as non-interactive context. Mouse hover over source code does
  not change the viewport.
- Repeated executions of the same source occurrence are presented together,
  including values produced by loops or collection operations.
- Export status must not change the geometry or position semantics of an object.

## Milestones

### 1. Rootless authoring and optional exports — complete

- Remove the requirement that `default export` is a `ModelObject`.
- Compile successfully when the module produces any traceable model object.
- Use source selection as the primary render target.
- Use a model export as a fallback; without one, use the latest produced object.
- Remove `model()` from the authoring API and examples; selectable objects and
  optional exports cover its former role.

Status: complete. Rootless selection and optional exports were implemented in
`809fcc7`; the remaining `model()` API entry has now been removed.

### 2. Runtime object outline and source context — in progress

- Record top-level bindings, source sites, export names, collections, runtime
  instance counts, and evaluation order.
- Add a compact Model Outline above the editor. Click only navigates to bindings
  and expressions; hover temporarily previews the corresponding runtime values
  and restores the caret-selected view on leave.
- Group repeated executions by source site and expand them into occurrences.
- Hide anonymous intermediates by default and expose them through an expanded
  lineage view.
- Match catalog entries across recompiles using source-aware identities rather
  than transient runtime node IDs alone.
- Project explicit runtime operations and typed operand roles onto exact source
  occurrences without inferring them from B-Rep topology.
- When the caret is on an operation input, render non-interactive, dimmed peer
  context; a declaration or value expression remains isolated.

Status: the runtime index and Model Outline are implemented. Metadata includes
module/local bindings, anonymous source expressions, export aliases,
collections, per-execution outputs, evaluation order, and typed operation
inputs. The outline shows module bindings with optional local lineage, source
navigation on click, and temporary object preview on hover. The exact
operation-input occurrence under the caret drives the separate non-selectable
viewport context layer, so the same value can render differently at its
declaration and at a Boolean use site. Source-aware identities survive normal
recompiles and parameter write-back; matching across large control-flow or
structural rewrites remains open.

### 2a. Unified dock panels — complete

- Keep panels collapsed by default and separate panel state from panel content.
- Share collapsed, transient peek, and pinned behavior across object and
  property panels.
- Centralize `Alt+1` / `Alt+2`, allow multiple pinned panels, and let `Escape`
  dismiss only the current transient peek.
- Keep a peek open across focus and pointer-driven controls without persisting
  panel state into model source or browser storage.

Status: R-002 is implemented as reusable dock panel infrastructure.

### 3. Anchor constraint graph — first slice complete

- Keep B-Rep geometry local and store constraints on immutable model copies.
- Support model-origin, center, top, bottom, and axis anchors.
- Solve directly determined rigid-frame `on()` relations and validate multiple
  constraints for consistency.
- Resolve related models only when rendering or evaluating standalone Boolean
  operations.
- Preserve constraint source and parameter provenance for GUI tools.

Status: implemented for directly solvable frame relations. The old public
`at`, `move`, and `rotate` placement paths were removed rather than retained as
compatibility APIs.

### 4. Relation-aware GUI tools — translation slice complete

- Show the translation gizmo only when the selected model carries a constraint.
- Edit traced `offset()` parameters at their upstream source target.
- When an `on()` relation has no offset yet, insert one on the constraint
  expression; later drags edit that call's parameters instead of stacking calls.
- Orient gizmo axes and previews in the target Anchor frame.
- Add rotation relations and previews once their author-facing constraint
  vocabulary is selected.
- Preview the relation source as a ghost when useful.
- Add copy and pattern tools on top of the same relation intents.
- Keep the caret-selected context stable across gizmo and Inspector commits;
  present the applied edit plan in a temporary code popover instead of moving
  the editor selection.

### 5. Object combination tools

- Handwritten standalone `union`, `cut`, and `intersect` functions are now the
  only Boolean API; the old instance methods were removed.
- Later allow an explicit tool mode to resolve multiple semantic selections.
- Treat the main selection as the primary boolean operand and result frame.
- Initially generate a new binding in a safe common lexical scope; do not guess
  which downstream JavaScript references should change.

## Open questions

- The constraint vocabulary beyond exact-frame `on()` and `offset()`, including
  partially constrained point, axis, plane, distance, and angle relations.
- Topology-backed face, edge, and vertex anchors beyond the first canonical
  bounding-frame anchors.
- How to diagnose under-constrained systems once partial constraints exist; the
  first solver intentionally accepts only relations that directly determine a
  rigid transform.
- How Boolean results expose operand anchors and provenance for later relations.
- Whether uniform scaling is geometry derivation, occurrence placement, or two
  explicitly named operations.
- How much runtime lineage to retain and mesh eagerly for large models.
- Whether Model Outline eventually needs thumbnails or an optional
  execution-time projection without taking on viewport-control semantics.
- Rules for lifting inline expressions or values from different lexical scopes
  when automatic combination tools are eventually introduced.

## Completed foundation

- `76e91d8`: initial OpenCascade prototype.
- `0eddd6f`: source-backed parameter editing.
- `a83f36e`: common source-backed modeling tools.
- `d28443d`: Prettier integration and stabilized source-backed editing.
- `83a847f`: exact source-node previews, including repeated runtime objects.
