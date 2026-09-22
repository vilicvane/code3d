---
title: cut
description: Subtract one or more solid tools from a stock model.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/cut.ts
      sha256: f8844c1c290abf1ac97673f782e9c25a39403332382f107f2a718aaf578000b7
      commit: bb707e248ef98fe97db48020a396fd20bf3265ec
    - path: packages/core/src/library/runtime.ts
      sha256: e3658b0ffa55da9d2c612f442ce1d5f190923aea1870122823677faa60fb0b84
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
    content: cut — Code3D TypeScript API reference
---

Subtract one or more solid tools from a stock model.

## Example

```ts
import {box, cylinder, cut} from '@code3d/core';

const blank = box(30, 8, 20);
const drill = cylinder(4, 12);
export const drilled = cut(blank, [drill]);
```

![Subtract one or more solid tools from a stock model.](../../../web/src/assets/models/solid-cut.png)

Complete example: [solid operations](../../../app/examples/operations/solid-operations.ts).

## Signature

```ts
function cut(
  stock: SolidModel<{}>,
  tools: readonly SolidModel<{}>[],
): SolidModel;
// Equivalent method:
stock.cut(tools);
```

Import the functions and named types from `@code3d/core`.

## Parameters and result

| Parameter | Meaning                                                |
| --------- | ------------------------------------------------------ |
| `stock`   | Solid model whose volume is retained outside the tools |
| `tools`   | Nonempty readonly array of solid models to subtract    |

All tools must be solids. Empty tool arrays throw. Tools may extend outside the
stock; only their overlap removes material. A tool that does not overlap removes
nothing. The example drills through the full height and leaves volume
`4800 - 128 * Math.PI`.

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

## Using the result

`blank.cut([drill])` has the same modeling behavior as the free function. Neither
form changes the blank or drill. Keep tool definitions available if you need to
change the cut later; they are not exposed as named members on the result.

Boolean construction can fail on coincident or degenerate geometry. Avoid
removing the entire stock when subsequent operations require a nonempty solid.
Do not assume the output remains connected: a tool can split the stock into parts.
For adding volume see [union](union.md); for keeping shared volume see
[intersect](intersect.md).
