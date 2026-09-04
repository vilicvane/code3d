# code3d working plan

This file is the durable working memory for decisions and multi-step work. Keep
stable product goals in `DESIGN.md`, source-editing/tool contracts in
`TOOLING.md`, and detailed not-yet-active refactors under `plans/`; update this
file whenever the active design or milestone changes. Unscheduled product
feedback lives in one file per request under `requests/` so it does not
silently reorder the active milestones. Closed requests move to
`requests/closed/`.

## Confirmed direction

- Model editing is code-first. GUI editing is an important but restrained
  supplement for spatial work that is awkward in code; information display may
  use the GUI much more broadly because it does not create a second editable
  source of truth.
- Source code is the only persistent model state. GUI changes write back to it.
- Author code remains ordinary JavaScript/TypeScript and may freely construct,
  reuse, copy, collect, and derive model values.
- A real code3d project is an ordinary Node/TypeScript package that owns its
  `package.json`, lockfile, and installed dependencies, including
  `@code3d/core`. The same source should run in a supported Node runtime without
  a code3d-only module syntax or hidden host dependency.
- Rendering is driven primarily by source or GUI object selection. Exporting is
  a publishing boundary and only a preview fallback, not a render prerequisite.
- `model()` is not a required entry wrapper. Any runtime model object can be
  selected and rendered.
- `Model` and typed point, line, face, and frame Anchors are core abstractions. A
  model is itself usable as its intrinsic frame Anchor. Solid primitives expose
  `center`, `top`, `bottom`, and `axis` through the same named-element mechanism
  available to user models rather than through a separate fixed-anchor path.
- `model.expose({...})` creates a semantic-immutable model with a type-inferred
  named-element interface. An element imported from an internal model is
  rebound into the exposed model's local frame, so reusable APIs do not leak
  their construction objects.
- `model.relate(self => constraint | constraints)` creates a new
  semantic-immutable model value that shares geometry and carries the returned
  constraint or constraint array. The callback parameter is that new value.
- Anchor methods return immutable constraint expressions. `on()` relates two
  complete local frames with opposing orientation, `flip()` selects the other
  orientation, and `offset(x, y, z)` adjusts the relation in the target Anchor's
  frame.
- Standalone `union`, `cut`, and `intersect` functions are geometry-evaluation
  boundaries. They collect and solve operand relations without introducing an
  author-facing composition object.
- Symmetric multi-model operations receive their ordered model collection as an
  array. `cut(stock, tools)` instead names its unique stock separately and keeps
  the ordered cutting tools in an array.
- Chained calls are the human-facing syntax for constraint derivation; they do
  not imply mutation or a persistent CAD feature history.
- Solid edges have model-local numeric IDs. Primitive traversal assigns the
  initial IDs; a derived value preserves strict one-to-one edge history,
  allocates newly created or ambiguous edges above the inherited high-water
  mark, and never reuses retired IDs. Deterministic source replay is the
  persistence mechanism rather than a separate topology ledger.
- A composite is broad: any connected set of occurrences and spatial relations
  is a composite, including copy, pattern, boolean operands, groups, and named
  assemblies. A composite can itself be reused as geometry in a larger model.
- Object replacement/deletion is not a core modeling primitive. JavaScript
  bindings, reachability, derivation, and runtime occurrences describe what
  exists.
- Monaco multi-selection and automatic boolean code generation are deferred
  until single-object discovery, rendering, and position relations are solid.

## Invariants

- Public model values do not expose OpenCascade or Three.js details.
- Public topology IDs are deterministic model semantics, not OpenCascade hash
  codes or current edge-array positions. Boolean results inherit only from the
  ordered primary operand; every other contributed edge is new in that ID
  namespace.
- GUI tools resolve an explicit source-edit scope and use the common tool intent
  and transaction mechanism.
- Source undo and redo remain Monaco history operations. Standard shortcuts
  invoke that same active-file history while GUI controls own focus, without
  moving focus back into the editor or maintaining a parallel GUI stack.
- Pending and active model compilation use one prominent, non-blocking progress
  indicator at the viewport edge. The application header has no parallel run
  state, and ready states do not leave persistent status chrome.
