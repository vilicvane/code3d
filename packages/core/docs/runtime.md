---
title: Runtime and integration
description: Cache computations, integrate native materials and embed the modeling runtime.
sidebar:
  order: 11
---

## Numeric inputs

`input(name, defaultValue, options?)` declares a named numeric parameter and returns an
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

`timeOffset(defaultValue = 0)` returns the offset from the playback origin in
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

`cache(fn)` memoizes synchronous, deterministic data computations;
`cache(fn, args)` immediately returns the cached result for an argument tuple.
Both forms share the same function identity and argument keys. Supply custom
codecs in the third argument: `cache(fn, undefined, options)` for a function or
`cache(fn, args, options)` for a value.
Pass changing captured state as arguments and treat returned data as immutable.
Memory hits reuse the retained result; optional `encoder` / `decoder` pairs only
run when saving to disk or restoring it. Newly computed entries are eligible
for disk storage when computation reaches the configured threshold (1 ms by
default). Faster results remain in memory and are not encoded or written on later
memory hits. Change the threshold in **Settings → Cache** in the App; it applies
to new computations and preserves existing cache entries. Existing
disk records can still be restored. The App fingerprints static definitions
and their dependencies for persistent reuse; dynamic closures and ordinary Node
calls use function identity for memory reuse. No author cache IDs are needed.

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

Ordinary expression values preview directly, including models, anchors and collections.
Model values retain their authored material opacity: an opaque color stays opaque,
explicit alpha stays unchanged, and unstyled surfaces keep the default translucency.
This also applies to ordinary call results and parameter fallbacks. Inspection
scenes apply the target/focused/ambient opacity limits; an anchor's owner remains
context behind the reference in both kinds of preview.
Use `@code3d.inspect parameter callback` when a parameter needs additional context;
use `@code3d.inspect callback` for an exceptional call-result view. A parameter
first tries its parameter inspector, then the call inspector, then the ordinary
call result. A declared closure body has its own scope: declining it continues
outward without re-entering that same call's parameter or call inspector. The callback
receives the original argument tuple and `InspectContext`; method receivers are
in `context.receiver`. Its `target` and `ambient` arrays own the complete scene.
Returning `undefined` declines the scope; returning `{}` intentionally displays
an empty scene. Target values matching `context.focused.values` receive focus
by default; generated geometry does not inherit focus from its inputs. An
inspector can return `focused` to explicitly select target identities for emphasis.
For example, the `on` and `align` call inspectors focus the current self and its
reference, while their parameter inspectors retain the actual source selection.
This changes emphasis only; `target` and `ambient` still define the scene.

For a function that returns related copies of input models,
`inspectGroupMembers(result, inputs)` from `@code3d/core` renders each result
in the solved group frame and keeps its corresponding input as the focus
identity. This gives array member selection the same positioned, per-member
highlighting as the `group()` parameter inspector. Use the input array when
`context.focused.parameter` identifies that argument; when inspecting the
returned collection itself, use `inspectGroupMembers(result, result)` so its
members keep their result identities. The viewport does not add the current
execution's original inputs to this scene.

Selecting an array member focuses that value while keeping the other inspection
targets visible at a weaker level; selecting the whole array focuses its members.
For cut tools and intersect operands, selected inputs are targets and other inputs
are ambient. The generated cut volume (orange) or intersection (cyan) is a separate
target, including when inspecting a single input. A failed intersection still
shows the selected inputs and ambient operands without inventing a result.
These region inspectors use ordinary unlit materials with depth testing disabled,
so their colors remain visible through the translucent inputs.

Core uses this mechanism for length/area/volume properties, distance measurements, relate calls and their
closures, on/align references, relative transformation stages, group children,
expose sources, Boolean operands, loft sections/spines and sweep profiles/spines, plus box and extrusion
dimensions. Selecting a normal constructor or Boolean function name
still previews its return value. Inspectors retain the original operation frame,
so a later relation or a different consumer cannot move its inspection.

