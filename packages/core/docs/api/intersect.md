---
title: intersect
description: Keep the solid volume shared by all operands.
sourceReview:
  packageVersion: 0.0.1-alpha.16
  sources:
    - path: packages/core/src/library/intersect.ts
      sha256: c7610a11c456cf6c1d15eaa03c7ebad5b72eea38a07e251823716ff8500bf640
    - path: packages/core/src/library/boolean-model.ts
      sha256: b905146426cbbfc467a67c8191a0e3f8b914b3ad3e82d67644503023d2f78013
    - path: packages/core/src/library/runtime.ts
      sha256: dcee3d2388a9b7b3819bb4897edd894463daa0e5b519e832a3349fac98c3bff8
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
    content: intersect — Code3D TypeScript API reference
---

Keep the solid volume shared by all operands.

## Example

```ts
import {box, intersect, sphere} from '@code3d/core';

const block = box(18, 12, 18);
const ball = sphere(11).originOffset(-7, 0, 0);
export const shared = intersect([block, ball]);
```

![Keep the solid volume shared by all operands.](../../../web/src/assets/models/solid-intersect.png)

Complete example: [solid operations](../../../app/examples/operations/solid-operations.ts).

## Signature

```ts
function intersect(operands: readonly SolidModel<{}>[]): SolidModel;

// SolidModel method:
solid.intersect(operands: SolidModel<{}> | readonly SolidModel<{}>[]): SolidModel;
```

Import the functions and named types from `@code3d/core`.

`block.intersect(ball)` and `block.intersect([ball])` are equivalent to
`intersect([block, ball])`. The method accepts one solid or a nonempty array of
additional solids, with the receiver as the first operand. The free function
continues to take an array containing all operands.

## Operands and result

The free function's `operands` array must contain at least two solid models. All inputs participate in the
same intersection: with three operands, only volume inside all three survives.
The result is not a list of pairwise intersections.

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

## A common volume is required

Disjoint solids, or solids touching only at a face, edge or point, have no common
solid volume. These cases throw a diagnostic rather than returning an empty model.
For more than two operands, overlap must survive each additional input.
Coincident or degenerate features can also prevent the kernel from completing
an intersection.

Use [cut](cut.md) to remove shared volume,
or [union](union.md) to keep every operand's volume. Select the operands argument
or the method receiver in the App to inspect the positioned inputs and
highlighted common region. An empty array of method operands throws.