- Tool commits preserve the editor caret and its rendering scope. A non-focusing
  GUI popover shows a trimmed, syntax-highlighted source excerpt with the
  changed range marked.
- Units remain UI metadata; no implicit runtime conversion occurs.
- Runtime trace data may explain and locate values, but must not constrain which
  JavaScript/TypeScript construction patterns users can write.
- Named point, line, and face elements retain complete local frames. Solid
  relations remain directly solvable frame relations; code3d does not infer a
  partial solid-constraint system merely from an element's geometric kind.
- The editor caret resolves the exact source occurrence being inspected. A
  value site renders that value alone; an operation-input site may also render
  its peer inputs as dimmed context that can switch input focus. Mouse hover
  over source code does not change the viewport. In a layered source scene,
  focus solids are slightly translucent while context remains strongly dimmed,
  so overlaps stay legible; a single focus solid remains opaque.
- A constraint source site renders both relation participants and takes dimmed
  context from the concrete downstream composition that consumes the
  constrained value. The constrained value remains the relation-edit scope for
  spatial tools; the relation target does not replace downstream context.
- A caret on a named-element property keeps its surrounding relation visible,
  promotes the owning model, and highlights the typed point, line, face, or
  frame. Face elements highlight matching B-Rep face groups and their real
  boundaries rather than drawing a proxy plane. A focused item in Monaco's
  native completion list is applied to an in-memory project snapshot and that
  completed snapshot drives a transient compiled viewport; named elements use
  the current module for immediate feedback while the speculative compile is
  pending. The shared viewport progress indicator covers that pending
  interval. The actual source, caret, history, diagnostics, and tools remain
  bound to the incomplete editor revision.
- Constraint arrays retain one source/tool scope per member. Selecting a member
  uses only its frame and parameters; the array container does not synthesize a
  combined gizmo from potentially different constraints.
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
- The persistent project is user-owned except for the explicit `/examples`
  template boundary. A bundled-example version change and the explicit
  `Reset examples` action may replace that directory; `/model.ts`, `/lib`, and
  every other project path remain untouched.
- A project may use browser persistence or directly map a user-selected local
  directory through the same ZenFS-backed filesystem contract. Directory
  selection belongs to a URL-scoped workspace instance, never to the whole
  browser origin, so separate code3d pages may open different projects.
- A project has no privileged persistent entry file. The active editor file is
  the root module for the current compile, so every source file can be opened
  and previewed directly.
- Studio diagnostics and completion resolve the project's installed package
  declarations, while model evaluation resolves and executes the installed
  package implementation. These are separate consumers of one project module
  graph and must not be conflated into a hand-authored declaration shim.

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
general helical-thread foundation, default-project library seeding, and English UI
have passed build and host-browser verification. [R-014](requests/closed/R-014-cross-file-editor-navigation.md)
connects Monaco's built-in definition navigation to the same project document
boundary for Ctrl/Cmd+Click and F12 across files.
[R-020](requests/closed/R-020-managed-examples-directory.md) separates the
resettable bundled showcase from the persistent user workspace: all examples
live under `/examples`, while reset no longer replaces the project.
[R-021](requests/closed/R-021-local-folder-projects.md) adds direct local-folder
projects while retaining the default browser workspace and isolating directory
selection per page URL.

### 1. Rootless authoring and optional exports — complete

- Remove the requirement that `default export` is a `ModelObject`.
- Compile successfully when the module produces any traceable model object.
- Use source selection as the primary render target.
- Use a model export as a fallback; without one, use the latest produced object.
- Remove `model()` from the authoring API and examples; selectable objects and
  optional exports cover its former role.

Status: complete. Rootless selection and optional exports were implemented in
`809fcc7`; the remaining `model()` API entry has now been removed.

### 2. Runtime source context — in progress

- Record top-level bindings, source sites, export names, collections, runtime
  instance counts, and evaluation order.
- Index repeated executions by source site while preserving each evaluation's
  result boundary; collections remain values within an evaluation.
- Match catalog entries across recompiles using source-aware identities rather
  than transient runtime node IDs alone.
