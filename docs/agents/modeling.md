# Modeling workflow

[Start here](../agents.md) · Read this when planning a model, choosing APIs or
making source easier for the user to understand and continue editing.

## Work from the project

Read the relevant source and its imports through the CLI before choosing an
implementation. Preserve the project's conventions, named models, parameters and
dependencies. Use [function arguments](cursor.md) to evaluate a design at the
requested dimensions without rewriting its defaults.

Prefer the public [Core API](../../packages/core/README.md). Build a shape from
primitives, profiles, sketches, Boolean operations and relationships. Use
`ellipsoid(xRadius, yRadius, zRadius)` for a centered solid with three independent
axis radii, or `ellipse(xRadius, zRadius)` for a planar profile. Give useful
intermediate geometry meaningful names so a person can select it in the editor
and understand the construction. Keep expressions and design constraints where
they communicate intent; a long list of final coordinates usually loses that
information. Use lower-level geometry when the public API cannot express the task.

Change one coherent part of the design, then observe it before proceeding. Use
the smallest output that answers the question: types for API exploration, topology
for geometry queries, or an image for visual confirmation. Combine them when the
task benefits from several forms of evidence.

## Find the right modeling tools

| Need                                                                           | Read                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives, Boolean operations, profiles, extrusion, revolution, sweep or loft | [Core README](../../packages/core/README.md) and [modeling reference](../../packages/core/docs/api.md)                                                                    |
| Measure geometry and derive another part's dimensions                          | [Measurements](../../packages/core/docs/api.md#measurements) and [fitted beam](../../packages/app/examples/operations/distance.ts)                                        |
| Place parts against each other or align geometric elements                     | [Relations](../../packages/core/docs/relations.mdx)                                                                                                                       |
| Understand local geometry, composition placement or origin changes             | [Coordinate concepts](../../packages/core/docs/local-coordinates.md) and [origin operations](../../packages/core/docs/origins-and-rotation.mdx)                           |
| Select or expose edges, vertices and surfaces                                  | [Topology](../../packages/core/docs/topology.md) and [agent observations](observation.md)                                                                                 |
| Create editable profiles and inspect their constraints                         | [Sketch workflow](sketches.md)                                                                                                                                            |
| Arrange collections with Flex/Grid or fill target bounds                       | [Layout README](../../packages/layout/README.md)                                                                                                                          |
| Add realistic material presets                                                 | [Materials README](../../packages/materials/README.md)                                                                                                                    |
| Add standard fasteners or matching holes                                       | [Screws README](../../packages/screws/README.md)                                                                                                                          |
| Reuse a parametric design or expose editing controls                           | [Reusable models](../../packages/web/src/content/docs/docs/guides/reusable-models.mdx) and [model tools](../../packages/web/src/content/docs/docs/guides/model-tools.mdx) |
| Extend the modeling runtime                                                    | [Custom primitives](../../packages/core/docs/custom-primitives.mdx)                                                                                                       |

Layout configuration is required: specify `axis` for Linear/Radial/Flex and `axes`
for Grid. Filling also needs explicit spacing (`gap: 0` for touching copies).
Flex cross alignment or wrapping requires `crossAxis`; see the Layout reference
for directional grid gaps and other controls.

