# code3d working plan

This file is the durable working memory for decisions and multi-step work. Keep
stable product goals in `DESIGN.md`, source-editing/tool contracts in
`TOOLING.md`, and detailed implementation records under `plans/`; update this
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
  line data is `[startPoint, endPoint]`, and circle data is `[centerPoint, radius]`.
  Point data can instead be a local ID or named upstream point reference:
  aliases retain author IDs but share one canonical solve point. Dragging follows
  the canonical owner's edit permissions; explicit point snapping writes an
  alias on release, without coordinate-based deduplication or replacing expressions.
  Snapped previews remove local lines collapsed by the proposed alias and their
  constraints before solving, preserving both point IDs and other curve contacts.
  Leaving the snap or cancelling restores the original topology; release writes
  coordinates, the alias and deletions in one undoable source transaction.
  See [#59](https://github.com/vilicvane/code3d/issues/59).
  `base.derive([...])` retains locked
  upstream layers; local numeric point IDs and named `base.point(id)` handles
  distinguish ownership. IDs are independent per layer; new editor entries use
  local max + 1, without persistent `nextId` or renumbering surviving entries.
  Selecting a sketch opens a 2D geometry editor. Literal coordinates and radii can be
  dragged; expression-driven coordinates stay source-edited. Continuous lines
  create/reuse endpoints without a standalone point creation tool, with numeric
  start X/Y or segment length/angle input, X/Y direction locks, dense adaptive
  snapping, cancellation and one atomic source transaction per segment.
  `sketch(entries, {constraints})` separates current geometry from hard
  conditions, without persistent constraint IDs.
  Constraints use `['kind', target, value?]`, with array targets only for
  multi-point relations. Dimension values occupy the third tuple field.
  Fixed point, coincident, horizontal/vertical, length, angle, radius, sweep,
  midpoint and point X/Y constraints use PlaneGCS;
  assemblies use explicit rotation/translation bounds. Explicit drawing dimensions and the final
  active X/Y lock become constraints when geometry is committed; toggling off
  emits no direction constraint. Grid/axis snapping stays temporary; snapping
  onto an existing point retains that identity.
  Dragging uses a soft Worker solve and writes all changed editable coordinates
  together, preserving hard constraints, upstream values and expression source.
  Drag rules receive the complete numeric context; the dispatcher does not
  classify points or partition geometry. Rules recognize curve and
  rectangle centers for preferred local translation, prefer centers or far connected endpoints
  as soft references, and handle an unconstrained sole junction per branch.
  Connectivity and role recognition belong to those rules, not the framework.
  Ordered soft stages preserve gesture-specific priorities, the feasible mouse result, then local translation,
  then minimize exterior movement. Later stages retain the earlier chosen target
  parameters for this frame only; hard constraints always hold. Connected external
  geometry no longer disqualifies a center gesture, and no stage locks persist.
  Every gesture finishes with a common lowest-priority stay for all non-dragged
  canonical points, referenced to gesture-start geometry rather than the preceding
  frame. It only resolves remaining freedom; earlier achieved parameters and
  all hard constraints remain authoritative. Radius gestures include all points
  in this final stay, without adding generic radius objectives.
  Stages can supply rule-owned initial guesses as well as objectives. Local
  translation reseeds its followers from the now-feasible center movement,
  avoiding inherited endpoint-angle errors at near-singular arc configurations.
  It retains accumulated locks and still solves the complete hard system.
  Arc endpoint gestures first optimize their incident centers' original positions,
  then the closest feasible mouse target. Free radii can change; constrained radii
  keep the endpoint on the feasible circle. This also applies when an endpoint
  is another curve's center: translation seeds use the same projected endpoint
  position and followers use its achieved movement. See [#61](https://github.com/vilicvane/code3d/issues/61).
  Circle and arc center gestures preserve their own curves' radii before following
  the mouse; concentric curves participate together. A point with both roles first
  preserves incident centers, then its own radii. Hard constraints remain authoritative,
  and radius goals do not persist as authored dimensions. Other gestures start with
  the closest feasible mouse target. Subsequent stages
  preserve achieved values while optimizing soft references. No reference point is permanently fixed;
  temporary objectives do not enter source or the reported model DOF.
  A drag rule recognizes points on lines, circles and finite directed arcs from displayed
  gesture-start geometry using the same model-space tolerance as trimming.
  Temporary line/radial equations and finite endpoint bounds retain those connections
  without splitting curves, merging identities or adding author constraints.
  Interior points can slide; endpoints and followers have soft pose preferences.
  Unrestricted center moves translate followers, radius gestures preserve their
  polar directions, and polar drag seeds follow half turns without requiring a
  local solver to choose the opposite branch. Arc bounds respect CW/CCW and do
  not include the missing part of the circle. Curves crossed during a gesture
  do not become sticky. Local points can slide on read-only upstream curves;
  real constraints and AST locks remain
  authoritative. Source replay independently checks every original incidence.
  This does not generate intersection points or persist curve parameters.
  Movement without authored or inferred equations is kernel-independent; inferred
  curve connections use the Worker solver as well. Successive frames use the
  preceding solution and an immutable gesture-start reference; previews
  forward-solve the exact source data that
  will be committed. During dragging, AST-derived per-axis locks preserve each
  expression's evaluated author value; literal axes on the same point remain
  editable. If those locks alter the displayed geometry, solve them before
  preparing the rule context. Thus initially unsatisfied data can adjust
  when dragging begins. Normal evaluation remains numeric-only; expressions
  receive neither offsets nor permanent constraints. Source replay tests use a
  fresh compiler, not saved gesture state.
  Numeric tail cleanup uses local feature scales and independently rechecks all
  hard constraints and arc structure. Exact input/gesture coordinates take
  precedence over shorter decimals; source writes serialize the checked numbers
  losslessly, without a second precision limit.
  Native convergence, cleanup and geometric tolerance share a feature-local
  numeric budget. Iterative stage seeds are not promoted to exact authored
  values, and valid arc data are not reprojected on each forward solve.
  Deletion removes affected local constraints atomically. Snapshots expose DOF
  and redundant indices; conflicting inline constraints are source-located.
  Numeric fields retain native browser text history; SVG nodes retain entity
  identities across redraws. PlaneGCS 1.2.0 is a pinned, unmodified dependency;
  native systems and vectors are released after every solve.
  The two-corner Rectangle tool shares drawing inputs, snapping and source
  transactions with Line. It emits ordinary points and lines with four
  horizontal/vertical constraints; entered width/height constrain adjacent
  sides, not both pairs of equal sides. The whole rectangle is one undo step.
  Snapped corner references remain local or named upstream references. Center
  rectangle shares the same implementation with a referenceable ordinary center
  point, allocated before new corners, and one `midpoint` relationship to opposite
  corners. Its dimensions are full side lengths. The generic midpoint tuple is
  `['midpoint', [midpoint, start, end]]`, with no line entity required; two native
  linear difference equations per axis share a temporary parameter and one
  diagnostic tag. It works at coincident coordinates without changing already
  satisfied geometry. The center rule recognizes this authored structure without
  hidden GUI state; without additional restrictions, dragging its center
  translates the rectangle. Interactive strokes remain 2px in all highlight states.
  Curve selection and deletion use intervals delimited by existing
  points, finite line/circle/arc intersections and overlapping endpoints. Merely crossing
  or selecting geometry does not split the source. Deleting an end interval
  retains the line/arc ID; deleting an interior interval retires it and assigns two
  fresh IDs. Points disconnected by the deletion and their constraints are
  removed atomically; shared points (including geometric T junctions), upstream
  points, unrelated standalone points and other lines remain. Computed cuts
  create ordinary numeric endpoints only when needed. Original full-line length
  constraints are removed, while direction constraints and their expressions
  follow surviving lines in the same undo transaction. Upstream geometry can
  delimit a local trim but remains read-only.
  All local overlapping pieces on the clicked interval are highlighted and
  trimmed together, including reversed lines. IDs and direction constraints
  follow each original line; computed cut points are shared and orphan cleanup
  runs after the whole batch. Uneditable targets reject the entire transaction.
  Nearby parallel lines, crossings and read-only upstream are not grouped.
  The Scissors/Trim tool previews on hover and trims directly on click without
  selection; Esc exits. Select + Delete/Backspace uses the same transaction.
  Persistent constraints have selectable glyphs and numeric labels, an overall
  visibility toggle, and hover/focus highlighting of actual participants.
  Clicking a marker selects its participants; local literal dimensions open a
  focused input and update only that constraint value in one undo transaction.
  Expression-driven values and upstream constraints remain read-only.
  Midpoint guides link the center to its two endpoints; upstream markers are
  distinct and drag-only locks are not presented as persistent constraints.
  Circle shares the same drawing, numeric input, snapping and source transaction
  pipeline. It creates an ordinary center point (or reuses a snapped local/upstream
  reference) and one analytic circle, not a perimeter point or polyline. Its
  entered radius emits `['radius', circleId, value]`; an unentered radius remains
  free. Edge dragging edits radius, center dragging edits the center. Geometry
  parameters share AST permissions, gesture-only locks, rounding and exact source
  replay; radius expressions are never overwritten. Native circle radius
  constraints use PlaneGCS. Equations with locked scalar parameters are checked
  directly, avoiding zero-Jacobian equations in native redundancy analysis while
  preserving genuine conflict errors. Radius markers link the actual center and
  circumference. Deleting a circle removes its affected constraints and only
  newly disconnected local centers, preserving shared/upstream points.
  Arcs use `['arc', id, [centerPoint, radius, startPoint, endPoint, 'cw' | 'ccw']]`
  and native ArcRules, with radius constraints shared with circles. Radius is
  current geometry, not a hard dimension; no hidden angles are authored.
  Initialization projects endpoints radially, using an explicit radius dimension
  when present and current radius data otherwise, averaging simultaneous proposals
  for shared points while respecting locked/fixed/positioned axes. The seed then
  solves against all structural and authored constraints, with radius still free.
  Edge and endpoint dragging share radius tracking, AST permissions, expression
  locks and exact rounded source replay. Center/start/end drawing supports entered
  center coordinates, radius and sweep. Drawing defaults to CW, R reverses direction, and one transaction creates
  or undoes the whole arc. Ordinary point dragging replays the exact rounded source.
  Analytic curves share finite hit testing, display, bounds, radius badges and
  orphan cleanup. Whole-arc deletion retains shared/upstream points; zero-radius
  or coincident-endpoint arcs are errors, not implicit full circles.
  `['sweep', arcId, degrees]` independently constrains the directed arc angle,
  strictly between 0 and 360 degrees; the arc tuple still owns cw/ccw. Blank sweep
  input follows the mouse without a constraint. Native angle parameters unwrap on
  that directed branch, and residuals check the actual finite arc after solving.
  Already-known dimensions are verified directly; mouse objectives omit coordinates
  fixed by authored or gesture locks. Sweep badges link center and both endpoints.
  Analytic intersections share model-space tolerances, finite-arc filtering and
  tangency/overlap boundaries. Circles and arcs can delimit straight-line trims,
  including read-only upstream curves; their source and constraints stay unchanged.
  Circles use cyclic intervals without an artificial zero-angle seam; zero or one
  boundary means whole-circle deletion. A surviving circle interval becomes a CW
  arc with the same ID. Arc trims preserve direction and center/radius source,
  including expressions; radius constraints follow survivors, while the original
  whole-arc sweep is removed. Circular overlaps share one trim transaction, cut
  points and orphan cleanup, just like lines. Select + Delete and hover/click Trim
  use the same intervals; radius dragging remains available.
  Closed non-intersecting line/circle/arc contours now produce exact face models:
  `face()` requires one region (with holes), `faces()` returns an ordinary array.
  Upstream boundaries, disconnected regions and nested holes/islands are included;
  open, touching, crossing and branching boundaries diagnose without source edits.
  Sketch `[x,y]` maps to `[x,0,-y]`. Single-face chain/free extrusion uses a signed
  finite nonzero distance along the plane normal; collections use explicit `map`.
  Chain `cut(tools)` delegates to the existing boolean operation. Loft retains zero
  or one hole per section, diagnosing mismatched counts or unpaired multiple holes.
  The canvas shares analytic extraction for a noninteractive region fill. Persistent
  region selection IDs and arbitrary multi-hole loft correspondence remain later work.
  The sketch canvas fills the viewport with floating controls. Its top-right
  icon toolbar orders selection, drawing, modification and view controls; rectangle
  variants share a remembered entry. Right dragging pans without cancelling a draft;
  the permanent lower-left instructions are gone, while errors/read-only reasons remain.
  Click and analytic box selection share point/line/curve selection modifiers:
  left-to-right contains whole intervals, right-to-left intersects finite geometry,
  plain replaces, Ctrl toggles, and Shift only adds. Ctrl takes precedence when both
  modifiers are held; every box frame uses the gesture-start set, not the last frame.
  Escape restores the pre-gesture selection even while Ctrl is held. Existing local relation
  removal uses the selection's union, including mixed geometry; mixed state removes
  instead of filling missing constraints. Additions require the complete selection
  to be applicable, and hovering highlights all affected relation partners.
  dimensions share drawing numeric entry and a batch is one source edit/undo.
  Selection Delete retains interval trimming and orphan cleanup. Parallel accepts
  two or more local lines as deterministic pairs; perpendicular and relative angle
  require exactly two. Single-line angle is named Orientation in the UI; pair angle
  follows authored endpoint directions, signed CCW from first to second (modulo 360).
  Parallel has a linked badge beside each participating line. Perpendicular and pair
  angle use a nearby interior-bisector badge when their endpoints share canonical
  identity, otherwise a badge beside each line. All line badges share an offset
  and stacking direction with horizontal/vertical/length/orientation, without covering
  the stroke or pushing another badge across it. Each line's complete marker group
  is centered along its midpoint, with 8px visible-edge spacing to the line and
  4px between badges. Corner badges align their near corner (or side midpoint for an
  axis-aligned bisector) toward the vertex, rather than centering their rectangle
  on the bisector. Natural widths stay unchanged; axis-aligned right angles keep
  an equal 8px clearance to both strokes. Acute angles do not force the whole
  rectangle inside their wedge.
  There is no overlap detection or automatic avoidance: other markers never
  displace a group, and users can zoom to separate nearby geometry. Relative-angle
  and perpendicular markers share the same placement mechanism. Hover/focus highlights all badges of
  that relation, without connector guides or a separate direction diagram; authored
  angle values and their direction tooltip stay unchanged. Trim propagates relations to surviving pieces, preserving expressions;
  deleting a participant drops the relation. Rectangle defaults remain horizontal/vertical.
  The toolbar has native hover
  labels and one keyboard Tab stop; narrow viewports place the whole toolbar
  below the compilation status. Both viewport
  status and error cards are scoped to the defining evaluations of the selected
  sketch and its upstream layers, excluding sibling/downstream and 3D errors.
  Recompilation that cannot evaluate the selected sketch retains its last-successful
  result read-only; downstream/sibling errors do not reset its active drawing/Trim tool.
  leaving its source selection clears it. Monaco still receives all diagnostics.
  See [research and priorities](plans/sketch-editor.md) and
  [#23](https://github.com/vilicvane/code3d/issues/23); region identity and modeling
  selection APIs remain to be confirmed.
- Author code remains ordinary JavaScript/TypeScript and may freely construct,
  reuse, copy, collect, and derive model values.
- A real code3d project is an ordinary Node/TypeScript package that owns its
  `package.json`, lockfile, and installed dependencies, including
  `@code3d/core`. The same source should run in a supported Node runtime without
  a code3d-only module syntax or hidden host dependency.
- App provides built-in core/screws when the root package metadata does not
  declare `@code3d/core`. Declaring core in dependencies, devDependencies,
  peerDependencies or optionalDependencies transfers the entire runtime to the
  project's packages; missing installations are errors. Built-in packages use
  real published artifacts, one shared core instance and an isolated internal
  dependency closure. Other npm packages still resolve from the project.
- App and core evolve together during prototyping. `@code3d/core/tooling`
  remains their internal integration boundary without a separate compatibility
  version or stability guarantee. See [#30](https://github.com/vilicvane/code3d/issues/30).
- Rendering is driven primarily by source or GUI object selection. Exporting is
  a publishing boundary and only a preview fallback, not a render prerequisite.
- Before the first preview, App shows **Select to preview** with an animated
  text selection. Each round starts with `model`, then `sketch`, then an explicit
  list of transformation and composition/Boolean API names in shuffled order.
  Transformations cover origins, rotation/scale and spatial relations; operations
  are `group`, `union`, `intersect` and `cut`. The list lives in the UI module,
  with ordinary type checking of API names and no additional build-time scan.
  The UI advances one word per CSS animation cycle without background timers.
  Once geometry or a sketch has been previewed, this initial hint stays dismissed
  for the current file load. Loading another file starts a new preview cycle, so
  new or reopened empty files show the hint after the old scene is replaced.
  Moving the cursor outside a previewable expression keeps
  the existing selection behavior, including the last 3D preview. Empty sketches
  remain valid drawing targets. See [#68](https://github.com/vilicvane/code3d/issues/68).
- Viewport file export supports STEP, STL and 3MF alongside PNG image export.
  The context menu has separate image and model entries; the model dialog
  remembers the last format. Both name files after the rendered value's binding,
  falling back to a generic name. Model export always uses current foreground
  geometry, without a separate export scope or viewport helpers/contextual ghosts.
  See [#13](https://github.com/vilicvane/code3d/issues/13).
- Base viewport appearance follows geometry kind: face models keep a filled
  surface visible from either side, while edge models render their authored
  color (or the neutral default model color) as the curve itself. Solid
  surface and boundary treatment remains independent from profile and curve
  visibility.
- `model()` is not a required entry wrapper. Any runtime model object can be
  selected and rendered.
- Models and finite geometric references can source `on(targetBound)`. All models
  expose `up/down/left/right/front/back` bounds in their local frame; primitives
  also retain their named `center` and `axis`. Bounds are computed from current
  geometry, independently of triangulation, and are not topology surfaces.
- Types referenced by the public authoring API are exported with their named
  dependencies, including generic constraints and result mappings. Model types
  belong to core's root entry and Replicad builder types to `./replicad`;
  exposing a type does not add runtime properties or operations. See
  [#34](https://github.com/vilicvane/code3d/issues/34).
- `model.expose({...})` creates a semantic-immutable model with a type-inferred
  named-element interface. An element imported from an internal model is
  rebound into the exposed model's local frame, so reusable APIs do not leak
  their construction objects.
- Geometric models passed to `expose()` become `Solid`, `Surface`, `Edge`, or
  `Vertex` references, retaining named members. Existing topology references
  keep their source identity and acquire the containing model's placement;
  pure anchors retain their reference-geometry meaning. Chained topology and
  calculated-point queries carry that placement and constrain the containing
  model. IDs remain in the immutable source geometry's namespace. References
  provide query and relation capabilities without model operations. See
  [#27](https://github.com/vilicvane/code3d/issues/27).
- `model.relate(self => constraint | constraints)` creates a new
  semantic-immutable model value that shares geometry and carries the returned
  constraint or constraint array. The callback parameter is that new value.
  Rendering this value on its own uses its own local geometry;
  relation placement is resolved only when the value participates in a
  composition.
- `on` only translates the source's matching support boundary to a directional
  target bound. Selected topology contributes only its own finite extent. It
  never aligns angles or centers. Offset explicitly pins matched bound centers
  in the target frame; bounds can reverse facing without changing that frame.
  The source preview shows its complete computed box in that frame, with the
  support face filled; the target shows its directional bound. This exact box
  replaces the occurrence's generic selection box while the relation is active,
  and its support face does not add another set of corners.
- `relate` determines self independently of written source/target roles and
  rebinds the original receiver. Each returned relation must involve self or the
  original receiver. See [#36](https://github.com/vilicvane/code3d/issues/36).
- Constraint `rotate`, `pivot(...).rotate`, `pivotVertex(...).rotate`, and
  `around(axis).rotate` provide explicit, traceable rotations. XYZ coordinates,
  vertices and default origin use self. Rotations follow their contact stage;
  other contacts constrain the final pose. See [#38](https://github.com/vilicvane/code3d/issues/38).
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
- Solid models provide `shell(thickness, removedSurfaceIds?)` for uniform walls:
  positive thickness offsets inward, negative thickness outward, and omitted or
  empty openings create an enclosed cavity. Shelling uses OCCT offset history,
  preserves one-to-one topology IDs, rejects invalid or collapsed results, and
  reuses the surface picker with failure recovery. See
  [#37](https://github.com/vilicvane/code3d/issues/37).
- Geometric model vertices, edges, and surfaces have independent model-local ID
  namespaces. Primitives assign numeric IDs. Topology-changing operations assign
  strict one-to-one descendants `[inputIndex, ...sourceIdPath]`, including the
  index 1 for single-input fillet/chamfer/shell; genuinely new or ambiguous elements
  receive local numeric IDs starting at 1. Paths are flat and input indices are
  one-based. Internal Boolean prefixes do not add path levels. Transforms and
  references retain the complete ID. See [#39](https://github.com/vilicvane/code3d/issues/39).
  Deterministic source replay is the persistence mechanism rather than a
  separate topology ledger. `model.vertex(id)`, `model.edge(id)`, and
  `model.surface(id)` return complete point, line, and face anchors: vertices
  use the owning model orientation, edges use their midpoint and tangent, and
  surfaces use their area centroid and a normal sampled at the surface's UV-domain
  midpoint (the centroid need not lie on a curved surface). Their `vertices(ids?)`, `edges(ids?)`,
  and `surfaces(ids?)` counterparts return ordered arrays of the same anchors,
  defaulting to every current stable topology ID when the argument is omitted.
- Subtopology queries validate membership and retain source IDs. Geometric
  references expose a local bounding-box center carried through transforms;
  edge start/midpoint/end anchors sample parameters 0/0.5/1. A shared edge keeps
  its identity across faces, and a closed edge retains its actual vertex count.
- A composite is broad: any connected set of occurrences and spatial relations
  is a composite, including copy, pattern, boolean operands, groups, and
  assemblies. A composite can itself be reused as geometry in a larger model.
- Object replacement/deletion is not a core modeling primitive. JavaScript
  bindings, reachability, derivation, and runtime occurrences describe what
  exists.
- Monaco multi-selection and automatic boolean code generation are deferred
  until single-object discovery, rendering, and position relations are solid.

- All models provide `originOffset(dx, dy, dz)` and `originPoint(pointRef)`.
  Geometric models also provide `originVertex(id)` and `originCenter()`. Origin is always model-local zero; an offset d re-expresses
  all point coordinates as p-d, preserving shape, directions, topology IDs and
  earlier model values. Centers and named references follow the same transform.
  `center` is carried from the body's initial bounds rather than recalculated
  after rotation. See [#48](https://github.com/vilicvane/code3d/issues/48).
- Coordinates use arrays: `point()` / `point([x, y, z])`, `line([x, y, z])` /
  `line(start, end)` and `pivot([x, y, z])`. Dimensions, displacement increments
  and XYZ angles use scalar arguments. Geometric anchor frames retain their
  tangents and normals independently of the model's fixed XYZ axes; directional
  bounds and relation pivot XYZ use model axes.
- `rotate(x, y, z)` and positive finite `scaled(factor)` act about current local
  zero. Geometry, named anchors and references transform together. Booleans
  keep the primary operand's coordinates; loft keeps the first section's
  coordinates. Groups choose their default local zero from the bounding-box
  center of solved direct member origins, retaining assembly axes; empty groups
  default to zero. Nested groups contribute only their own origin. This frame
  is fixed at construction. Group origin edits re-express the assembly together,
  preserving internal constraints and spacing. Direct `rotate(x, y, z)` rotates
  the saved assembly about its current origin, retaining nested placements and
  transforming references, bounds, rendering and export consistently. Point selection shares expose's
  occurrence resolution and rejects ambiguous repeated sources. Groups have no
  aggregate vertex IDs or geometric center/scaling capabilities.
  See [#54](https://github.com/vilicvane/code3d/issues/54).
- Origin drags freeze the gesture-start snapshot and show a candidate origin
  against it. Commit switches to result coordinates; cancel restores the start.
  Coordinate tuple components retain numeric tools and source provenance.

Material values ([#77](https://github.com/vilicvane/code3d/issues/77)) use
`model.material(threeMaterial)` as a complete replacement. `@code3d/core/three`
re-exports Core's native Three.js classes and types for models and reusable
packages to share one dependency instance, in both App and Node. The built-in
package closure exposes Core and Screws; Three.js remains a private dependency,
as Replicad does. Core captures native
Three.js JSON and loaded texture pixels at assignment; snapshots carry that
value across the worker boundary. App restores owned materials and textures,
uses separate copies for modeling emphasis, and draws authored materials in
Render mode. CSS color strings choose the default material as a whole. Groups
override the complete subtree atomically. Native face UVs are normalized per
face for texture mapping. STEP/3MF retain base color/opacity; PNG renders the
material. All former color-only author calls use this single material API.

## Invariants

- Public model values do not expose OpenCascade handles or Three.js scene objects.
  `material()` accepts native Three.js materials as captured values.
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
  codes or current edge-array positions. Boolean results inherit unambiguous
  descendants from every ordered input. Split/merged elements retire ambiguous
  source paths rather than choosing a contributor. Numeric IDs are local to
  each result; deterministic allocation is not a guarantee against renumbering
  newly generated topology when construction changes.
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
  GUI popover shows a compact filename and actual line-level `+n −m` counts,
  with an expandable diff and explicit navigation to the current source.
  Sketch and 3D tools share this feedback; sketch numeric inputs stay above it.
- Units remain UI metadata; no implicit runtime conversion occurs.
- Runtime trace data may explain and locate values, but must not constrain which
  JavaScript/TypeScript construction patterns users can write.
- Named references retain their geometry and local frames. Bound contacts
  measure finite source geometry in the target direction and solve translation
  conditions jointly; rotation is authored explicitly. Groups retain their
  children's local assembly and move as rigid bodies in outer groups.
- The editor caret resolves the exact source occurrence being inspected. A
  value site renders that value alone. A collection result places its members
  together using their resolved relations, including singleton collections;
  selecting one member as a value still renders its own local geometry.
  An operation-input site may also render
  its peer inputs as dimmed context that can switch input focus. Mouse hover
  over source code does not change the viewport. In a layered source scene,
  focus solids are slightly translucent while context remains strongly dimmed,
  so overlaps stay legible; a single focus solid keeps its own material opacity.
- Topology reference values retain their selected IDs through bindings and
  collections. Their preview emphasizes the returned vertices, edges, or
  surfaces with the owning geometry dimmed as spatial context; topology
  accessor calls use the same dimmed context while editing the selected IDs.
- Topology and relation guides use fixed screen-space sizes: vertices are
  5px; passive line decorations and source highlights are 1px; interactive
  topology selection guides and highlights are 2px. Direction arrowheads are
  10px long and 6px wide at every zoom and device pixel ratio. Align source and
  target heads share that size; relation emphasis scales the entire secondary
  marker group to 70% of its base opacity. Available references are dim gray,
  previewed/selected references yellow-green, hovered unselected references
  cyan, and hovered selected references orange. Hover changes color only;
  face fill opacity stays constant and selected and hovered fills do not stack.
  Hover is recomputed at the retained pointer position after selection changes
  and recompilation. Vertex and edge picking uses a six-CSS-pixel radius and
  chooses the closest projected element, independently of zoom and model scale;
  surfaces use ray/triangle intersection.
- Face normal shafts, axis-end extensions, point/origin dots and crosses,
  reference rings and coordinate frames use CSS-pixel sizes independently of
  model extent, occurrence scale, zoom and viewport dimensions. Axis shafts
  retain their geometric extent, including group children; curve heads stay
  on their directed endpoints. Translation and rotation controls also retain
  their pixel scale through viewport resizing. Image capture sizes decorations
  for its own camera and output viewport. Shared conventions and current size
  defaults are recorded in the
  [visualization skill](.agents/skills/code3d-visualization/SKILL.md).
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
- Constraint expressions preview the current immutable chain prefix on the
  receiver's inherited relations. Sibling return expressions are only combined
  in the completed `relate` value. Offsets and rotations after the caret do not
  affect its preview; pending pivot/axis selections preserve the preceding pose.
  Stage placement, constraint geometry and spatial tools share one snapshot,
  while final model geometry and exports remain unchanged. An unsolvable prefix
  reports a local preview diagnostic without invalidating a solvable final model.
  See [#44](https://github.com/vilicvane/code3d/issues/44).
- The completed `relate` call scope focuses its final output and renders all
  references added by that invocation at secondary emphasis, with downstream
  composition peers at the third level. Only newly added constraints contribute
  markers; inherited constraints still affect the solved pose. Callback scopes
  retain their individual stage previews, and standalone bindings remain local.
  See [#58](https://github.com/vilicvane/code3d/issues/58).
- Relation marker focus follows source scopes: on/align methods and later
  chain operations (including their arguments) emphasize self; the target
  argument range, including whitespace and nested expressions, emphasizes the
  target element. Explicit receiver references emphasize the source. Reverse
  syntax still assigns chain operations to self. Each relation side retains
  its own identity even when both reference the same model node. Main markers
  keep their base opacity; all secondary arrows, rings, bounds, surfaces and
  edges multiply it by 0.7. Model translucency instead ensures visibility
  through geometry using an opacity cap, never a multiplier on material opacity:
  `min(materialOpacity, levelLimit)`. Primary surfaces are capped at 0.82;
  secondary surfaces, lines and points at 0.7. Default surfaces already at
  0.68 remain at 0.68 on both sides, with markers expressing focus. These
  models retain their colors, including group children. Other related models
  form a third, dimmed context level (surface cap 0.18, line and point cap
  0.28), preserving any already lower material opacity. Model caps and marker
  multipliers are separate settings. The other side of the current constraint
  must not share the outer context's dimming. One relation decoration provider
  owns both groups, without an additional ordinary topology-reference highlight.
  Value identities remain separate from marker focus so completion uses the
  actual reference receiver. See [#46](https://github.com/vilicvane/code3d/issues/46).
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
  context: the current relation side is the focus, the other participant has
  secondary emphasis, and the remaining concrete downstream composition is
  dimmed context. Matching uses the
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
- Viewport navigation uses Three.js Arcball rotation across both poles, with
  left-button rotation, right-button panning and wheel/middle-button zoom.
  Camera distance has no fixed limits; framing follows geometry size, and
  clipping and distance fog follow zoom.
  Wheel zoom keeps the focus-plane point under the pointer fixed on screen;
  wheel input outside the viewport does not navigate the camera.
  Rotation has a short release inertia, interrupted while a spatial tool owns
  the drag. Framing and previews use Arcball's live focus after pan or cursor
  zoom. Resize updates the control bounds; completion previews restore camera
  up together with position and focus. See [#55](https://github.com/vilicvane/code3d/issues/55).
- 3D viewport state belongs to the currently displayed root model instance or
  collection, including contextual peers but excluding decorations. Source
  operation/catalog identities and placement distinguish scenes across files
  and retain them through ordinary recompilation; focus/emphasis and collection
  ordering do not create new states. Each scene remembers camera orientation,
  focus, distance and Modeling/Render mode during the current App session.
  Group results and their corresponding input collections provide bidirectional
  first-visit defaults through a rigid coordinate-frame conversion; their own
  records take precedence thereafter. Initial views fit geometry. Scene changes
  interpolate distance geometrically over 300ms along with focus and orientation,
  reuse the existing interrupted/reduced-motion navigation behavior, and keep
  temporary completion previews out of view history. Compilation presents the
  selected source scene directly rather than briefly visiting its fallback
  export. Automated image/agent rendering applies the destination immediately.
  See [#82](https://github.com/vilicvane/code3d/issues/82).
- The upper-right coordinate indicator aligns the view to any of its six axis
  ends in the displayed world or selected occurrence's local frame, preserving
  the current focus and zoom distance. Clicking the facing endpoint again flips
  to its opposite side. Double-clicking the indicator restores the default
  oblique orientation in that frame and fits the model. Positive endpoints have
  white axis labels; negative endpoints are unlabeled dots. Both actions use a
  300ms eased rotation, with focus and distance included when resetting.
  New view requests continue from the displayed pose; direct navigation and
  spatial tools interrupt transitions. Reduced-motion preferences skip them.
  Framing uses the limiting horizontal/vertical field of view so narrow
  viewports still contain the fitted geometry. Axis buttons support
  Enter/Space; Enter/Space on the indicator itself resets the view. Camera
  changes stop navigation inertia without changing model selection or source.
- Viewport occurrence selection leaves the focused geometry's materials
  unchanged; source context dimming carries the primary focus contrast. A
  passive one-pixel screen-space corner bound marks only groups and other
  scopes without their own renderable geometry. Parameter and position previews
  use one-pixel geometry-aware emphasis in a secondary color for other affected
  occurrences.
- Directional bound previews use the selection bounding-box color for their
  translucent fill, direction marker, and corner lines. The fill remains
  visible while the same occurrence has a bounding-box highlight; its own
  corner lines only render when that box is absent. Visibility follows each
  occurrence independently, including repeated instances and selection changes.
  Box and face corner segments share a limit of 18% of each edge and 32 CSS
  pixels at each end, with separate perspective compensation for the two ends.
  See [#40](https://github.com/vilicvane/code3d/issues/40).
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
- App diagnostics, completion and model evaluation use one selected package
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

### 2. Runtime source context

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
  isolated. Origin operations, rotation, and scaling also show peers from the
  concrete downstream composition while retaining the selected operation's
  geometry and tools. The current operation and its consumer have separate
  identities; later values of the focused part are excluded from peer context.
  Consumer evaluations remain distinct, with the latest shown first. See [#58](https://github.com/vilicvane/code3d/issues/58).
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
[#22](https://github.com/vilicvane/code3d/issues/22) completed automatic receiver
and input tracking, including function parameter bindings. Within `relate`,
model values, callback parameters, and named or topology anchors share the
relation context; participants also appear in their solved placement before a
downstream composition is written. Broader relationship browsing remains the
separate discussion in #2.
Focused items in Monaco's native TypeScript member completion reuse the same
viewport preview immediately, then replace it with a model compiled from the
hypothetically accepted completion. The incomplete source and caret remain
unchanged, and the caret-selected scene returns when completion closes.
Unchanged compiler options and declarations preserve Monaco's TypeScript worker
and in-flight completion requests; actual language changes still synchronize.
See [#26](https://github.com/vilicvane/code3d/issues/26).
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

### 3. Directional bounds and explicit rotations

Keep B-Rep geometry local and store relations on immutable model copies.
Models without relations are fixed references. `on` contributes linear
translation conditions; explicit rotations determine orientation. Remaining
position freedom minimizes displacement at authored contact stages, with
redundant stages counted once. Conflicting translations or explicit
orientations report errors. The nonlinear core solver adapter and its Node/Worker
WASM initialization have been removed.

Use the target's local +Y/−Y/+X/−X/+Z/−Z for up/down/right/left/front/back.
Project the selected source geometry into that same direction to obtain its
matching support boundary. Group bounds include solved child placements;
point and planar sources allow degenerate ranges. Only finite sources and
directional targets are accepted. Old bound references retain their value;
new bounds describe derived geometry. `flip` changes only facing metadata.

Constraint rotations use self even when self is the written target. Local
pivot coordinates and vertex IDs resolve against self; external axes resolve
against their model's composition. Contact and explicit rotations compose in
source order. Other relations still constrain the resulting pose.

See [#36](https://github.com/vilicvane/code3d/issues/36),
[#38](https://github.com/vilicvane/code3d/issues/38), and
[core semantics](packages/core/README.md#bound-relations-and-rotation).

`align` adds joint rigid-pose solving for point/curve/surface coincidence and
membership ([#43](https://github.com/vilicvane/code3d/issues/43)). Its analytic
geometry representation is independent of trims and parameter origins: points,
lines, circles, ellipses, planes, cylinders, and spheres. Complete locus
equations determine coincidence or inclusion; no sampled tangent frame stands
in for curved geometry. Other geometry types report unsupported. Proven
incompatibility and numerical nonconvergence are distinct errors.

Pure bound assemblies retain the exact linear specialization. Mixed assemblies
solve poses jointly; bodies with only on relations retain their authored
orientation, while align can determine orientation. Deterministic geometric
seeds preserve an already satisfied relation and resolve antipodal directions;
damped least squares solves remaining conditions without asserting uniqueness
or a global optimum. Duplicate semantic conditions share one equation set.
align offsets translate self in target reference axes after alignment and before
authored rotations; unlike on offsets, zero does not constrain free coordinates.
Line direction and surface facing remain separate from coordinate frames.
Relation snapshots carry actual source and target elements for curve highlights,
directed axis/tangent arrows, and surface normals that follow source previews.
Single align chains use rigid spatial previews. Multiple relations involving
align use numeric/source editing and recomputation, since a rigid preview does
not represent the response of coupled equations.

### 4. Relation-aware GUI tools — contact and rotation tools

- Show the translation gizmo only when the selected model carries a constraint
  and the caret-selected operation input supplies relative-position context.
- Edit traced `offset()` parameters at their upstream source target.
- When an `on()` relation has no offset yet, insert one on the constraint
  expression; later drags edit that call's parameters instead of stacking calls.
- Orient offset axes and previews in the target bound frame, accounting for
  self on either side of the written relationship.
- Show matched boundaries, editable relation pivots, self's pivot vertices,
  positioned axes, and three-angle or single-axis rotation handles at their
  respective source sites, including unfinished pivot and axis chains.
- Preview the relation source as a ghost when useful.
- Add copy and pattern tools on top of the same relation intents.
- Keep the caret-selected context stable across gizmo and contextual tool commits;
  present the actual source diff in a compact temporary popover instead of moving
  the editor selection.
- Let `Escape` cancel the active drag before handling menus or transient docks.
  Cancellation restores the pre-drag preview without writing source and leaves
  the code-selected tool panel open; mouse release commits only uncancelled drags.

Status: [R-006](requests/closed/R-006-show-spatial-tools-only-in-a-relative-position-context.md)
is complete. Value declarations and operation outputs do not expose the
translation gizmo or offset controls; eligible composition inputs and explicit
constraint source sites do.

### 4a. Topology-scoped modeling tools — complete

- Assign numeric edge IDs at primitive boundaries; retain complete IDs across
  scale, and use input paths across fillet, chamfer, Boolean, and loft derivations.
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

### 4b. Core package and Node-native projects — complete

Implementation and acceptance: [#6](https://github.com/vilicvane/code3d/issues/6)
and [#12](https://github.com/vilicvane/code3d/issues/12).

- Extract the author runtime into a real ESM `@code3d/core` package with emitted
  JavaScript, declarations, explicit exports, and an explicit tooling boundary.
- Resolve project-owned `node_modules` with a zero-install built-in runtime
  until the project declares core. Remove the injected `code3d` module and
  duplicated declaration string; never fall back after a declared dependency fails.
- Keep TypeScript language-service resolution separate from model building and
  evaluation while making both honor the same project package graph.
- Make the authoring convention valid for direct execution by a supported Node
  runtime and for ordinary TypeScript emit.
- Preserve one project-local core/kernel runtime during repeated App
  evaluations without coupling the host to its concrete runtime classes.

The repository uses `@code3d/app`, `@code3d/core`, `@code3d/solver`,
`@code3d/opencascade`, and `@code3d/screws`. Core emits a shared public type surface plus Node and tooling
entries. App reads the selected project's package implementations and
metadata lazily, evaluates native ESM in a persistent project Worker, and
loads the same packages' declarations into Monaco. The detailed design is
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
is implemented as a content-addressed kernel-operation cache covering
solid construction and modification, Boolean prefixes and context regions,
relative transforms, topology sidecars, exact transformed bounds, and render meshes.
The latest evaluation's full working set is retained. Unused historical entries
are managed by LRU against a default 2 GiB memory budget, without a fixed entry
count. The budget combines allocated native block sizes from the pinned
mimalloc heap with estimated JavaScript cache storage (including mesh buffers,
topology paths and cache keys). Native geometry shared across handles is counted
once by the allocator; JavaScript objects shared across entries may be counted
more than once. The previous and current sets remain
protected until evaluation and snapshotting finish, avoiding cache thrashing when
a model exceeds the historical capacity; see [#52](https://github.com/vilicvane/code3d/issues/52).
The budget is a trimming target, not a hard limit on the page or the protected
working set. Released native blocks are reusable even when WASM's capacity does
not shrink. Compiler code, non-cache JavaScript objects, rendering/GPU resources
and temporary operation peaks are outside the JavaScript estimate.
JavaScript and provenance are still evaluated afresh. Browser persistence (#79)
adds a separate origin-wide disk LRU using binary BREP and exact topology/bounds/
reference-basis/mesh sidecars. Core exposes a synchronous artifact store boundary;
App opens OPFS asynchronously around compilation and closes it afterward. Runtime
identity hashes resolved implementation files and both WASM binaries, excluding
ephemeral asset URLs. Node authors keep the memory cache; the browser agent/CLI
compiler shares the persistent path.

The journal uses two append-only generations with checksummed records, lazy
payload reads, and publication after flushing a complete compaction. Physical
disk capacity is min(1 GiB, 10% of browser quota), including half for compaction.
A cancellable Web Lock serializes journal ownership across tabs and Workers.
Storage failures preserve memory-only evaluation. Saved IDs, transforms and mesh
bytes restore exactly; fresh native measurements allow the few-ULP direction
normalization performed by BinTools. Context-region mesh IDs use traversal order,
never runtime-specific native handle hashes.

Ordinary cancellation retains that Worker: the client sets a shared flag,
kernel operation boundaries check it before starting work, and evaluation exits
through its existing `finally` to retain the completed prefix and trim history.
The latest queued revision starts only after cleanup; intermediate queued edits
are rejected without evaluation. Preparation applies dependency invalidation
before checking cancellation. A five-second cancellation grace period bounds
unresponsive synchronous/native code, after which the Worker and its memory cache
are discarded; previously flushed persistent artifacts remain reusable. Project close, preparation/export deadlines and Worker crashes retain
their hard-stop behavior. App documents and Workers use COOP/COEP headers in dev,
preview and static hosting to enable the shared flag; see #52.

User-defined Replicad builders execute on every invocation because their
closures may depend on state beyond their arguments. Core identifies the actual
returned solid by its B-Rep representation so identical output can reuse geometry,
downstream operations, and meshes across evaluations. Model values and tracing
remain fresh; custom primitives use the standard mesh tolerance. The screws
package privately caches deterministic thread B-Rep data in a bounded LRU, reading
an independently owned shape in the current kernel for each invocation. This
avoids caching disposable model objects or retaining native handles across kernels.

### 4d. Annotation-driven contextual tools

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
  Function implementations own runtime defaults. Optional numeric parameters
  display defaults for omitted arguments through explicit `@code3d.param`
  `default` metadata, shared by source and emitted declarations
  (see [#29](https://github.com/vilicvane/code3d/issues/29)).
  Do not extract implementation initializers or inject annotation defaults into
  non-interactive execution. Authors keep the display metadata consistent with
  the implementation. Resolve effective selections, environment-dependent steps,
  display ranges, units, and other presentation policy from the reached tool
  context and current environment.
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
  Bound relations use the selected finite topology extent, including curved
  geometry; sampled directions remain available for geometric queries.
- Let `loft(sections, {spine})` transform every related input into the first
  section's frame. Without a spine it builds a through-sections loft; with a
  spine it uses a multi-section pipe shell so the curve affects the generated
  geometry rather than serving only as a placement guide.
- Loft caps retain their endpoint section face paths. Section edges/vertices
  use unchanged/modified history and intersections of generated side topology
  with the endpoint cap; ruled intermediate edges can also inherit through their
  generated side faces and unchanged endpoint identities. Ambiguous split edges
  receive new IDs. Middle section faces do not become caps. Through-section
  construction disables input mutation.
- Validate the complete path with two non-parallel related planar profiles at
  the endpoints of a curved spine, including Node execution, App rendering,
  source context, and topology selection on the result and inputs.

Status: complete. Node tests cover renderable face/edge/vertex models, all three
topology anchor kinds, ordinary through-section loft, and a curved-spine loft
between nonparallel circle and rectangle profiles. Host-Chrome validation also
confirmed App rendering, section/spine source context, and Surface, Edge,
and Vertex viewport selectors on the new model kinds and loft result.

The generic face extrusion from the sketch work in
[#23](https://github.com/vilicvane/code3d/issues/23) is integrated independently
in [#56](https://github.com/vilicvane/code3d/issues/56):
`face.extrude(distance)` and `extrude(face, distance)` share one kernel operation,
cache, topology lineage, and source tracing path. Signed non-zero distance follows
the face's local normal without recentering; the result is an ordinary solid.
This does not integrate the sketch system itself.

### 5. Object combination tools

Design discussion and live scope: [#8](https://github.com/vilicvane/code3d/issues/8).

- Handwritten standalone `union`, `cut`, and `intersect` functions are now the
  only Boolean API; the old instance methods were removed.
- Later allow an explicit tool mode to resolve multiple semantic selections.
- Treat the main selection as the primary boolean operand and result frame.
- Initially generate a new binding in a safe common lexical scope; do not guess
  which downstream JavaScript references should change.

## Open questions

Additional Boolean operand-anchor APIs and large-model lineage/mesh retention
questions are tracked in [#9](https://github.com/vilicvane/code3d/issues/9).
Geometric constraints (#21), named topology references and retired-ID semantics
(#27), and geometric scaling (#33) already have implemented, documented behavior.
The bounded kernel cache and the runtime/resource ownership boundaries are also
implemented; #9 discusses additional needs at larger scales.

The [solver experiment](plans/constraint-solver-wasm-evaluation.md) records the
earlier OndselSolver investigation. The independent solver package remains,
while current core/App bound positioning uses a linear translation solver and
explicit rotations, as delivered in [#38](https://github.com/vilicvane/code3d/issues/38).
Geometric `align` uses analytic loci and joint rigid-pose equations, described
in [#43](https://github.com/vilicvane/code3d/issues/43).
The completed public API
and interoperability audit is recorded in
[plans/public-api-audit.md](plans/public-api-audit.md) and
[#5](https://github.com/vilicvane/code3d/issues/5).

Relationship browsing belongs to [#2](https://github.com/vilicvane/code3d/issues/2),
object-parameter controls to [#7](https://github.com/vilicvane/code3d/issues/7), and
source lifting for combination tools to [#8](https://github.com/vilicvane/code3d/issues/8).
Sketch editing has its own implementation and acceptance in
[#23](https://github.com/vilicvane/code3d/issues/23); its development-branch features
are not part of the integrated capability descriptions above.
Confirmed outcomes return to the design documents; discussion status stays in
Issues.

## Completed foundation

- `76e91d8`: initial OpenCascade prototype.
- `0eddd6f`: source-backed parameter editing.
- `a83f36e`: common source-backed modeling tools.
- `d28443d`: Prettier integration and stabilized source-backed editing.
- `83a847f`: exact source-node previews, including repeated runtime objects.