- Project explicit runtime operations and typed operand roles onto exact source
  occurrences without inferring them from B-Rep topology.
- When the caret is on an operation input, render dimmed peer context that can
  be clicked to switch input focus; a declaration or value expression remains
  isolated.
- Treat ordinary calls and JSDoc design arguments as explicit evaluation
  contexts for source inside model-producing functions.
- Later add an on-demand Elements panel in the viewport as a supplementary way
  to inspect the named elements available on the current model.

Status: the runtime index and source-context rendering are implemented. Metadata
includes module/local bindings, anonymous source expressions, export aliases,
collections, per-execution outputs, evaluation order, and typed operation
inputs. The exact operation-input occurrence under the caret drives the
separate non-selectable viewport context layer, so the same value can render
differently at its declaration and at a Boolean use site. `cut` tool inputs
additionally show their exact removed volume; `union` inputs show overlap
volumes or contact sections.
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
[R-012](requests/closed/R-012-render-downstream-context-while-editing-relations.md)
is complete: selecting an `on()` or `offset()` constraint renders the
constrained value with peers from its concrete downstream composition, exposes
multiple consumers as separate scopes, and enables relation tools directly.
Named-element property occurrences now refine that scope: the owning model and
typed anchor are highlighted while all relation participants remain visible.
Focused items in Monaco's native TypeScript member completion reuse the same
viewport preview immediately, then replace it with a model compiled from the
hypothetically accepted completion. The incomplete source and caret remain
unchanged, and the caret-selected scene returns when completion closes.
[R-017](requests/closed/R-017-completion-derived-model-preview.md) records this
completion-derived rendering contract.
[R-004](requests/closed/R-004-source-local-modeling-diagnostics.md) is complete:
structured model diagnostics retain their exact source span across the worker
boundary, and Monaco renders located evaluation failures inline while the
global error bar is reserved for failures without a reliable source location.
[R-013](requests/closed/R-013-drill-from-composition-preview-to-object-source.md)
is complete: an explicit double-click drills from the active composition
operand to its best exact binding or defining expression, including
file-qualified targets, while single-click focus switching and drag gestures
retain their existing meanings.
[R-016](requests/closed/R-016-viewport-elements-panel.md) is complete: the
on-demand Elements dock follows the selected occurrence, marks the element
under the source caret, and transiently previews exact point, line, face, and
frame decorations without editing source or retaining a parallel selection.

### 2a. Unified dock panels — complete

- Keep panels collapsed by default and separate panel state from panel content.
- Share collapsed, transient peek, and pinned behavior across the arguments and
  elements panels.
- Centralize `Alt+1` / `Alt+2`, allow multiple pinned panels, and let
  `Escape` dismiss only the current transient peek.
- Keep a peek open across focus and pointer-driven controls without persisting
  panel state into model source or browser storage.

Status: [R-002](requests/closed/R-002-unified-collapsible-gui-panels.md) is
implemented as reusable dock panel infrastructure.

### 3. Anchor constraint graph — first slice complete

- Keep B-Rep geometry local and store constraints on immutable model copies.
- Support a model's intrinsic frame and type-safe named point, line, and face
  elements. Primitives provide canonical center, top, bottom, and axis elements;
  reusable models can expose and rename internal elements in their own frame.
- Solve directly determined rigid-frame `on()` relations and validate multiple
  constraints for consistency.
- Let `flip()` choose between opposed and aligned frame orientation without
  encoding front/back as a special-case placement rule.
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
- Keep the caret-selected context stable across gizmo and contextual tool commits;
  present the applied edit plan in a temporary code popover instead of moving
  the editor selection.

Status: [R-006](requests/closed/R-006-show-spatial-tools-only-in-a-relative-position-context.md)
is complete. Value declarations and operation outputs do not expose the
translation gizmo or offset controls; eligible composition inputs and explicit
constraint source sites do.

### 4a. Topology-scoped modeling tools — in progress

- Assign stable numeric edge IDs at primitive boundaries and carry them across
  scale, fillet, chamfer, and Boolean derivations.
