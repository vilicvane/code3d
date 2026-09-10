# @code3d/core

The TypeScript modeling runtime used by Code3D. Compose solids, profiles, curves,
points, and editable sketches; inspect their geometry and reuse the same models
in the App or a supported Node.js runtime.

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
[Screws](../screws/README.md) for zero-install projects. When the root
`package.json` declares `@code3d/core`, the App uses that project's installed
packages and declarations exclusively. Missing dependencies are errors. See
[project package installation](../web/src/content/docs/docs/getting-started/files.md#install-packages-in-browser-storage)
and the [agent file workflow](../../docs/agents/files.md).

## Model values and coordinates

Operations produce new model values. Building another result must not change an
already-observable model's geometry, material, topology, or relations.

A model's local geometry and its placement in a composition are separate.
`relate()` records how a part is placed when composed with other parts; observing
that part alone shows its local geometry. `originOffset()` changes geometry
coordinates without changing the shape. Position arrays use `[x, y, z]`; scalar
angles use degrees. Read [local coordinates](../web/src/content/docs/docs/concepts/local-coordinates.md)
and [relations](../web/src/content/docs/docs/guides/relations.mdx) before mixing
origin changes, alignment, and rotation.

Build readable models from named intermediate values and public operations. A
profile followed by extrusion, or solids combined with Boolean operations,
keeps the construction understandable and editable by both people and agents.

## Find the modeling API

| Task                                                                            | Start here                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Solids, planar profiles, curves, points, Boolean operations, extrusion and loft | [Modeling reference](../web/src/content/docs/docs/reference/core.md)                 |
| Place parts with bounds or align underlying geometry                            | [Relations](../web/src/content/docs/docs/guides/relations.mdx)                       |
| Change origins and rotate parts                                                 | [Origins and rotation](../web/src/content/docs/docs/guides/origins-and-rotation.mdx) |
| Hollow a solid or choose openings                                               | [Shells](../web/src/content/docs/docs/guides/shells.mdx)                             |
| Select vertices, edges and surfaces, or expose named elements                   | [Topology](../web/src/content/docs/docs/guides/topology.md)                          |
| Build reusable model functions                                                  | [Reusable models](../web/src/content/docs/docs/guides/reusable-models.mdx)           |
| Give functions editing tools and example arguments                              | [Model tools](../web/src/content/docs/docs/guides/model-tools.mdx)                   |
| Extend the runtime with Replicad geometry                                       | [Custom primitives](../web/src/content/docs/docs/guides/custom-primitives.mdx)       |
| Known boundaries                                                                | [Current limitations](../web/src/content/docs/docs/reference/limitations.md)         |

Dimension-based primitives retain required TypeScript signatures while providing
runtime defaults for omitted or `undefined` values. The App displays these as
placeholders without inserting source arguments. Use explicit dimensions in
finished models; the [reference](../web/src/content/docs/docs/reference/core.md#runtime-defaults-while-editing)
lists the actual defaults.

Topology capabilities follow dimension: vertices expose vertex selection, edges
add edge selection, and faces and solids add surface selection. Only solids
provide `fillet`, `chamfer`, and `shell`. Groups compose values and support
relations, exposed elements, and materials without pretending to be geometry.

A topology ID belongs to its owning model and element kind. It is a number or a
flat numeric path, such as `.edge([1, 3])`. Operations track unambiguous ancestry;
transforms preserve complete paths. Inspect the result after topology changes
instead of assuming IDs from a different model still apply.

## Editable sketches

Sketches are immutable 2D definitions, separate from B-Rep model values. Entries
carry positive IDs within a layer; constraints express what should stay true.
A derived layer can reference its upstream geometry.

```ts
import {sketch} from '@code3d/core';

const profile = sketch(
  [
    ['point', 1, [0, 0]],
    ['circle', 2, [1, 8]],
  ],
  {
    constraints: [
      ['fixed', 1],
      ['radius', 2, 8],
    ],
  },
);

export const part = profile.face().extrude(3);
```

Closed regions bridge sketches to ordinary face and solid modeling. Read the
[sketch reference](../web/src/content/docs/docs/reference/core.md#editable-sketch-regions)
and [agent sketch workflow](../../docs/agents/sketches.md) for constraints,
derived layers, observations, and failure diagnostics. Exact tuple types and
solver behavior live in [sketch.ts](src/library/sketch.ts) and
[sketch-solver.ts](src/library/sketch-solver.ts).

## Materials and entry points

`.material()` accepts a color or a native Three.js material. Use
`@code3d/core/three` when constructing native materials, and
[@code3d/materials](../materials/README.md) for common presets. A model captures
its material value; changing the original Three.js object later does not change
that model. The renderer supplies lighting and environment reflections.

| Import                  | Responsibility                                                           |
| ----------------------- | ------------------------------------------------------------------------ |
| `@code3d/core`          | Public model authoring API; Node entry initializes the kernel            |
| `@code3d/core/three`    | Shared Three.js exports for material and geometry integration            |
| `@code3d/core/replicad` | Replicad access for custom primitive builders                            |
| `@code3d/core/tooling`  | Evaluation, inspection and resource lifetime integration used by the App |

Tooling integrations own evaluation lifetimes and disposal. Follow the existing
[tooling entry](src/tooling/index.ts), [evaluation tests](test/model-test.ts), and
[App compiler](../app/src/model/compiler.ts) when embedding the runtime. Ordinary
model files should stay on the authoring API.

## Source and development

- [Public exports](src/library/index.ts), [model runtime](src/library/runtime.ts),
  and [public type tests](test/public-types.ts).
- [Spatial values](src/library/spatial.ts), [relation solving](src/library/relation-solver.ts),
  and [topology](src/library/topology.ts).
- [Material values](src/library/material.ts), [kernel cache](src/library/kernel-cache.ts),
  and [Node entry](src/node/index.ts).
- [Executable App examples](../app/examples/) and [runtime tests](test/).

From the repository root:

```sh
npm run build:packages
npm test --workspace @code3d/core
```

Use the [agent entry](../../docs/agents.md) to work on a project through the CLI,
or the [App README](../app/README.md) to develop the editor and visualization.
