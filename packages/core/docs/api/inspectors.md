---
title: Custom inspectors and call data
description: Describe source-selection previews, capture call-time facts and implement typed parameter, getter and closure inspectors.
sourceReview:
  packageVersion: 0.0.1-alpha.15
  sources:
    - path: packages/app/src/model/inspection.ts
      sha256: d7ade31710cad6fbd81b92a3c461d7d9b27c096b39d8f1ea35e561142a8c7ea2
    - path: packages/core/src/library/inspect.ts
      sha256: 3a2b79225efc60bde43e1ed6b7fead901376689b03a190bf5884920d8c5bb870
    - path: packages/core/src/library/group.ts
      sha256: c9592b8f7ed218c81a147f1a5102592cd8b21cde0953bf0178ea0b848e0952a6
      commit: b4fe7de02f59acbd2614a592a4b8ce0586243b22
sidebar:
  hidden: true
head:
  - tag: title
    content: Custom inspectors and call data — Code3D TypeScript API reference
---

Custom inspectors choose the complete preview scene for an evaluated call or callback. `captureInspectData` records call-time facts without changing the function's normal return value.

## Example

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

## Signature

```ts
captureInspectData(data: unknown): void;

type Inspector<
  Args extends readonly unknown[] = readonly unknown[],
  Return = unknown, Receiver = unknown, Data = unknown,
> = (
  args: Args,
  context: InspectContext<Return, Receiver, Data>,
) => InspectResult | undefined;
```

Import the functions and named types from `@code3d/core`.

Ordinary expression values preview directly, including models, anchors and collections.
Model values retain their authored material opacity: an opaque color stays opaque,
explicit alpha stays unchanged, and unstyled surfaces keep the default translucency.
This also applies to ordinary call results and parameter fallbacks. Inspection
scenes apply the target/focused/ambient opacity limits; an anchor's owner remains
context behind the reference in both kinds of preview.
Use `@code3d.inspect parameter callback` when a parameter needs additional context;
use `@code3d.inspect callback` for an exceptional call-result view. A parameter
first tries its parameter inspector, then the call inspector, then the ordinary
call result. A method receiver keeps its selected value as the default preview.
An enclosing inspector may describe an inner value; if it declines, it cannot
replace that value's default preview with the enclosing call's result.
A declared closure body has its own scope: declining it preserves the selected
value and continues outward without re-entering that same call's parameter or
call inspector. The callback
receives the original argument tuple and `InspectContext`; method receivers are
in `context.receiver`. Its `target` and `ambient` arrays own the complete scene.
An empty argument list or a trailing comma selects the next parameter slot,
including after spread arguments. Its `focused.parameter` identifies that
parameter, while `focused.value` is `undefined` and `focused.values` is empty.
The original argument tuple stays unchanged; inspectors obtain effective
runtime defaults from the returned model or captured call data.
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
The cut tool inspector accepts a selection only when every preview value is an
actual tool passed to that invocation. Upstream constructors and receivers, such
as `box(...)` or `tool` in `tool.relate(...)`, keep their ordinary preview instead
of borrowing the consumed tool's solved placement.
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

## Getter inspection

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

## Call data

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
`InspectContext<Return, Receiver, Data>` describes the inspected call's return
value, receiver and recorded data. The scalar query example above retains its
bounds for that purpose.

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

## Inspection types

Inspectors are synchronous. Return an `InspectResult` object or `undefined`;
Promise-like results, `null` and scalar results are rejected by the host.

`PreviewValue` is `Model | Anchor | Sketch | SketchPoint | Dimension |
BoundsAnnotation | AnchorAnnotation`. Numeric and string results are not geometry;
use an annotation to display a measured scalar. See [annotations](annotations.md)
for the passive values, and [inspectGroupMembers](inspect-group-members.md) for
positioned arrays.

`InspectResult` has optional readonly `target`, `ambient` and `focused` arrays of
`PreviewValue`. Target and ambient define the complete scene; focused chooses
which target identities receive emphasis. An empty result intentionally clears
the scene; `undefined` declines and allows the enclosing inspection to proceed.

`Inspector<Args, Return, Receiver, Data>` takes the original argument tuple and
`InspectContext<Return, Receiver, Data>`, returning `InspectResult | undefined`.
The defaults are `readonly unknown[]` for `Args` and `unknown` for other generics.

| InspectContext field | Meaning                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `receiver`           | Actual method/getter receiver, or the recorded call's receiver.        |
| `return`             | Recorded `Return` value, or `undefined` when the invoked call threw.   |
| `data`               | Last `captureInspectData` payload from that invocation.                |
| `closure?`           | Enclosing declared callback execution and lazily provided context.     |
| `focused.value`      | Selected expression's raw value.                                       |
| `focused.parameter`  | Selected parameter name, or `undefined`.                               |
| `focused.path`       | Readonly string/number path through a selected property or collection. |
| `focused.values`     | Previewable values corresponding to the actual source selection.       |
| `focused.solids`     | Selected `SolidModel<{}>` values.                                      |
| `focused.insertion?` | Absolute placement-prefix count at a relate-array gap.                 |

## Closure and call records

`InspectCall` contains `receiver`, readonly `arguments`, `return`, and `data`,
each raw value typed as `unknown` (arguments are `readonly unknown[]`).
`InspectClosureExecution` contains the callback's readonly `arguments`, its
`return`, the owning `call: InspectCall`, and optional `parent: InspectClosure`.
The owning call's data is separate from the callback's result.

`InspectContextFactory<Data = unknown>` is `(execution:
InspectClosureExecution) => Data`. `InspectClosure` extends that execution with
optional `provider: InspectContextFactory` and its produced `data: unknown`.
Context providers execute lazily once per actual callback execution; `parent`
lets nested inspectors read enclosing contexts. Runtime records belong to one
evaluation and must not be reused as persistent model state.
