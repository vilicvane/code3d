# Modeling workflow

[Start here](../agents.md) · Read this when planning a model, choosing APIs or
making source easier for the user to understand and continue editing.

## Work from the project

Read the relevant source and its imports through the CLI before choosing an
implementation. Preserve the project's conventions, named models, parameters and
dependencies. Use [function arguments](cursor.md) to evaluate a design at the
requested dimensions without rewriting its defaults.

Prefer the public [Core API](../../packages/core/README.md). Build a shape from
primitives, profiles, sketches, Boolean operations and relationships. Give useful
intermediate geometry meaningful names so a person can select it in the editor
and understand the construction. Keep expressions and design constraints where
they communicate intent; a long list of final coordinates usually loses that
information. Use lower-level geometry when the public API cannot express the task.

Change one coherent part of the design, then observe it before proceeding. Use
the smallest output that answers the question: types for API exploration, topology
for geometry queries, or an image for visual confirmation. Combine them when the
task benefits from several forms of evidence.

## Find the right modeling tools

| Need                                                               | Read                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives, Boolean operations, profiles, extrusion or loft        | [Core README](../../packages/core/README.md) and [modeling reference](../../packages/web/src/content/docs/docs/reference/core.md)                                                               |
| Place parts against each other or align geometric elements         | [Relations](../../packages/web/src/content/docs/docs/guides/relations.mdx)                                                                                                                      |
| Understand local geometry, composition placement or origin changes | [Coordinate concepts](../../packages/web/src/content/docs/docs/concepts/local-coordinates.md) and [origin operations](../../packages/web/src/content/docs/docs/guides/origins-and-rotation.mdx) |
| Select or expose edges, vertices and surfaces                      | [Topology](../../packages/web/src/content/docs/docs/guides/topology.md) and [agent observations](observation.md)                                                                                |
| Create editable profiles and inspect their constraints             | [Sketch workflow](sketches.md)                                                                                                                                                                  |
| Add realistic material presets                                     | [Materials README](../../packages/materials/README.md)                                                                                                                                          |
| Add standard fasteners or matching holes                           | [Screws README](../../packages/screws/README.md)                                                                                                                                                |
| Reuse a parametric design or expose editing controls               | [Reusable models](../../packages/web/src/content/docs/docs/guides/reusable-models.mdx) and [model tools](../../packages/web/src/content/docs/docs/guides/model-tools.mdx)                       |
| Extend the modeling runtime                                        | [Custom primitives](../../packages/web/src/content/docs/docs/guides/custom-primitives.mdx)                                                                                                      |

Check the [current limitations](../../packages/web/src/content/docs/docs/reference/limitations.md)
before promising a feature.

## Place a constrained part

Use `relate` for composition placement and `originOffset` to change local
geometry coordinates. Consecutive constraints solve jointly. Independent Core
`offset`/`rotate` values move that result; later constraints start a new segment
from the preceding pose. Offset uses fixed composition axes, while rotation
defaults to the current part origin. `pivot([x,y,z])` chooses self coordinates; `pivotVertex(id)` and `aroundEdge(id)` choose self topology; `pivotPoint(pointRef)` and `aroundLine(lineRef)` accept references. Each selector ends with `rotate`: XYZ angles for a point, one angle for an axis. External references follow their owning model’s solved position; point references retain self’s rotation axes.
In the App, a selector and its final rotation share one tool and parameter panel. Picking a reference on an unfinished selector appends its missing zero-angle rotation; existing rotations and reference offsets are preserved. The edit undoes as one step. Only the focused align/on relation shows its axes/faces; self and transformation tools keep their own reference markers.
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
[placement rules](../../packages/web/src/content/docs/docs/guides/relations.mdx#transform-a-joint-result)
before mixing these operations. Shared source, including a loop callback, changes
all of its runtime instances.

## Reuse expensive computations

Use `cached()` for deterministic synchronous data and `definePrimitive()` for
custom Replicad solids. Both reuse repeated calls, so pass changing captured state
as arguments; treat cached data as immutable and keep native shapes behind the
primitive builder. Read the [cache contract](../../packages/web/src/content/docs/docs/reference/core.md#cached-computations)
when introducing either API. For lettering, the [text reference](../../packages/web/src/content/docs/docs/reference/core.md#text)
covers synchronous font resources, Google Fonts and batch extrusion.

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

The user can follow your activity. Reads can open files, lists can reveal folders,
and accepted source/cursor changes can synchronize the model. Explicit render
view/mode requests also synchronize while following; observation defaults do not
force those settings onto the user's viewport. The user remains free to navigate
and edit. Use [file versions](files.md) to handle concurrent changes.