A closure can independently declare a context factory with
`@code3d.inspect.context parameter callback` and a renderer with
`@code3d.inspect.closure parameter callback`. Context factories run lazily once
per actual execution. Inner inspectors can read `context.closure.data` and its
parent contexts regardless of which renderer is selected. The first non-undefined
inspector wins, searching from the selected expression outward.

For relate, context includes only actual consumed relation participants. Unrelated
values use ordinary preview. A collection is handled only when every member is
related; mixed collections fall through as a whole, preserving every previewable
member. Selecting an individual member tests that member independently.
Relative transformation functions and pivot/axis chains share a call inspector:
numeric and reference arguments inspect the consumed relation stage. Unconsumed
chains do not invent a stage. The tool can edit an ambient participant without
promoting its display tier.

Topology accessors (`vertex`, `edge`, `surface` and their plural forms) keep
ordinary anchor preview when they return references. Their inspector returns
the owner as `ambient` when the call fails or the reference collection is empty.
The owner therefore has the same background appearance before and after a
selection; missing or invalid IDs still produce their normal modeling errors.

### Getter inspection

A getter can declare `@code3d.inspect callback` in its JSDoc. A package can put
the same annotation on its public `readonly` property declaration when the
implementation getter is not present in its declarations. The callback receives
`[]`, with the actual receiver in `context.receiver`, the recorded property value
in `context.return`, and any `captureInspectData` payload in `context.data`.

```ts
import {
  captureInspectData,
  type InspectContext,
  type Model,
} from '@code3d/core';

function inspectSize(_args: readonly [], context: InspectContext<number>) {
  return {target: [context.data as Model]};
}
class Part {
  constructor(readonly body: Model) {}
  /** @code3d.inspect inspectSize */
  get size() {
    captureInspectData(this.body);
    return 42;
  }
}
```

Read `part.size` normally to record it. Selecting the property runs only its
inspector; it never runs the getter again. Each reached read keeps its own
receiver, return and data, even if several reads return the same number. Local
getters retain their declaration's lexical inspector binding; published callbacks
must be runtime exports of the package. Optional reads that short-circuit do not
invoke an inspector. A failed getter can still inspect its captured data, with
`context.return` undefined. Merely enumerating an object never invokes its getters.

Core's `.length`, `.area` and `.volume` use this mechanism. Passive `dimension` annotations
accept either `start`/`end`, alternative `candidates`, or `at: [x, y, z]` to show
only a value at an owner's local position. Labels do not add CAD geometry.

### Call data

The App runs JSDoc inspection callbacks when the corresponding source is selected.
Callbacks return `target` and `ambient` preview values. The viewport retains its
previous scene until the new inspection is ready; an inspection error preserves
that scene and is reported separately from model evaluation errors.

Models, anchors, sketches, sketch points and passive annotations share this scene.
Sketches show their points and curves at their actual 3D placement, including open
curves, inherited layers and multiple noncoplanar sketches. They do not need to
form a face. The App's **Edit sketch** tool opens the selected authored sketch in
its 2D plane; **Finish sketch** returns to the 3D preview. Inspection callbacks
control passive appearance; editing and selection remain tool responsibilities.

Use `captureInspectData(data)` inside a modeling function to retain facts from
that invocation for its inspector. The function keeps its ordinary return type.
`InspectContext<Return, Receiver, Data>` describes the callback's return value,
receiver and recorded data. For example, a scalar query can retain its bounds:

```ts
import {
  captureInspectData,
  dimension,
  type InspectContext,
  type InspectResult,
  type Model,
  type Vec3,
} from '@code3d/core';

type SpanData = {owner: Model; minimum: Vec3; maximum: Vec3};

/** @code3d.inspect spanX.inspect */
export function spanX(owner: Model): number {
  const {minimum, maximum} = owner.bounds();
  captureInspectData({owner, minimum, maximum} satisfies SpanData);
  return maximum[0] - minimum[0];
}

/** @internal */
export namespace spanX {
  export function inspect(
    _args: [Model],
    context: InspectContext<number, unknown, SpanData | undefined>,
  ): InspectResult | undefined {
    const data = context.data;
    if (!data || context.return === undefined) return undefined;
    return {
      target: [
        data.owner,
        dimension({
          owner: data.owner,
          start: data.minimum,
          end: [data.maximum[0], data.minimum[1], data.minimum[2]],
          value: context.return,
        }),
      ],
    };
  }
}
```

