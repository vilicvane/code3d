---
title: cut
description: Subtract one or more solid tools from a stock model.
sourceReview:
  packageVersion: 0.0.1-alpha.15
  sources:
    - path: packages/core/src/library/cut.ts
      sha256: 05f2020592e99732b41b638e1ad8caaa10a25437c6a1a9be93021a253f58e650
    - path: packages/core/src/library/runtime.ts
      sha256: 1caf8c92de983f0c22b4da70e0af4216472b9ff8fe8e2f0ebc34ec9a84e259b0
      commit: b4fe7de02f59acbd2614a592a4b8ce0586243b22
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

Selecting the tools array previews the consumed tools and their cut volume with
the stock in the background. In `blank.cut([box(...).relate(...)])`, selecting
`box` previews that constructor's result; it does not use the later related
tool's placement. Selecting the `box` dimensions still shows their measurements.
Similarly, selecting `tool` in `blank.cut([tool.relate(...)])` previews the
original tool in its local coordinates.
See [custom inspectors](inspectors.md) for inspection scope and fallback rules.

Boolean construction can fail on coincident or degenerate geometry. Avoid
removing the entire stock when subsequent operations require a nonempty solid.
Do not assume the output remains connected: a tool can split the stock into parts.
For adding volume see [union](union.md); for keeping shared volume see
[intersect](intersect.md).
