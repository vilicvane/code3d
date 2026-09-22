---
title: union
description: Fuse two or more solid models, including their solved placements.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/union.ts
      sha256: dd71a24f65badfcffdd63a2be2d9a5c426f3f2ce7acb32b1235433124e20389c
    - path: packages/core/src/library/boolean-model.ts
      sha256: 18916d45eb837447a6b92b876fb045a6da7f00f8a7056071fc6e908b851e97f6
    - path: packages/core/src/library/runtime.ts
      sha256: 200191b28c2ae7fef5793ce7e9a330476b23a0783f571225930ac52badb2ec04
    - path: packages/core/src/library/topology.ts
      sha256: f9f0d048fe30cc80046a25123aa8101ca51e85cdb5b2e66260c6a68f43f84715
      commit: 67228dd8559d584852df7bfbd47ed89f1d8003e9
    - path: packages/core/src/library/topology-id.ts
      sha256: 49b2812aa89e5a886759166c89e32cf01a629fe888bcc57452ede2feeba7dc01
      commit: 904463d8c4405f4a2b1c073ba9a5edc997732e23
sidebar:
  hidden: true
head:
  - tag: title
    content: union — Code3D TypeScript API reference
---

Fuse two or more solid models, including their solved placements.

## Example

```ts
import {box, cylinder, union} from '@code3d/core';

const base = box(30, 8, 20);
const boss = cylinder(5, 10).originOffset(0, -7, 0);
export const joined = union([base, boss]);
```

![Fuse two or more solid models, including their solved placements.](../../../web/src/assets/models/solid-operations.png)

Complete example: [solid operations](../../../app/examples/operations/solid-operations.ts).

## Signature

```ts
function union(operands: readonly SolidModel<{}>[]): SolidModel;
```

Import the functions and named types from `@code3d/core`.

## Operands and result

`operands` must contain at least two solid models. Groups, faces, curves and points
are rejected. The result contains the combined volume with shared volume counted
once. For the example, the boss overlaps the base by 2 units and the total volume
is `4800 + 200 * Math.PI`.

The inputs are immutable. Relations between operands are solved together before
geometry is combined. The result retains the first input's local frame,
placement, material and origin; for `cut`, that input is the stock. The result
is a new `SolidModel` with canonical references, not a group with named members.
Use [group](../api.md#composition-and-boolean-operations) to retain separate parts.

Input arrays describe one operation. They do not apply the operation independently
to each element. Topology inherited one-to-one from an input is prefixed by its
one-based operand position, for example `[1, 4]`; split, merged and newly generated
topology receives new IDs. Inspect the result before using its edge or surface IDs
in a later operation. See [topology IDs](../topology.md#ids-belong-to-a-model).

## Connectivity and limits

Separated operands can produce one model containing several disconnected solids.
The return type does not guarantee a connected body: [shell](shell.md) requires
one connected solid. Arrange operands with a genuine shared volume when building
a single body. Coincident, tangent or very small features can make kernel boolean
operations fail; adjust the placement or dimensions when construction fails.

The free function is the public union entry; there is no `model.union()` method.
For material removal use [cut](cut.md), or retain only the shared volume with
[intersect](intersect.md).
