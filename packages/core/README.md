# @code3d/core

The TypeScript modeling runtime used by Code3D. Compose solids, profiles, curves,
points, and editable sketches; inspect their geometry and reuse the same models
in the App or a supported Node.js runtime.

Model constructors define the initial origin; derived operations inherit their main
input frame. `group`, `union`, and `intersect` use the first member or operand,
`cut` uses the stock, and `loft` uses the first section. See the
[default origin rules](../web/src/content/docs/docs/concepts/local-coordinates.md#default-origin-rules)
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

Constraint `offset` and `rotate` calls execute in source order. Each transforms
self from the preceding solution; zero values add no centering or orientation
condition. Use point or axis alignment when a part must be centered. The App's
gizmos edit or insert the corresponding call at its actual position in the chain.

`relate` also accepts independent `offset` and `rotate` transformations. Choose a
center with `pivot([x,y,z])`, self topology with `pivotVertex(id)`/`aroundEdge(id)`,
or references with `pivotPoint(pointRef)`/`aroundLine(lineRef)`; finish each selector
with `rotate`. Point rotations retain self XYZ axes, including external centers. Consecutive constraints solve jointly; transformations
then act on that result in order. A later constraint starts a new segment using
the preceding pose. Independent offsets use fixed composition axes, and rotations
default to self's current origin. Each completed transformation is one array item,
for example `[offset(0, 8, 0), rotate(0, 25, 0)]`. Only pivot/axis selections
chain into `rotate`; completed transformations cannot chain into another operation.
Keep a selected reference while moving it with
`pivotVertex(id).pivotOffset(dx, dy, dz).rotate(x, y, z)` or
`aroundLine(axis).axisOffset(dx, dy, dz).rotate(angle)`. Point offsets use self local
axes; axis offsets use the selected axis frame and preserve its direction.
Each selector accepts one matching offset, followed by `rotate`.
See the [transformation example](../app/examples/constraints/transformations.ts)
and [placement guide](../web/src/content/docs/docs/guides/relations.mdx#transform-a-joint-result).

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

Dimension-based primitives and numeric modeling methods retain required TypeScript
signatures while providing runtime defaults for omitted or `undefined` values.
Rotations and displacements default to zero, scaling to one, extrusion distance
to ten, and fillet radius, chamfer distance and shell thickness to one. Relation
rotation chains use the same angle defaults; `pivot()` defaults to local zero.
Explicit invalid values retain their normal errors. These defaults work in
ordinary JavaScript execution as well as App previews.

The App displays defaults as placeholders without inserting source arguments.
Committing a spatial drag fills all remaining omitted defaults in that operation;
for example, dragging the X ring of `rotate()` writes `rotate(angle, 0, 0)`. The
edit and completion share one undo step. Use explicit dimensions in finished
models; the [reference](../web/src/content/docs/docs/reference/core.md#runtime-defaults-while-editing)
lists the actual defaults.

Topology capabilities follow dimension: vertices expose vertex selection, edges
add edge selection, and faces and solids add surface selection. Only solids
provide `fillet`, `chamfer`, and `shell`. Groups compose values and support
relations, exposed elements, and materials without pretending to be geometry.

Groups are model values and can be nested directly with `group([inner, other])`,
including in mixed `Model[]` collections. Nesting preserves each group's hierarchy;
`expose()` adds named references when callers need to address members.

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

### Relating a sketch to a model plane

`s.relate(self => self.plane.align(target))` returns a new sketch with spatial
relations, leaving its shared 2D definition and the original sketch unchanged.
It works before a face exists, including `sketch()` and open contours.

```ts
import {box, sketch} from '@code3d/core';

const host = box(40, 20, 30).rotate(0, 0, 25);
const profile = sketch([
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 4]],
]);
const opening = profile.relate(s => s.plane.align(host.surface(4)));
const result = host.cut([opening.face().extrude(-20)]);
const draft = sketch().relate(s => s.plane.align(host.surface(2)));
```

The target may be a named plane or a planar `host.surface(id)`. The sketch plane
normal is local `+Y`; alignment uses the same directed-plane, target-frame offset
and rotation semantics as model relations. It does not implicitly center the
sketch on a trimmed surface. An unbounded sketch plane cannot use `on()` to place
finite geometry against a bound; use `align()`. Topology-only pivots such as
`pivotVertex()` require a geometric model, not an empty sketch frame.

`derive()`, `face()` / `faces()` and extrusion inherit the relations. Boolean
operations and loft resolve their inputs in the shared composition context;
placement is not baked into tuple coordinates. A spatial copy shares point
identities with its original, so a derived layer can still use `profile.point(id)`.
References target the actual immutable model value: creating a later rotated or
repositioned model does not redirect existing sketch relations.

In the App, select the related value (`opening`) to edit against read-only model
outlines projected into the sketch's local plane. Select `profile` for its original
local view. Both edit the same source array, with ordinary undo; separate placements
of that geometry are not separate authoring definitions. Context outlines are
visual references only, not snapping targets or imported geometry constraints.
The select-surface-and-create UI is tracked separately within
[#114](https://github.com/vilicvane/code3d/issues/114).
Try [mounting-plate.ts](../app/examples/sketches/mounting-plate.ts).

## Cached computations and custom primitives

`cached(fn, options?)` memoizes synchronous, deterministic data computations.
Pass changing captured state as arguments and treat returned data as immutable.
Memory hits reuse the retained result; optional `encoder` / `decoder` pairs only
run when saving to disk or restoring it. The App fingerprints static definitions
and their dependencies for persistent reuse; dynamic closures and ordinary Node
calls use function identity for memory reuse. No author cache IDs are needed.

`definePrimitive(builder)` from `@code3d/core/replicad` also caches construction,
normalization and geometry analysis. Each call still creates fresh model metadata
and independently owned geometry handles. The builder transfers its returned
solid to Core and owns its intermediate resources. Screws uses this shared cache.
Read [cached computations](../web/src/content/docs/docs/reference/core.md#cached-computations)
and [custom primitives](../web/src/content/docs/docs/guides/custom-primitives.mdx)
for supported data, resource ownership and examples.

## Text and fonts

```ts
import {googleFont, text, extrude, group} from '@code3d/core';

const face = googleFont('Play');
export default group(extrude(text('Hello', face, 10), 1));
```

In the App, `googleFont()` uses a static family name and optional weight/italic
settings; `font()` accepts a static font-file URL or TTF/OTF bytes. The engine
prepares remote resources before synchronous model execution. Text returns
ordinary planar faces with a common baseline; `extrude(faces, distance)` preserves
their order and placement. Node can read local file URLs or use downloaded,
decoded font bytes. See the [text reference](../web/src/content/docs/docs/reference/core.md#text),
[runnable example](../app/examples/text.ts) and [font notices](THIRD_PARTY.md).

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

For changes to Core itself, start with the [modeling architecture](../../.agents/docs/architecture/modeling.md)
and shared [development guide](../../.agents/docs/development.md), then follow
the implementation and tests below.

- [Public exports](src/library/index.ts), [model runtime](src/library/runtime.ts),
  and [public type tests](test/public-types.ts).
- [Spatial values](src/library/spatial.ts), [relation solving](src/library/relation-solver.ts),
  and [topology](src/library/topology.ts).
- [Cached computations](src/library/cached.ts), [fonts](src/library/font.ts),
  [text geometry](src/library/text.ts) and their [tests](test/).
- [Material values](src/library/material.ts), [kernel cache](src/library/kernel-cache.ts),
  and [Node entry](src/node/index.ts).
- [Executable App examples](../app/examples/) and [runtime tests](test/).

Public JavaScript entries are prebundled ESM with shared chunks. Node, browser,
tooling and interop entries share the same kernel and cache instances. TypeScript
declarations, declaration maps and their sources remain available for editor
navigation. The build and npm `prepack` use the same package build script; see the
[development guide](../../.agents/docs/development.md#公开包产物) for installed
tarball verification and CI publishing.

For a standalone TypeScript project, include `ESNext` and `DOM` in `compilerOptions.lib`.
Use `module: "ESNext"` and `moduleResolution: "Bundler"` when esbuild or another
bundler handles execution. Code3D's App uses this resolution mode, supports
extensionless relative imports and selects browser package exports.
The public packages are built and verified with `skipLibCheck: false`. NodeNext
currently needs `skipLibCheck` because the `manifold-3d@3.0.1` declarations omit
relative `.js` extensions. Core includes the declaration dependencies needed by
its HarfBuzz and Replicad integrations.

From the repository root:

```sh
npm run build:packages
npm test --workspace @code3d/core
```

Use the [agent entry](../../docs/agents.md) to work on a project through the CLI,
or the [App README](../app/README.md) to develop the editor and visualization.
