---
title: inspectGroupMembers
description: Preview derived group members at solved positions while preserving source input focus identities.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/group.ts
      sha256: 25a7f74c0998170569a75f520c6b28d0be85ffc4e5797419ca8067a30163a4e8
      commit: 757c8003e4ef2c3e4b4e85561e186a82a1dd1c39
    - path: packages/core/src/library/inspect.ts
      sha256: 41c720ebec3e0ebe941a3b6e7c18f0db08badec6e95021d5e29c59d88c13b5a8
      commit: 257dac61457d3ec723fd8054ebcb2e12daceba85
    - path: packages/core/src/library/runtime.ts
      sha256: e3658b0ffa55da9d2c612f442ce1d5f190923aea1870122823677faa60fb0b84
      commit: 3d2db0c82c1ae0e6723ecd77fa6f571b326d1681
sidebar:
  hidden: true
head:
  - tag: title
    content: inspectGroupMembers — Code3D TypeScript API reference
---

`inspectGroupMembers` helps a custom inspector display an array of derived models in a shared solved frame while focusing the corresponding authored inputs.

## Example

```ts
import {
  box,
  inspectGroupMembers,
  offset,
  type InspectContext,
  type InspectResult,
  type Model,
} from '@code3d/core';

/** @code3d.inspect models spread.inspect */
export function spread(models: readonly Model[]): readonly Model[] {
  return models.map((model, index) =>
    model.relate(() => offset(index * 20, 0, 0)),
  );
}
export namespace spread {
  export function inspect(
    [models]: [readonly Model[]],
    context: InspectContext<readonly Model[]>,
  ): InspectResult | undefined {
    return context.return && inspectGroupMembers(context.return, models);
  }
}
export const parts = spread([box(8, 8, 8), box(8, 12, 8)]);
```

## Signature

```ts
inspectGroupMembers(
  children: readonly Model[],
  inputs: readonly Model[],
): InspectResult;
```

Import the functions and named types from `@code3d/core`.

## Pairing and placement

`children` are the result models to display. The helper constructs a group,
solves the members in that composition, and returns its inspection scene.
`inputs[index]` supplies the focus identity for `children[index]`. Supply arrays
with equal lengths and the same correspondence; the helper does not match by
name, geometry or node ID and does not validate a custom pairing for you.

The result is an [InspectResult](inspectors.md#inspection-types), usually with
positioned model targets. Use it from an inspector, not as the exported CAD
result: it is preview data rather than a group model. Construct [group](group.md)
explicitly when the modeling function should return a group.

When inspecting the source input parameter, pass the original inputs. When
inspecting the returned collection itself, pass `inspectGroupMembers(result,
result)` so selection follows the returned identities. This affects emphasis,
not the geometric placement. The viewport does not add original input geometry
to the scene automatically.

Generated members retain their actual solved placement. Keeping original source
identities lets selecting one array member emphasize its corresponding result
without showing an extra copy at the input's former position. The same rule
applies to transformed copies; a newly constructed unrelated shape does not
inherit focus unless the inspector intentionally pairs it.

## Related APIs

[Custom inspectors](inspectors.md) defines parameter/call precedence, focused
values and callback context. [group](group.md) describes composition frames and
[relate](relate.md) describes placement of new model values.