Data belongs to the actual call, including nested calls with equal return values.
Without a record, `context.data` is `undefined`; multiple records in one call use
the last value. Closure context factories can read their owning call's data from
`execution.call.data`. The executor retains references without cloning them, so
capture immutable facts when later changes must not alter the inspection.
Inspectors do not run the modeling function again.

A modeling function that throws can still be inspected if it was actually invoked.
Its original evaluated arguments and last captured data remain available, with
`context.return === undefined`. Argument evaluation failures and optional-chain
short circuits do not create an invocation of the outer function. Entered closure
callbacks follow the same rule. The original modeling diagnostic remains separate
from any inspection error; inspectors decide what to render when no result exists.

Without an inspection recording session, `captureInspectData` does nothing.
Calls from an inspector also do not overwrite modeling records. Published
callbacks use normal runtime exports; `@internal` with TypeScript's
`stripInternal` can hide their declarations while keeping those exports.

A dimension can provide fixed `start`/`end` points or a nonempty `candidates` list.
The owner can be a model or an independent `Frame`; a dimension does not require
finite owner geometry. All points use the owner's local frame. For candidates, the renderer picks the
nearest segment when inspection begins, then retains it while orbiting or
rechecking the same parameter. Leaving that inspection resets the choice.
Both forms show a number, endpoint ticks and a screen-sized dashed line.

```ts
import {dimension, type Model} from '@code3d/core';

function showLength(owner: Model) {
  return {
    target: [
      owner,
      dimension({
        owner,
        value: 10,
        candidates: [
          {start: [-5, -2, -3], end: [5, -2, -3]},
          {start: [-5, 2, 3], end: [5, 2, 3]},
        ],
      }),
    ],
  };
}
```

`boundsAnnotation` represents a finite range without adding CAD geometry. Its
`frame` is relative to `owner`, centered on the box; `size` measures its three
local axes. The App draws the existing bounds corners at a fixed screen width.
It can represent the exact support range of an `on` relation, including flat or
linear ranges, instead of substituting the whole owner's bounding box.

```ts
import {boundsAnnotation, type Model} from '@code3d/core';

function showRange(owner: Model) {
  return {
    target: [
      owner,
      boundsAnnotation({
        owner,
        size: [20, 10, 5],
        frame: {position: [0, 0, 0], quaternion: [0, 0, 0, 1]},
      }),
    ],
  };
}
```

Use `anchorAnnotation(reference, {direction})` to choose `'none'`, `'forward'`
or `'both'` for direction arrows while keeping the reference's geometry and
placement. For curves, arrows follow the real endpoint tangents; reversing the
reference reverses its authored direction. The annotation retains the reference's
focus identity. Returning an ordinary Anchor keeps its default object preview.

```ts
import {anchorAnnotation, type SolidModel} from '@code3d/core';

function showAxis(owner: SolidModel) {
  return {
    ambient: [owner],
    target: [anchorAnnotation(owner.axis, {direction: 'forward'})],
  };
}
```

## Source and development

For changes to Core itself, start with the [modeling architecture](../../../.agents/docs/architecture/modeling.md)
and shared [development guide](../../../.agents/docs/development.md), then follow
the implementation and tests below.

- [Public exports](../src/library/index.ts), [model runtime](../src/library/runtime.ts),
  and [public type tests](../test/public-types.ts).
- [Spatial values](../src/library/spatial.ts), [relation solving](../src/library/relation-solver.ts),
  and [topology](../src/library/topology.ts).
- [Cached computations](../src/library/cached.ts), [fonts](../src/library/font.ts),
  [text geometry](../src/library/text.ts) and their [tests](../test).
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
