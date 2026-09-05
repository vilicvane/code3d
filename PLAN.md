# code3d working plan

This file is the durable working memory for decisions and multi-step work. Keep
stable product goals in `DESIGN.md`, source-editing/tool contracts in
`TOOLING.md`, and detailed not-yet-active refactors under `plans/`; update this
file whenever the confirmed design changes. [GitHub Issues](https://github.com/vilicvane/code3d/issues)
is the single source for requirements, discussion, acceptance, and current work
status. A one-sentence issue is welcome; there are no required templates or
sections. Link implementation plans to their issues instead of maintaining a
second backlog here. `requests/` preserves pre-migration history only; its file
locations no longer track live status. The milestone sections below preserve
implementation context and historical outcomes, not a competing work queue.

## Confirmed direction

- Model editing is code-first. GUI editing is an important but restrained
  supplement for spatial work that is awkward in code; information display may
  use the GUI much more broadly because it does not create a second editable
  source of truth.
- Source code is the only persistent model state. GUI changes write back to it.
- Sketches use explicit `[kind, ID, data]` tuples: point data is `[x, y]`,
  line data is `[startPoint, endPoint]`. `base.derive([...])` retains locked
  upstream layers; local numeric point IDs and named `base.point(id)` handles
  distinguish ownership. IDs are independent per layer; new editor entries use
  local max + 1, without persistent `nextId` or renumbering surviving entries.
  Selecting a sketch opens a 2D point/line editor. Literal coordinates can be
  dragged; expression-driven coordinates stay source-edited. Continuous lines
  create/reuse endpoints without a standalone point creation tool, with numeric
  start X/Y or segment length/angle input, temporary X/Y direction locks,
  dense adaptive snapping, cancellation
  and one atomic source transaction per segment. Entered numbers define creation geometry,
  not persistent constraints. The editor does not yet infer regions, generate
  B-Reps, solve sketch constraints, or trim crossings.
  The next scope is common sketch tools and in-canvas numeric input, with
  Lucide for tool icons. See the requested [research and priority proposal](plans/sketch-editor.md)
  and [#23](https://github.com/vilicvane/code3d/issues/23); new curve and constraint
  tuple formats in that proposal are not yet confirmed.
- Author code remains ordinary JavaScript/TypeScript and may freely construct,
  reuse, copy, collect, and derive model values.
- A real code3d project is an ordinary Node/TypeScript package that owns its
  `package.json`, lockfile, and installed dependencies, including
  `@code3d/core`. The same source should run in a supported Node runtime without
  a code3d-only module syntax or hidden host dependency.
- Studio provides built-in core/screws when the root package metadata does not
  declare `@code3d/core`. Declaring core in dependencies, devDependencies,
  peerDependencies or optionalDependencies transfers the entire runtime to the
  project's packages; missing installations are errors. Built-in packages use
  real published artifacts, one shared core instance and an isolated internal
  dependency closure. Other npm packages still resolve from the project.
- Rendering is driven primarily by source or GUI object selection. Exporting is
  a publishing boundary and only a preview fallback, not a render prerequisite.
- Viewport file export supports STEP, STL and 3MF alongside PNG image export.
  The context menu has separate image and model entries; the model dialog
  remembers the last format. Both name files after the rendered value's binding,
  falling back to a generic name. Model export always uses current foreground
  geometry, without a separate export scope or viewport helpers/contextual ghosts.
  See [#13](https://github.com/vilicvane/code3d/issues/13).
- Base viewport appearance follows geometry kind: face models keep a filled
  surface visible from either side, while edge models render their authored
  color (or the neutral unpainted model color) as the curve itself. Solid
  surface and boundary treatment remains independent from profile and curve
  visibility.
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
  Rendering this value on its own preserves its intrinsic local placement;
  relation placement is resolved only when the value participates in a
  composition.
- Anchor methods return immutable constraint expressions. `on()` constrains
  points, lines, planes, or complete frames according to the anchor kinds.
  Centering and default orientation are secondary preferences. Face `flip()`
  selects aligned normals; explicit `offset(x, y, z)` pins the anchor position
  in the target frame, including an explicit zero offset.
- Standalone `union`, `cut`, and `intersect` functions are geometry-evaluation
  boundaries. They collect and solve operand relations without introducing an
  author-facing composition object.
- Symmetric multi-model operations receive their ordered model collection as an
  array. `cut(stock, tools)` instead names its unique stock separately and keeps
  the ordered cutting tools in an array.
- Chained calls are the human-facing syntax for constraint derivation; they do
  not imply mutation or a persistent CAD feature history.
- Model values have no chainable `named()` operation. Source bindings identify
  authored values; intrinsic primitive and group names remain only as runtime
  display and diagnostic fallbacks.
- Geometric model vertices, edges, and surfaces have independent model-local numeric ID
  namespaces.
  Primitive traversal assigns the initial IDs; a derived value preserves
  strict one-to-one topology history, allocates newly created or ambiguous
  elements above the inherited high-water mark, and never reuses retired IDs.
  Deterministic source replay is the persistence mechanism rather than a
  separate topology ledger. `model.vertex(id)`, `model.edge(id)`, and
  `model.surface(id)` return complete point, line, and face anchors: vertices
  use the owning model orientation, edges use their midpoint and tangent, and
  surfaces use their area centroid and a normal sampled at the surface's UV-domain
  midpoint (the centroid need not lie on a curved surface). Their `vertices(ids?)`, `edges(ids?)`,
  and `surfaces(ids?)` counterparts return ordered arrays of the same anchors,
  defaulting to every current stable topology ID when the argument is omitted.
- A composite is broad: any connected set of occurrences and spatial relations
  is a composite, including copy, pattern, boolean operands, groups, and
  assemblies. A composite can itself be reused as geometry in a larger model.
- Object replacement/deletion is not a core modeling primitive. JavaScript
  bindings, reachability, derivation, and runtime occurrences describe what
  exists.
- Monaco multi-selection and automatic boolean code generation are deferred
  until single-object discovery, rendering, and position relations are solid.

- Geometric models support `origin(x, y, z)`, `originVertex(id)`, `originCenter()`, and additive
  `originOffset(dx, dy, dz)`. The three setters replace earlier origin state without
  moving geometry. `rotate(x, y, z)` applies degree rotations about that origin,
  in fixed local X/Y/Z order, transforming geometry and named anchors while
  preserving topology IDs. Viewport origin and rotation tools edit the selected
  call through source transactions. See [#19](https://github.com/vilicvane/code3d/issues/19).
  Every geometric model exposes a `center` anchor initialized from its body's
  local bounding box and carried through transforms. `originCenter()` uses
  that anchor; origin edits never move `center`. Center and vertex origin
  drags append or edit `originOffset()` through the same source transaction.

## Invariants

- Public model values do not expose OpenCascade or Three.js details.
- `@code3d/core/replicad` exposes `definePrimitive(build)`: a synchronous
  builder returns a Replicad solid whose ownership transfers to a normal
  `SolidModel`. Intermediate resources remain the builder's responsibility.
  The factory takes no definition options and is not exported from core root.
- Core provides `tube(outerRadius, innerRadius, y)` as a centered Y-axis,
  constant-section straight tube with a through bore. It has no wall-thickness,
  taper, or path options. Custom primitive examples demonstrate extensions
  beyond built-in geometry, rather than reimplementing cylinders or tubes.
- Core also provides `coil(coilRadius, wireRadius, pitch, turns)`: a right-handed
  circular-section coil about Y with plain ends and fractional turns. Its
  centerline Y interval is centered at the origin and its named axis remains
  on Y even for partial turns. Spring specifications remain outside core.
- Common, well-defined geometric conveniences may belong in core even when
  composed from lower-level operations. A code API has lower discovery and
  presentation costs than a GUI toolbar; minimizing entry count alone is not
  the scope criterion. Example selection must follow this boundary, not define it.
- Public topology IDs are deterministic model semantics, not OpenCascade hash
  codes or current edge-array positions. Boolean results inherit only from the
  ordered primary operand; every other contributed edge is new in that ID
  namespace.
- GUI tools resolve an explicit source-edit scope and use the common tool intent
  and transaction mechanism.
- Source undo and redo remain Monaco history operations. Standard shortcuts
  invoke that same active-file history while GUI controls own focus, without
  moving focus back into the editor or maintaining a parallel GUI stack.
- Model compilation uses one persistent, non-blocking status indicator at the
  viewport's upper-left edge. Pending and active work are prominent; the idle
  state shows a subdued `Ready` or `Model error`. The application header has no
  parallel run state.
- Tool commits preserve the editor caret and its rendering scope. A non-focusing
  GUI popover shows a trimmed, syntax-highlighted source excerpt with the
  changed range marked.
- Units remain UI metadata; no implicit runtime conversion occurs.
- Runtime trace data may explain and locate values, but must not constrain which
  JavaScript/TypeScript construction patterns users can write.
- Named point, line, and face elements retain complete local reference frames
  while their kinds determine geometric degrees of freedom. A composition's
  relations are solved jointly by the OndselSolver WASM backend. Groups retain
  their children's local assembly and move as rigid bodies in outer groups.
- The editor caret resolves the exact source occurrence being inspected. A
  value site renders that value alone. A collection result places its members
  together using their resolved relations, including singleton collections;
  selecting one member as a value still renders it in its intrinsic frame.
  An operation-input site may also render
  its peer inputs as dimmed context that can switch input focus. Mouse hover
  over source code does not change the viewport. In a layered source scene,
  focus solids are slightly translucent while context remains strongly dimmed,
  so overlaps stay legible; a single focus solid remains opaque.
- Topology reference values retain their selected IDs through bindings and
  collections. Their preview emphasizes the returned vertices, edges, or
  surfaces with the owning geometry dimmed as spatial context; topology
  accessor calls use the same dimmed context while editing the selected IDs.
- Topology preview and selection use fixed screen-space sizes: vertices are
  5px and edges are 2px in every state. Available references are dim gray,
  previewed/selected references yellow-green, hovered unselected references
  cyan, and hovered selected references orange. Hover changes color only;
  face fill opacity stays constant and selected and hovered fills do not stack.
  Hover is recomputed at the retained pointer position after selection changes
  and recompilation. Vertex and edge picking uses a six-CSS-pixel radius and
  chooses the closest projected element, independently of zoom and model scale;
  surfaces use ray/triangle intersection.
- Topology multi-selection tools expose the same Use all action as fillet and
  chamfer: remove the ID argument to select all through the normal source-edit
  transaction and undo history. The omitted-argument state displays All
  vertices/edges/surfaces and has no explicit selection highlights; clicking an
  element starts a singleton explicit selection. This editing state is distinct
  from value previews, which display the actual returned topology.
- A constraint source site renders both relation participants and takes dimmed
  context from the concrete downstream composition that consumes the
  constrained value. The constrained value remains the relation-edit scope for
  spatial tools; the relation target does not replace downstream context.
- Model values inside constraint expressions and function parameter bindings
  share the same relation-context matching as named and topology anchors.
  Parameters are observed at function-body entry, including destructured,
  defaulted and rest bindings, without an API or callback-name list. A parameter
  can inspect the relation constructed with that value in its function body.
  When no downstream composition exists yet, relation participants still use
  resolved composition placement, as in a group, instead of overlapping in
  their standalone frames. Ordinary value sites outside relation construction
  retain standalone placement. See [#22](https://github.com/vilicvane/code3d/issues/22).
- Named-element properties and topology anchors share one relation-preview
  context: the owning model is the focus, with the other participant and the
  concrete downstream composition visible as dimmed peers. Matching uses the
  enclosing constraint's source range and execution, including repeated calls
  sharing a reference model. Topology accessors retain their own selection IDs,
  arguments, and tool execution. Named point, line, face, and frame elements
  retain typed decorations; faces highlight matching B-Rep face groups and
  their real boundaries rather than drawing a proxy plane. A focused item in Monaco's
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
- Viewport occurrence selection leaves the focused geometry's materials
  unchanged; source context dimming carries the primary focus contrast. A
  passive one-pixel screen-space corner bound marks only groups and other
  scopes without their own renderable geometry. Parameter and position previews
  use one-pixel geometry-aware emphasis in a secondary color for other affected
  occurrences.
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
- Studio diagnostics, completion and model evaluation use one selected package
  filesystem: project-owned packages when core is declared, otherwise the
  built-in core/screws plus ordinary project dependencies. Declarations and
  implementations remain separate consumers of real package artifacts, not a
  hand-authored declaration shim. Changing this selection invalidates the runtime.

## Milestones

### Website and user documentation — complete

- Rebuild the product website with Astro and Starlight, with a custom homepage,
  searchable user documentation, and executable examples shared with App.
- Keep the website static and App independently built; deliver them in one
  artifact with App under `/app/`.
- The detailed scope, flexible execution plan, and acceptance criteria are in
  [the website plan](plans/website-and-docs.md).

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

Remaining scope and live status: [#2](https://github.com/vilicvane/code3d/issues/2).

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
Named-element properties and edge, surface, and vertex anchors refine that
scope through the same context resolver. The owning model and selected anchor
are highlighted while all relation participants remain visible; each accessor
keeps its own editing arguments across runtime calls and downstream consumers.
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
When later evaluation fails after earlier model expressions succeeded, the
compiler publishes that successful prefix as a partial module together with the
diagnostic, so earlier source targets and their contextual tools remain usable.
Every traceable call records one ordered runtime execution containing its
completion or failure outcome, evaluated operation inputs, actual arguments,
and parameter provenance. Source targets keep that reach order and choose the
most recently reached execution within the preferred runtime context. A tool
therefore projects whichever context its call reached before failure instead of
implementing a separate failure lifecycle; fillet and chamfer use the common
record to repair their attempted edge selection and size parameter.
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

### 3. Anchor constraint graph — geometric solver

- Keep B-Rep geometry local and store constraints on immutable model copies.
- Support a model's intrinsic frame and type-safe named point, line, and face
  elements. Primitives provide canonical center, top, bottom, and axis elements;
  reusable models can expose and rename internal elements in their own frame.
- Solve simultaneous geometric `on()` relations using the shared Node/Worker
  WASM module, with geometric feasibility preceding secondary placement
  preferences. Validate every original equation after redundancy handling.
- Check directed face and complete-frame orientation branches. Line anchors
  are geometrically unoriented, with `flip()` changing the preferred direction.
- Preserve a related value's intrinsic local placement when it is rendered on
  its own. Resolve relation placement when rendering a composition or evaluating
  a compositional geometry operation such as a Boolean or loft.
- Preserve constraint source and parameter provenance for GUI tools.

The independently determined full-pose comparison path has been removed.
Primitive canonical anchors use their exact dimensions instead of padded
OpenCascade bounds. Build and solver details are in
[`@code3d/solver`](packages/solver/README.md).

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
- Let `Escape` cancel the active drag before handling menus or transient docks.
  Cancellation restores the pre-drag preview without writing source and leaves
  the code-selected tool panel open; mouse release commits only uncancelled drags.

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
  not offer GUI insertion of modeling calls. Select the size value when its
  input first receives focus and use the theme accent for the text selection.
- While selecting, render the applied operation result as the primary solid and
  retain every original input edge at its pre-operation position as a
  hoverable/toggleable guide. Commit each edge-set change immediately and each
  valid size input after a short debounce, flushing it on Enter or blur, while
  keeping the guide, hover, and selection panel interactive during background
  compilation. Newer edits invalidate older compile results, and the latest
  normal compiled model replaces the rendered result when ready. Defer source
  formatting after every GUI tool source update until the user returns focus
  to the editor, then end any active edge-selection session and format the
  affected files once while preserving the cursor's relation to the formatted
  code. Do not present an uncommitted operation result as if it had already
  taken effect. Outside selection, keep the weaker before/after comparison for
  an applied edge modification.
- Treat one continuous edge-editing session as one source-history entry.
  Undo and redo during that session update the source, guide, and controls
  together without closing the tool; after the session ends, history remains
  immediate but does not reopen transient edge-selection UI.
- Make explicit edge filtering reversible: toggle individual edges or use all
  edges by deleting the second argument. An empty explicit array is never a
  persistent model state; toggling down to zero returns to the one-argument
  all-edge form. Treat that implicit all-edge mode as distinct from an explicit
  array containing every edge: it starts with no guide edges selected, so the
  first click creates a one-edge filter rather than subtracting from all edges.
  The tool panel follows the selected source location: leaving the call dismisses
  it, while `Escape` does not close the panel or end its editing session. Already
  committed edits remain in source. The panel has neither Apply nor Cancel actions.
- Keep the contextual selection panel vertically ordered and stable under
  pointer hover; hover feedback belongs on the model rather than in moving text.
- Let scalar `vertex`, `edge`, and `surface` parameters select exactly one
  topology ID in the viewport. Entering `solid.vertex(id)`, `solid.edge(id)`, or
  `solid.surface(id)` shows the receiver solid, highlights the current topology
  element, and writes each new pick directly to the argument; a missing or
  retired ID remains repairable from the failed call's reached receiver.
- Let array-valued topology parameters use the same provider in multiple mode.
  `.vertices(ids?)`, `.edges(ids?)`, and `.surfaces(ids?)` preserve an explicit
  empty array as an empty reference collection and return all current stable
  topology references when the argument is omitted.

Status: complete. The runtime topology namespaces, edge-scoped modification
API, singular and plural vertex/edge/surface reference APIs, derivation
transfer rules, render-mesh IDs, operation trace selections, generic single-
and multiple-selection viewport picking, before/after comparison, reversible
selection, and source write-back are implemented. The Properties panel and GUI
operation-insertion path were removed pending a broader interaction design.

### 4b. Core package and Node-native projects — active

Remaining scope and live status: [#6](https://github.com/vilicvane/code3d/issues/6).

- Extract the author runtime into a real ESM `@code3d/core` package with emitted
  JavaScript, declarations, explicit exports, and an explicit tooling boundary.
- Resolve project-owned `node_modules` with a zero-install built-in runtime
  until the project declares core. Remove the injected `code3d` module and
  duplicated declaration string; never fall back after a declared dependency fails.
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

### 4c. Content-addressed kernel operation reuse — complete

- Cache complete OpenCascade-backed operation results by operation identity,
  scalar arguments, and input artifact identities.
- Re-run JavaScript and source tracing for every compile while reusing only
  opaque geometry artifacts and kernel query results.
- Make linear-prefix reuse fall out of the same content-addressed mechanism
  that also handles branches and shared inputs.
- Keep cached kernel ownership separate from disposable per-evaluation model
  values, bound retained resources, and invalidate them with the kernel
  instance.

Status: [R-024](requests/closed/R-024-cache-opencascade-operation-results.md)
is implemented as a bounded, content-addressed kernel-operation LRU covering
solid construction and modification, Boolean prefixes and context regions,
relative transforms, topology sidecars, bounds, and render meshes. JavaScript
and provenance are still evaluated afresh. Cache encoding, capacity, and a
possible lifetime beyond one compiler worker remain adjustable implementation
choices rather than product semantics.

User-defined Replicad builders execute on every invocation because their
closures may depend on state beyond their arguments. Core identifies the actual
returned solid by its B-Rep representation so identical output can reuse geometry,
downstream operations, and meshes across evaluations. Model values and tracing
remain fresh; custom primitives use the standard mesh tolerance. The screws
package privately caches deterministic thread B-Rep data in a bounded LRU, reading
an independently owned shape in the current kernel for each invocation. This
avoids caching disposable model objects or retaining native handles across kernels.

### 4d. Annotation-driven contextual tools — active

Further parameter/provider design: [#7](https://github.com/vilicvane/code3d/issues/7).
The implemented contract below remains the baseline; the issue is a discussion,
not approval to predeclare additional parameter kinds.

- Let an authoring API opt individual parameters into contextual panels with
  per-signature JSDoc such as `@code3d.param width {kind: 'length'}`. Parse the
  annotation value as a statically inspectable JavaScript object literal and
  resolve the declaration through its TypeScript symbol and signature rather
  than the spelling used at the call site.
- Give `@code3d.param` the same embedded-value highlighting as design
  arguments, including multiline configuration. Complete parameter names from
  the callable signature and configuration from its actual TypeScript types.
  Share static validation with compilation and report errors inline even
  before the callable is used.
- Give `param` configuration and `arguments` expressions shared embedded
  TypeScript smart selection. Reuse source-fragment projection and range
  mapping for selection and completion; retain native syntax parents inside
  the fragment, then join annotation and ordinary source parents without
  exposing generated helper code.
- Use one semantic `kind` discriminator for value and selectable parameters.
  Keep runtime defaults, effective selections, environment-dependent steps,
  display ranges, units, and other presentation policy out of the declaration
  metadata; resolve them from the reached tool context and current environment.
- Recognize only callable `@code3d.param` and design `@code3d.arguments`
  annotations. Numeric variables carry no annotation metadata: resolve their
  editable source without inheriting labels, units, kinds, bounds, or steps
  from comments. Derive parameter semantics from the reached call, and do not
  display unconverted variable units in panels or viewport drag feedback.
- Prefer an optional trailing parameter when omission is the only alternative
  call form, as for `fillet(radius, edgeIds?)` and
  `chamfer(distance, edgeIds?)`. Retain independently annotated overloads when
  signatures genuinely require different tool configuration. When an
  incomplete call matches no overload, retain the resolved recovery candidate
  when it is annotated; otherwise choose the first annotated candidate in
  declaration order. Publish the reached tool call even if it fails before
  producing a model value, show missing parameters as empty controls, and let
  the next syntactically insertable parameter be filled from the panel.
- Allow parameter-level and tool-level actions to evolve as separate tagged
  unions. Implement only actions required by an actual tool; edge selection's
  initial action is `{label: 'Use all', action: 'remove-argument'}` on the
  optional edge parameter.
- Build a generic parameter panel from the resolved signature and the most
  recently reached runtime execution. Keep specialized viewport behavior in
  reusable providers: scalar parameters need no viewport interaction, offset
  contributes its relative-frame gizmo, and edge parameters contribute edge
  picking plus input/result comparison. A provider consumes runtime facts and
  emits ordinary tool intents; annotations do not restate implementation
  behavior.
- Resolve editable scalar sources through the same TypeScript program used for
  tool signatures. Follow only unique definitions through aliases, concrete
  object properties, destructuring, imports, and re-exports until reaching a
  static numeric initializer; reject runtime-ambiguous receivers instead of
  selecting a structurally compatible property declaration.
- Migrate primitive constructors, `Constraint.offset()`, scale, fillet, and
  chamfer to the annotation path, deleting the compiler's name-based parameter
  table and the fillet/chamfer-specific panel contract rather than retaining
  parallel metadata or UI paths.

Implementation order: first establish and commit declaration parsing,
signature resolution, runtime tool context, and generic source-edit actions;
then commit the generic panel and migrate viewport providers one operation
family at a time. Adjust the schema when concrete operations expose a better
boundary instead of preserving an awkward planned abstraction.

Status: declaration parsing, overload-aware signature resolution, runtime call
context, scalar write-back, parameter actions, and the generic contextual panel
are implemented. Primitive constructors, `offset()`, `scaled()`, `fillet()`,
`chamfer()`, topology references, and the scalar signatures of the screw tools
use the annotation path. Scalar provenance follows unique TypeScript definition
chains across property access and project files, while contextual panels and
viewport providers share the same upstream-target preference. Single
edge/surface picking and multiple-edge picking are viewport providers layered
into the same panel and undo session; object-valued parameters and further
selectable parameter kinds will be migrated only after their concrete controls
establish the next schema boundary.

### 4e. First-class profiles, curves, and loft — complete

- Generalize geometric model values beyond solids: planar faces, curve edges,
  and vertices remain ordinary immutable, traceable, renderable model objects
  and therefore use the same `relate()` mechanism as solids.
- Keep local profile constructors in the XZ plane with +Y as their normal,
  matching the existing primitive axis convention. Start with circles,
  ellipses, rectangles, and regular polygons; start 3D curves with line, arc,
  Bezier, and interpolated spline constructors.
- Make `.surface(id)`, `.edge(id)`, and `.vertex(id)` usable as face, line, and
  point anchors. Faces use their center and normal, edges use their midpoint
  and tangent, and vertices use their point with the owning model orientation.
  The solver constrains the resulting reference lines and planes, including
  those of curved topology; it does not match complete curves or surfaces.
- Let `loft(sections, {spine})` transform every related input into the first
  section's frame. Without a spine it builds a through-sections loft; with a
  spine it uses a multi-section pipe shell so the curve affects the generated
  geometry rather than serving only as a placement guide.
- Validate the complete path with two non-parallel related planar profiles at
  the endpoints of a curved spine, including Node execution, Studio rendering,
  source context, and topology selection on the result and inputs.

Status: complete. Node tests cover renderable face/edge/vertex models, all three
topology anchor kinds, ordinary through-section loft, and a curved-spine loft
between nonparallel circle and rectangle profiles. Host-Chrome validation also
confirmed Studio rendering, section/spine source context, and Surface, Edge,
and Vertex viewport selectors on the new model kinds and loft result.

### 5. Object combination tools

Design discussion and live scope: [#8](https://github.com/vilicvane/code3d/issues/8).

- Handwritten standalone `union`, `cut`, and `intersect` functions are now the
  only Boolean API; the old instance methods were removed.
- Later allow an explicit tool mode to resolve multiple semantic selections.
- Treat the main selection as the primary boolean operand and result frame.
- Initially generate a new binding in a safe common lexical scope; do not guess
  which downstream JavaScript references should change.

## Open questions

Unresolved constraint, topology naming, Boolean provenance, scaling, and runtime
retention questions are tracked in [#9](https://github.com/vilicvane/code3d/issues/9).
The geometric solver implementation belongs to
[#21](https://github.com/vilicvane/code3d/issues/21). The earlier
[experiment](plans/constraint-solver-wasm-evaluation.md) records the evidence
leading to the shared OndselSolver WASM backend.
Source lifting for combination tools belongs to [#8](https://github.com/vilicvane/code3d/issues/8).
Public API and interoperability review belongs to [#5](https://github.com/vilicvane/code3d/issues/5).
Confirmed outcomes return to the design documents; discussion status stays in
Issues.

## Completed foundation

- `76e91d8`: initial OpenCascade prototype.
- `0eddd6f`: source-backed parameter editing.
- `a83f36e`: common source-backed modeling tools.
- `d28443d`: Prettier integration and stabilized source-backed editing.
- `83a847f`: exact source-node previews, including repeated runtime objects.
