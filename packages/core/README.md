# @code3d/core

The TypeScript modeling runtime used by Code3D. Compose solids, profiles, curves,
points, and editable sketches; inspect their geometry and reuse the same models
in the App or a supported Node.js runtime.

Model constructors define the initial origin; derived operations inherit their main
input frame. `group`, `union`, and `intersect` use the first member or operand,
`cut` uses the stock, `loft` uses the first section, and `revolve` uses the
profile. See the
[default origin rules](docs/local-coordinates.md#default-origin-rules)
for all constructors and explicit origin operations.

## Start with a model

```sh
npm install @code3d/core
```

```ts
import {box, cylinder, group} from '@code3d/core';

const base = box(40, 4, 24).fillet(1);
const post = cylinder(3, 18).relate(self => self.on(base.up));

export default group([base, post]);
```

Open this source in Code3D and select an expression to inspect its value. Node
loads the modeling kernel through the package's Node entry automatically; normal
model authors do not initialize it or manage evaluation caches themselves.

The App includes Core, [Materials](../materials/README.md), and
[Screws](../screws/README.md) for zero-install projects. When the active model's
package scope or an ancestor `package.json` declares `@code3d/core`, the App uses that project's installed
packages and declarations exclusively. Missing dependencies are errors. See
[project package installation](../web/src/content/docs/docs/getting-started/files.md#install-packages-in-browser-storage)
and the [agent file workflow](../../docs/agents/files.md).

## Find the modeling API

| Task                                                                            | Start here                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Solids, planar profiles, curves, points, Boolean operations, extrusion, revolution and loft | [Modeling reference](docs/api.md)                                                  |
| Place parts with bounds, align geometry or match coordinate frames              | [Relations](docs/relations.mdx)                                                    |
| Change origins and rotate parts                                                 | [Origins and rotation](docs/origins-and-rotation.mdx)                              |
| Hollow a solid or choose openings                                               | [Shells](docs/shells.mdx)                                                          |
| Select vertices, edges and surfaces, or expose named elements                   | [Topology](docs/topology.md)                                                       |
| Build reusable model functions                                                  | [Reusable models](../web/src/content/docs/docs/guides/reusable-models.mdx)         |
| Give functions editing tools and example arguments                              | [Model tools](../web/src/content/docs/docs/guides/model-tools.mdx)                 |
| Customize parameter and call inspection                                         | [Source inspection](docs/runtime.md#source-inspection)                             |
| Extend the runtime with Replicad geometry                                       | [Custom primitives](docs/custom-primitives.mdx)                                    |
| Known boundaries                                                                | [Current limitations](../web/src/content/docs/docs/getting-started/limitations.md) |

See also [model values and measurements](docs/values.md), [editable sketches](docs/sketches.md),
[text and fonts](docs/text.md), and [runtime integration](docs/runtime.md).

## Source and development

Start with the [public API](src/library/index.ts), [runtime tests](test/), and
[development and integration notes](docs/runtime.md#source-and-development).
