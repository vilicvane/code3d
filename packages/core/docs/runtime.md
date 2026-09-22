---
title: Runtime and integration
description: Cache computations, integrate native materials and embed the modeling runtime.
sidebar:
  order: 11
---

## Numeric inputs

[input](api/input.md) declares a named numeric parameter and returns an
ordinary number. The App discovers calls during evaluation and displays their
names and values in **Inputs**. Typing a valid value or dragging a slider updates
the model immediately, while the field stays focused or the pointer stays down.
**Reset** restores the source defaults and updates the model.

```ts
import {box, input} from '@code3d/core';

const width = input('Width', 40, {min: 4, max: 100, step: 1});
const height = input('Height', 16, {min: 2, max: 60, step: 0.5});
export default box(width, height, 24);
```

Names must be non-empty, and defaults and values must be finite numbers. Calls
with the same name share one field and must agree on their default, range and step. Branches,
loops and imported project functions can use the returned number normally;
each evaluation and its source inspection use the same supplied values.
Outside a host evaluation, the function returns its required default.

The optional third argument accepts `min`, `max` and `step`. Bounds must be
finite, `min` must be less than `max`, and `step` must be a finite positive number.
Defaults and supplied values must stay within the declared bounds. `step` sets
the increment for numeric controls and the slider; without it, arbitrary decimal
values are accepted. Numeric form values follow the declared step, based on
`min` when present or the default otherwise. Choose a default on that step.
Providing both bounds displays a slider. The slider and numeric field stay in sync
and preview valid changes throughout the drag. Model evaluations run one at a
time; changes made while one is running are combined into the latest next values.
Empty, unfinished or invalid text stays in the field while the model keeps its
last valid value. Other valid fields can still update the model.

Place the editor caret inside an evaluated input call to expand **Inputs** and
highlight its value. Press Tab to focus that numeric field and select its text;
further Tab / Shift+Tab moves between form controls. Source matching follows
actual calls, including aliased imports and repeated calls with the same name.

Values are local to the current file session: editing that file keeps overrides,
while switching files or reloading the App clears them. An untouched field follows
changes to its source default. The form does not rewrite source. Focus a field
to pause playback; unfinished text and focus survive model frames. `timeOffset()` remains
a separate playback function. Text, boolean and option-list fields are not yet
supported.

Read inputs outside `cache()` and pass their values as explicit arguments when a
cached result depends on them. Only calls reached during evaluation appear in
the form. Try the [numeric inputs example](../../app/examples/inputs.ts).
The [robot arm example](../../app/examples/assemblies/robot-arm.ts) combines five
inputs with nested joint frames to move a complete arm and its gripper. Its
links have actual hinge bores and alternate between two depth layers to leave
clearance while bending.

## Time offset

[timeOffset](api/time-offset.md) returns the offset from the playback origin in
seconds, not the current clock time. In the App, the offset starts at zero and
the playback controls advance it. Each execution receives one fixed value, so
branches, loops and imported project functions can use time just like any other
number. Outside a host evaluation, the function returns `defaultValue`, which must be finite.

```ts
import {timeOffset, rotate} from '@code3d/core';

const time = timeOffset();
const angle = (time * 60) % 360;
// Use rotate(0, angle, 0) after the constraints in a relate callback.
```

Open the [rotating arm example](../../app/examples/constraints/animation.ts),
select its final group, and use **Play**, **Pause**, and **Reset** below the
viewport. Reset returns to zero and stays paused. Editing source pauses at the
last accepted time; changing files starts again at zero. Moving the source
selection or hiding the page pauses playback. Time is session-local and does
not modify source files.

The App re-executes the complete compiled project for each frame and reuses
geometry caches. Playback follows elapsed time; expensive models produce fewer
frames, with no backlog of frame requests. Read time outside `cache()` and pass
it as an explicit argument to a cached computation whose result depends on it.

This dedicated function provides explicitly parameterized motion; writable
persistent state, solver history, timeline seeking and video export are not
part of this API. Define periodic motion with ordinary expressions such as `%`
or `Math.sin`.

## Cached computations and custom primitives

[cache](api/cache.md) documents invocation forms, supported data, custom codecs,
identity and persistence. Read changing inputs and time before entering a cached
computation and pass them as explicit arguments. The App cache settings control
disk admission and storage budgets.

`definePrimitive(builder)` from `@code3d/core/replicad` also caches construction,
normalization and geometry analysis. Each call still creates fresh model metadata
and independently owned geometry handles. The builder transfers its returned
solid to Core and owns its intermediate resources. Screws uses this shared cache.
Read [cached computations](api.md#cached-computations)
and [custom primitives](custom-primitives.mdx)
for supported data, resource ownership and examples.

## Materials and entry points

`.material()` accepts a color or a native Three.js material. Use
`@code3d/core/three` when constructing native materials, and
[@code3d/materials](../../materials/README.md) for common presets. A model captures
its material value; changing the original Three.js object later does not change
that model. The renderer supplies lighting and environment reflections.

| Import                  | Responsibility                                                           |
| ----------------------- | ------------------------------------------------------------------------ |
| `@code3d/core`          | Public model authoring API; Node entry initializes the kernel            |
| `@code3d/core/three`    | Shared Three.js exports for material and geometry integration            |
| `@code3d/core/replicad` | Replicad access for custom primitive builders                            |
| `@code3d/core/tooling`  | Evaluation, inspection and resource lifetime integration used by the App |

Tooling integrations own evaluation lifetimes and disposal. Follow the existing
[tooling entry](../src/tooling/index.ts), [evaluation tests](../test/model-test.ts), and
[App compiler](../../app/src/model/compiler.ts) when embedding the runtime. Ordinary
model files should stay on the authoring API.

## Source inspection

[Custom inspectors and call data](api/inspectors.md) is the primary reference
for parameter, call, getter and closure inspection, all context types, scene
ownership, error behavior and focus identities. Use
[inspectGroupMembers](api/inspect-group-members.md) for derived arrays and
[annotations](api/annotations.md) for passive dimensions, bounds and directions.

### Getter inspection

See [getter inspection](api/inspectors.md#getter-inspection) for recorded property
reads and published callbacks.

### Call data

See [call data](api/inspectors.md#call-data) for `captureInspectData`, invocation
lifetimes, error paths and the scalar measurement example.

## Source and development

For changes to Core itself, start with the [modeling architecture](../../../.agents/docs/architecture/modeling.md)
and shared [development guide](../../../.agents/docs/development.md), then follow
the implementation and tests below.

- [Public exports](../src/library/index.ts), [model runtime](../src/library/runtime.ts),
  and [public type tests](../test/public-types.ts).
- [Spatial values](../src/library/spatial.ts), [relation solving](../src/library/relation-solver.ts),
  and [topology](../src/library/topology.ts).
- [Cached computations](../src/library/cached.ts), [fonts](../src/library/font.ts),
  [text geometry](../src/library/text-geometry.ts) and their [tests](../test).
- [Material values](../src/library/material.ts), [kernel cache](../src/library/kernel-cache.ts),
  and [Node entry](../src/node/index.ts).
- [Executable App examples](../../app/examples) and [runtime tests](../test).

Public JavaScript entries are prebundled ESM with shared chunks. Node, browser,
tooling and interop entries share the same kernel and cache instances. TypeScript
declarations, declaration maps and their sources remain available for editor
navigation. The build and npm `prepack` use the same package build script; see the
[development guide](../../../.agents/docs/development.md#公开包产物) for installed
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

Use the [agent entry](../../../docs/agents.md) to work on a project through the CLI,
or the [App README](../../app/README.md) to develop the editor and visualization.
