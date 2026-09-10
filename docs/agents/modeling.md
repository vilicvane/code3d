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

Package READMEs link to the public type exports, implementations and focused
tests. Inspect those when an overload, return type or exact behavior is unclear.
Check the [current limitations](../../packages/web/src/content/docs/docs/reference/limitations.md)
before promising a feature.

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
