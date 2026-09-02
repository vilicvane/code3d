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
- An entity consists conceptually of reusable geometry plus an immutable
  position relation.
- A position-relation root has no absolute coordinates. `move`, `rotate`, and
  later spatial operations derive a new relation from an existing relation.
- Chained calls are the human-facing syntax for relation derivation; they do not
  imply mutation or a persistent CAD feature history.
- Creating an entity can start a fresh position relation or inherit another
  entity's relation. Copying defaults to inheriting the source relation, while a
  fresh relation remains an explicit option.
- A composite is broad: any connected set of occurrences and spatial relations
  is a composite, including copy, pattern, boolean operands, groups, and named
  assemblies. A composite can itself be reused as geometry in a larger model.
- Object replacement/deletion is not a core modeling primitive. JavaScript
  bindings, reachability, derivation, and runtime occurrences describe what
  exists.
- The future object list is a source/runtime index, not a scene tree. A lineage
  or execution timeline is an optional view over runtime derivation, not the
  persisted source of truth.
- Monaco multi-selection and automatic boolean code generation are deferred
  until single-object discovery, rendering, and position relations are solid.

## Invariants

- Public model values do not expose OpenCascade or Three.js details.
- GUI tools resolve an explicit source-edit scope and use the common tool intent
  and transaction mechanism.
- Units remain UI metadata; no implicit runtime conversion occurs.
- Runtime trace data may explain and locate values, but must not constrain which
  JavaScript/TypeScript construction patterns users can write.
- Source selection previews the exact runtime value at that source site,
  including all instances produced by loops or collection operations.
- Export status must not change the geometry or position semantics of an object.

## Milestones

### 1. Rootless authoring and optional exports — implemented

- Remove the requirement that `default export` is a `ModelObject`.
- Compile successfully when the module produces any traceable model object.
- Use source selection as the primary render target.
- Use a model export as a fallback; without one, use the latest produced object.
- Keep `model()` available for compatibility, but remove it from the default
  example and documentation as a requirement.

Status: implemented locally on 2026-09-02 and awaiting a phase commit. The
browser-verified default example contains neither `model()` nor an export.

### 2. Runtime object catalog — in progress

- Record top-level bindings, source sites, export names, collections, runtime
  instance counts, and evaluation order.
- Add an object panel with locate, hover-preview, pin, and render actions.
- Group repeated executions by source site and expand them into occurrences.
- Hide anonymous intermediates by default and expose them through an expanded
  lineage view.
- Match catalog entries across recompiles using source-aware identities rather
  than transient runtime node IDs alone.

Status: the first two slices are implemented locally. Runtime metadata includes
module/local bindings, anonymous source expressions, export aliases,
collections, per-execution outputs, and evaluation order. The object panel
shows module bindings by default and supports hover preview, click-to-pin,
source location, per-instance expansion, and local lineage expansion. Binding
and expression identities use module anchors plus AST paths; expanded and
pinned runtime occurrences survive normal recompiles and parameter write-back.
Thumbnails and matching across large control-flow or structural rewrites remain
open.

### 3. Position-relation graph

- Separate B-Rep geometry from position relations in the runtime.
- Make `move` and `rotate` derive immutable relation nodes instead of modifying
  OpenCascade shapes.
- Define fresh versus inherited relation behavior for creation and copy.
- Resolve related occurrences into a common frame only when rendering or
  combining them.
- Preserve relation provenance so gizmos can update the correct chain call.

### 4. Relation-aware GUI tools

- Show translation/rotation gizmos only for occurrence or relation scope.
- Let a gizmo create a relation call when none exists, then edit that same call
  on later drags.
- Preview the relation source as a ghost when useful.
- Add copy and pattern tools on top of the same relation intents.

### 5. Object combination tools

- Begin with handwritten `union`, `cut`, and composition code plus GUI position
  adjustment.
- Later allow an explicit tool mode to resolve multiple semantic selections.
- Treat the main selection as the primary boolean operand and result frame.
- Initially generate a new binding in a safe common lexical scope; do not guess
  which downstream JavaScript references should change.

## Open questions

- Final public names for relation inheritance and fresh-copy behavior
  (`relativeTo`, `copy({position: 'new'})`, or alternatives).
- How disconnected relation roots acquire an identity relation inside a new
  composite.
- Whether uniform scaling is geometry derivation, occurrence placement, or two
  explicitly named operations.
- How much runtime lineage to retain and mesh eagerly for large models.
- The visual form of the object catalog: list, thumbnails, local lineage, and
  optional execution-time projection.
- Rules for lifting inline expressions or values from different lexical scopes
  when automatic combination tools are eventually introduced.

## Completed foundation

- `76e91d8`: initial OpenCascade prototype.
- `0eddd6f`: source-backed parameter editing.
- `a83f36e`: common source-backed modeling tools.
- `d28443d`: Prettier integration and stabilized source-backed editing.
- `83a847f`: exact source-node previews, including repeated runtime objects.
