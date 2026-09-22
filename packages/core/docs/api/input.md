---
title: input
description: Declare a numeric model input with a default, optional bounds and control increments.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/input.ts
      sha256: 40f5d1c698e755c1b21e040a8ac4dd8942a69f93012cfdf5ac9c3156b935511e
      commit: 46c94b9c7709c93da17db39f12991e7a8b2fa8b0
sidebar:
  hidden: true
head:
  - tag: title
    content: input — Code3D TypeScript API reference
---

`input` reads a named numeric parameter for the current evaluation. Use its ordinary number in dimensions, branches, loops or reusable model functions.

## Example

```ts
import {box, input} from '@code3d/core';

const width = input('Width', 40, {min: 4, max: 100, step: 1});
const height = input('Height', 16, {min: 2, max: 60, step: 0.5});
export default box(width, height, 24);
```

Complete example: [App example](../../../app/examples/inputs.ts).

## Signature

```ts
input(name: string, defaultValue: number, options?: InputOptions): number;

type InputOptions = Readonly<{
  min?: number;
  max?: number;
  step?: number;
}>;
```

Import the functions and named types from `@code3d/core`.

## Arguments and validation

| Argument       | Meaning                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | Exact parameter identity and the App field label. It must contain at least one non-whitespace character. Names are case-sensitive and are not trimmed into a different identity. |
| `defaultValue` | Required finite number used when the host supplies no override, including standalone calls. Must be inside the declared bounds.                                                  |
| `options.min`  | Optional inclusive lower bound; finite when supplied.                                                                                                                            |
| `options.max`  | Optional inclusive upper bound; finite when supplied. If both bounds exist, `min < max` is required.                                                                             |
| `options.step` | Optional finite, strictly positive increment for host controls. The Core reader validates bounds but does not round or quantize the returned number.                             |

Supplied values must also be finite and in range. Invalid declarations or values
throw an error. Within one hosted evaluation, calls with the same exact name
share a value and must agree on the default and all three options. Conflicting
declarations throw even if the current value would satisfy both ranges.

## Evaluation and the App

The returned value is fixed for one evaluation; it is not a writable state object.
The App supplies new values by evaluating the model again. Only calls actually
reached during evaluation register fields; inputs in skipped branches do not.
Standalone calls return their defaults and do not create a user interface.

In the App, both bounds enable a slider. Numeric controls use `step` relative to
`min`, or the default when no minimum exists; choose a default on that grid.
See the [input workflow](../runtime.md#numeric-inputs) for live editing, invalid
text, reset, source selection and the lifetime of session overrides.

## Caching and related APIs

Read an input before a [cached computation](cache.md) and pass it as an argument.
A cache hit skips the computation body, so reading inputs only inside that body
can miss both the new value and field registration.

```ts
import {cache, input} from '@code3d/core';

const width = input('Width', 40);
const dimensions = cache((value: number) => [value, value / 2], [width]);
```

Use [timeOffset](time-offset.md) for playback time. Hosts establish the input
scope with `beginModelInputs` from `@code3d/core/tooling`; ordinary models do not
manage that scope themselves. String, boolean and selection-list inputs are
not part of this API.