For a rotational solid or simple helical form, use
`revolve(profile, straightAxis, {angle, advance?})`. `angle` is the total
degrees of rotation; `advance` is the total signed distance along the directed
axis. Pass `line(...)` directly as the axis, or use an existing straight edge
reference. Without advance, use at most 360 degrees. See the
[rotational solid reference](../../packages/core/docs/api.md#rotational-solids).

For a bent rod or duct, use `sweep(profile, spine)` or `profile.sweep(spine)`.
The profile's local origin must meet the start of an open curve, and its normal
must point along the curve's starting tangent. A circle and a Bézier path are
shown in the [path sweep reference](../../packages/core/docs/api.md#path-sweeps).

Use `originCenter(profiles)` to center a complete text layout and keep its face
array for `extrude` or `wrap`. The instance method and singleton arrays use the
current local bounding-box center; `originPoint(model.center)` selects the stable
center anchor instead. See [centering a collection](../../packages/core/docs/api.md#centering-a-collection).

For text or planar outlines on a curved face, position the profiles first, then
use `wrap(profiles, target.surface(id))`. The complete finite layout chooses the
closest target region. `thicken(faces, positiveThickness)` produces raised
lettering for `union`; a negative thickness produces engraving tools for `cut`.
Ambiguous local mappings and crossing regions throw. See
[curved surface wrapping](../../packages/core/docs/api.md#curved-surface-wrapping)
for supported surfaces, distortion and trimmed boundaries.

Check the [current limitations](../../packages/web/src/content/docs/docs/getting-started/limitations.md)
before promising a feature.

## Place a constrained part

`part.relate(self => ...)` returns a new value. Every constraint must involve
the callback value; external variables, including `part`, keep their original
identity. Select the new value's elements and rotation references through `self`.
This rule also applies to sketch frames. Import `on` and `align` from Core.
`on(targetBound)` places the whole current self; `on(sourceElement, targetBound)`
selects a specific source. `align(sourceElement, targetElement)` always states
both references. A callback that needs no explicit self can use
`part.relate(() => on(base.up))`.

`model.frame` references the model's coordinate system;
`model.origin` is the same non-geometric reference as `model.frame.origin`.
Use `align(self.frame, target.frame)` to match complete placement, or
`align(self.origin, target.origin)` to match only origin position. Layout calls
with a target space follow its frame automatically; spread the returned models
into the final group without including the construction space.

Use `relate` for composition placement and `originOffset` to change local
geometry coordinates. Constraints describe `on`, `align` or fixed-axis `coupleRotation`; they have no
chained offset, rotation or pivot/axis selectors. Consecutive constraints solve jointly. Independent Core
`offset`/`rotate` values move that result; later constraints start a new segment
from the preceding pose. Offset uses fixed composition axes, while rotation
defaults to the current part origin. `pivot([x,y,z])` chooses self coordinates; `pivotVertex(id)` and `axisEdge(id)` choose self topology; `pivotPoint(pointRef)` and `axisLine(lineRef)` accept references. A selector can end with `rotate`: XYZ angles for a point, one angle for an axis. Inside `relate`, the standalone `coupleRotation(otherModel, {ratio, phase})` constrains self’s cumulative angle to `ratio * otherAngle + phase`, using each model’s own `.axis`. External references follow their owning model’s solved position; point references retain self’s rotation axes.
In the App, selecting `relate()` or its callback self exposes spatial tools without
activating one by default. Adding a transformation to a single returned constraint
converts the return value to an array. A selector and its final rotation share one tool and parameter panel. Picking a reference on an unfinished selector appends its missing zero-angle rotation; existing rotations and reference offsets are preserved. The edit undoes as one step. Only the focused align/on relation shows its axes/faces; self and transformation tools keep their own reference markers.
Pick its reference directly from the visible point/axis candidates; hold Alt to
move the reference with its translation gizmo. Moving coordinate
`pivot([...])` updates its coordinates directly; moving a topology or point/line reference
retains the reference and adds or updates its matching offset. Changing between
point and axis rotation adds a new operation instead of replacing the existing
rotation. These tools act on the current `relate` self; external axes are references.

Before rotating, point selectors accept one `pivotOffset(dx, dy, dz)` in self local
axes; axis selectors accept one `axisOffset(dx, dy, dz)` in the selected axis frame.
These retain the reference and move the rotation center or axis, not the part.
Completed transformations have no chaining methods; combine steps as array items,
for example `[offset(0, 8, 0), rotate(0, 25, 0)]`. Read the
[placement rules](../../packages/core/docs/relations.mdx#transform-a-joint-result)
before mixing these operations. Shared source, including a loop callback, changes
all of its runtime instances.

## Expose numeric inputs

Use `input('Width', 40)` from Core for a numeric parameter shown in the App's
Inputs form. Valid values re-evaluate the complete model as you type or drag,
without waiting for blur or pointer release. Reset restores defaults; neither
action changes source. Values are temporary for the current file session, and
switching files clears them. Repeated names share one field and
must declare the same default, range and step. Add a third argument such as
`{min: 4, max: 100, step: 1}` to define bounds and control increments; providing
both bounds adds a slider. Defaults must fit the range and form step. Selecting
a call opens and highlights its field; Tab focuses its value. Empty or invalid
text keeps the last valid model value; other fields continue to update. Read inputs
outside cached functions and pass changing values explicitly. See
[numeric inputs](../../packages/core/docs/runtime.md#numeric-inputs)
and the [complete example](../../packages/app/examples/inputs.ts).

## Animate an assembly

Read `timeOffset()` from Core and derive angles or offsets with ordinary
TypeScript. The offset is measured in seconds from the playback origin, starts
at zero in the App, and is fixed during each full project evaluation. Use existing
`group` and `relate` APIs to assemble parts. The App provides Play, Pause and Reset below the viewport; source edits
pause playback. Read time before calling a cached function and pass it explicitly
when its result depends on time. This API does not provide persistent writable
state or history-dependent mechanism solving.

See [time offset](../../packages/core/docs/runtime.md#time-offset) and the
[rotating arm example](../../packages/app/examples/constraints/animation.ts).

For a fixed parallel-axis gear train, attach the input gear to a driven crank's
frame before `assembleGears()`. Returned gears carry tooth-ratio rotation
constraints; output shafts and cranks use ordinary frame alignment. Only the input
crank reads `input()` or `timeOffset()`. Use cumulative angles without `% 360`
when a downstream ratio must preserve whole revolutions. See the
[transmission example](../../packages/app/examples/packages/gears/transmission.ts)
and [supported motion scope](../../packages/gears/docs/api.md#drive-through-connected-parts).

## Reuse expensive computations

Use `cache()` for deterministic synchronous data and `definePrimitive()` for
custom Replicad solids. Both reuse repeated calls, so pass changing captured state
as arguments; treat cached data as immutable and keep native shapes behind the
primitive builder. Read the [cache contract](../../packages/core/docs/api.md#cached-computations)
when introducing either API. For lettering, the [text reference](../../packages/core/docs/api.md#text)
covers asynchronous font loading, Google Fonts and batch extrusion. Await `font()` or
`googleFont()` before passing the resulting font to synchronous `text()` calls.

## Explore dependencies

Start with the public modeling packages above. When you need another package or
its underlying implementation, follow the project's imports and the package's
`package.json` dependencies. Read its README on GitHub or in the relevant
installed `node_modules` package, then follow links to public types, source and
tests. Use the installed package's version when checking exact behavior.

A Browser storage project or an App built-in package may have no local
`node_modules` directory. Read App project files through the CLI and use the
package's repository for further documentation in that case.

## Verify the intended result

An observation targets your selected source expression. Choose the result to
inspect the final part, or an intermediate expression to inspect that construction
stage. [Render views and modes](observation.md) control the returned image; a
successful compilation alone does not establish that the shape matches the task.

Interpret positions in their reported coordinate frame. A model has its own local
geometry, while its placement among other models belongs to the composition.
An isolated observation can therefore differ from the same part in an assembly.
Use returned topology IDs and source bindings in their actual model scope.
Local edits (`fillet`, `chamfer`, `shell`) preserve one-to-one IDs; new elements
get fresh numbers. Splits, merges and deletions can still retire an ID.

The user can follow your activity. Reads can open files, lists can reveal folders,
and accepted source/cursor changes can synchronize the model. Explicit render
view/mode requests also synchronize while following; observation defaults do not
force those settings onto the user's viewport. The user remains free to navigate
and edit. Use [file versions](files.md) to handle concurrent changes.

Finite edges / edge models expose readonly `.length` (arc length, including
closed circumferences); finite surfaces / face models expose `.area`, and solids
expose total boundary `.area`, including inner walls, and material `.volume`,
excluding holes and cavities. Values use model units, square model units and
cubic model units respectively, with scaling applied. Reference axes/planes and
groups do not have these measurements. Select the property for its read-only
inspection; see [length and area](../../packages/core/docs/api.md#length-and-area)
and [volume](../../packages/core/docs/api.md#volume).

Selecting a `distance(...)` source call emphasizes both measured objects against the
dimmed call-time relation context, plus a gray dashed measurement line, endpoint ticks and numeric value.
Whole solids and groups retain their model appearance without a face-selection overlay;
measured elements are highlighted over dimmed owners.
Axis letters X/Y/Z share the viewport axis colors. Inside an argument, model
variables and element references keep their own focus while the measurement
remains visible. The other whole model is dimmed; the other measured element uses secondary emphasis. A bound
shows its normal direction only when that bound is explicitly selected.
Plain distance uses closest points; an axis uses projected interval limits, which
need not be points on the geometry. This passive preview follows the call's runtime
instance, does not change model parameters, and does not include later consumers of
the returned number. It is included in annotated PNG output, not CAD geometry.