- Let `fillet(radius, edgeIds)` and `chamfer(distance, edgeIds)` modify an
  explicit edge set while retaining the one-argument all-edge form.
- Project stable IDs into render meshes and operation trace selections without
  exposing kernel hashes.
- Treat the full argument area of `fillet()` and `chamfer()` as the viewport
  tool entry. Include the first size parameter in the tool panel and keep edge
  selection available whether or not the optional edge-array argument already
  exists. Preserve a one-argument call until its selected edge set changes,
  then append the explicit array through the common tool transaction path; do
  not offer GUI insertion of modeling calls.
- While selecting, render the applied operation result as the primary solid and
  retain every original input edge at its pre-operation position as a
  hoverable/toggleable guide. Commit each edge-set or confirmed size change to
  source immediately while keeping the guide, hover, and selection panel
  interactive during background compilation. Newer edits invalidate older
  compile results, and the latest normal compiled model replaces the rendered
  result when ready; do not present an uncommitted operation result as if it
  had already taken effect. Outside selection, keep the weaker before/after
  comparison for an applied edge modification.
- Make deselection reversible at both levels: toggle individual edges or clear
  the set. Leaving the call's source focus or pressing `Escape` only dismisses
  the transient panel; already committed edits remain in source. The panel has
  neither Apply nor Cancel actions.
- Keep the contextual selection panel vertically ordered and stable under
  pointer hover; hover feedback belongs on the model rather than in moving text.

Status: complete. The runtime topology namespace, edge-scoped author API,
derivation transfer rules, render-mesh IDs, operation trace selections,
array-driven viewport picking, before/after comparison, reversible
selection, and source write-back are implemented. The Properties panel and
GUI operation-insertion path were removed pending a broader interaction design.

### 4b. Core package and Node-native projects — active

- Extract the author runtime into a real ESM `@code3d/core` package with emitted
  JavaScript, declarations, explicit exports, and an explicit tooling boundary.
- Make every real project resolve its own `node_modules`; remove the injected
  `code3d` module, duplicated declaration string, and host-runtime fallback.
- Keep TypeScript language-service resolution separate from model building and
  evaluation while making both honor the same project package graph.
- Make the authoring convention valid for direct execution by a supported Node
  runtime and for ordinary TypeScript emit.
- Preserve one project-local core/kernel runtime during repeated Studio
  evaluations without coupling the host to its concrete runtime classes.

Status: the repository is now a workspace with `@code3d/app`, `@code3d/core`,
and the standard-model demo package `@code3d/screws`. Core emits a shared
public type surface plus Node and tooling entries; package resolution from an
opened project's own `node_modules` remains the active next boundary. The
detailed working plan is
[plans/core-package-and-node-projects.md](plans/core-package-and-node-projects.md).
It records confirmed constraints separately from technical choices that should
remain adjustable as implementation evidence arrives.

### 5. Object combination tools

- Handwritten standalone `union`, `cut`, and `intersect` functions are now the
  only Boolean API; the old instance methods were removed.
- Later allow an explicit tool mode to resolve multiple semantic selections.
- Treat the main selection as the primary boolean operand and result frame.
- Initially generate a new binding in a safe common lexical scope; do not guess
  which downstream JavaScript references should change.

## Open questions

- Whether any solid-modeling use case justifies partially constrained point,
  line, plane, distance, or angle relations. General partial constraint solving
  is expected for sketching, but is not assumed to be necessary for solids.
- How explicit numeric topology selections should be promoted into reusable
  named point, line, and face anchors while retaining author-visible semantic
  names.
- How Boolean results expose operand anchors and provenance for later relations.
- Whether uniform scaling is geometry derivation, occurrence placement, or two
  explicitly named operations.
- How much runtime lineage to retain and mesh eagerly for large models.
- Rules for lifting inline expressions or values from different lexical scopes
  when automatic combination tools are eventually introduced.

## Completed foundation

- `76e91d8`: initial OpenCascade prototype.
- `0eddd6f`: source-backed parameter editing.
- `a83f36e`: common source-backed modeling tools.
- `d28443d`: Prettier integration and stabilized source-backed editing.
- `83a847f`: exact source-node previews, including repeated runtime objects.
