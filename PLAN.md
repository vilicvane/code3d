# code3d working plan

This file is the durable working memory for decisions and multi-step work. Keep
stable product goals in `DESIGN.md` and source-editing/tool contracts in
`TOOLING.md`; update this file whenever the active design or milestone changes.
Unscheduled product feedback lives in one file per request under `requests/` so
it does not silently reorder the active milestones. Closed requests move to
`requests/closed/`.

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
- Multi-model operations receive their ordered model collection as an array in
  the first argument, leaving later arguments available for operation metadata
  or options.
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
  its peer inputs as dimmed context that can switch input focus. Mouse hover
  over source code does not change the viewport.
- When a source view contains multiple focus occurrences, clicking one switches
  the selected runtime instance without moving the caret or replacing its
  source context. Clicking a dimmed operation peer instead navigates to that
  input's source target and makes it the new focus; decorations are never
  selection candidates. Normal recompilation preserves an occurrence selection
  when it still exists.
- Operation-specific emphasis is supplied through generic viewport decoration
  providers. Boolean input scopes can mark exact B-Rep intersection volumes and
  union contact sections without teaching the viewport those semantics.
- A provider chooses whether its decoration remains visible during a tool
  preview. Boolean regions hide while geometry moves, then return on cancel or
  from newly evaluated topology after commit.
- A source call renders one evaluation result at a time. Repeated executions
  remain distinct evaluation groups; a collection value renders all objects
  returned by that single evaluation rather than flattening execution and
  collection scopes together.
- Export status must not change the geometry or position semantics of an object.

## Milestones

### Persistent project and reusable metric fasteners — complete

- [R-009](requests/closed/R-009-persistent-multi-file-workspace.md) replaces the
  single-document prototype with a browser-persistent, path-addressed project,
  then carries file identity through Monaco, compilation, runtime tracing, and
  GUI source edits.
- [R-010](requests/closed/R-010-metric-fastener-library.md) uses that project boundary
  to ship an editable TypeScript fastener library, while adding the general
  helical/profile modeling capabilities needed for accurate screws and Boolean
  hole tools.
- [R-011](requests/closed/R-011-unify-interface-language.md) additionally makes
  English the single interface language across the resulting project and
  modeling workflows.

Status: complete. The browser-persistent ZenFS project, first-class module
graph, file-qualified source/tool pipeline, editable metric fastener library,
general helical-thread foundation, one-time library migration, and English UI
have passed build and host-browser verification. [R-014](requests/closed/R-014-cross-file-editor-navigation.md)
connects Monaco's built-in definition navigation to the same project document
boundary for Ctrl/Cmd+Click and F12 across files.

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
- Index repeated executions by source site while preserving each evaluation's
  result boundary; collections remain values within an evaluation.
- Hide anonymous intermediates by default and expose them through an expanded
  lineage view.
- Match catalog entries across recompiles using source-aware identities rather
  than transient runtime node IDs alone.
- Project explicit runtime operations and typed operand roles onto exact source
  occurrences without inferring them from B-Rep topology.
- When the caret is on an operation input, render dimmed peer context that can
  be clicked to switch input focus; a declaration or value expression remains
  isolated.
- Treat ordinary calls and JSDoc design arguments as explicit evaluation
  contexts for source inside model-producing functions.

Status: the runtime index and Model Outline are implemented. Metadata includes
module/local bindings, anonymous source expressions, export aliases,
collections, per-execution outputs, evaluation order, and typed operation
inputs. The outline shows module bindings with optional local lineage, source
navigation on click, and temporary object preview on hover. The exact
operation-input occurrence under the caret drives the separate non-selectable
viewport context layer, so the same value can render differently at its
declaration and at a Boolean use site. `cut` tool inputs additionally show their
exact removed volume; `union` inputs show overlap volumes or contact sections.
Those regions stay hidden during transient movement and are recomputed by the
kernel after commit. Source-aware identities survive normal recompiles and
parameter write-back; matching across large control-flow or structural rewrites
remains open. [R-005](requests/closed/R-005-preserve-operation-context-when-switching-runtime-occurrences.md)
is complete: viewport occurrence selection and ordinary write-back preserve the
caret-selected operation context.
[R-007](requests/closed/R-007-switch-operation-focus-from-dimmed-peers.md) is
also complete: dimmed operation inputs link back to their exact source targets
and can become the new focus directly from the viewport.
[R-008](requests/closed/R-008-render-immutable-chain-values-by-evaluation.md)
is complete: source targets preserve evaluation boundaries, so chained calls
show the value produced at that step while collection bindings show the
collection returned by their own evaluation.
[R-015](requests/closed/R-015-function-design-arguments.md) is complete:
repeated `@code3d.arguments [...]` annotations provide source-only design
contexts for called or uncalled functions, while the GUI switches those
contexts alongside ordinary runtime calls and Monaco highlights recognized
code3d annotations.
[R-012](requests/R-012-render-downstream-context-while-editing-relations.md)
will extend relation-source views with the concrete downstream composition
context that consumes each constrained value. [R-013](requests/R-013-drill-from-composition-preview-to-object-source.md)
adds explicit double-click drill-down from an active composition operand to its
best defining source.

### 2a. Unified dock panels — complete

- Keep panels collapsed by default and separate panel state from panel content.
- Share collapsed, transient peek, and pinned behavior across object and
  property panels.
- Centralize `Alt+1` / `Alt+2`, allow multiple pinned panels, and let `Escape`
  dismiss only the current transient peek.
- Keep a peek open across focus and pointer-driven controls without persisting
  panel state into model source or browser storage.

Status: [R-002](requests/closed/R-002-unified-collapsible-gui-panels.md) is
implemented as reusable dock panel infrastructure.

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

- Show the translation gizmo only when the selected model carries a constraint
  and the caret-selected operation input supplies relative-position context.
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

Status: [R-006](requests/closed/R-006-show-spatial-tools-only-in-a-relative-position-context.md)
is complete. Value declarations and operation outputs do not expose the
translation gizmo or offset controls; eligible composition inputs do.

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
