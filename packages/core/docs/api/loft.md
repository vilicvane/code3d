---
title: loft
description: 'Code3D loft API: Build one solid through an ordered sequence of planar sections. Learn parameters, coordinates, results and limits.'
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/loft.ts
      sha256: b78323b2ca2b36bad6eab2136ad48cd152f8c081cc923158e2567cebb0b1b1d7
      commit: 2e2cf49d64dba98b613224b6ae39aa632d6d2eb0
    - path: packages/core/src/library/runtime.ts
      sha256: 200191b28c2ae7fef5793ce7e9a330476b23a0783f571225930ac52badb2ec04
    - path: packages/core/src/library/loft-geometry.ts
      sha256: a81b93e09d813b409fcb02a57fd3a81f0f79113b970d697327e7760eeac985a8
      commit: 2e2cf49d64dba98b613224b6ae39aa632d6d2eb0
sidebar:
  hidden: true
head:
  - tag: title
    content: loft — Code3D TypeScript API reference
---

Build one solid through an ordered sequence of planar sections. A loft can change the profile shape, size, position and orientation along its length.

## Example

```ts
import {circle, loft, rectangle} from '@code3d/core';

const lower = circle(6);
const upper = rectangle(8, 6).originOffset(0, -12, 0);
export const transition = loft([lower, upper]);
```

![A circle-to-rectangle solid transition over a height of 12.](../../../web/src/assets/models/shaping-loft.png)

Complete example: [shape construction](../../../app/examples/operations/shape-construction.ts).

## Signature

```ts
function loft(
  sections: readonly FaceModel<{}>[],
  options?: LoftOptions,
): SolidModel;
type LoftOptions = Readonly<{spine?: EdgeModel<{}>; ruled?: boolean}>;
```

Import the functions and named types from `@code3d/core`.

## Parameters and options

| Input           | Meaning                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| `sections`      | At least two planar filled face models, in loft order                                      |
| `options.spine` | Optional curve guiding how the sections are associated along a path                        |
| `options.ruled` | Defaults to `false`; without a spine, use ruled rather than smooth transitions when `true` |

With a spine, the pipe-shell construction follows that spine; `ruled` does not
alter this branch. There is no equivalent `face.loft()` method.

The example joins a radius-6 circular face at Y = 0 to an 8-by-6 rectangular face
at Y = 12. Profiles need not have identical outlines or lie in parallel planes.
Their actual positions and orientations are inputs, not merely a list of shapes
to be automatically stacked. See the [bent three-section example](../../../app/examples/operations/loft.ts).

## Coordinates, holes and topology

All sections and the optional spine participate in the same placement solve.
The result inherits the **first section's** local frame and placement; reordering
sections can therefore change the result coordinates as well as the loft path.

Sections must have matching hole counts. Zero or one hole per section is supported;
multiple holes require explicit contour correspondence that is not exposed here.
The operation closes the end sections to produce a solid. Generated topology
retains available section provenance; inspect the result instead of assuming
that its surface numbering matches one input. See [topology selection](../topology.md).

## Validation and inspection

Fewer than two sections report `loft requires at least two planar sections.`
Each section must be a face model; a supplied spine must be an edge model.
Invalid geometry, incompatible section placement or a failed spine association
can prevent the kernel from making a solid. The API has no automatic fallback
that repositions failed sections.

App inspection distinguishes the sections from the spine and preserves their
editable context when construction fails. Numeric profile and placement controls
remain on the expressions that define those inputs.

## Coordinates and model values

The operation creates new geometry without modifying its inputs. References and
measurements belong to the returned model's local frame; relations participate
where the operation combines inputs. See [local coordinates](../local-coordinates.md)
and [model values](../values.md). A solid supports `.area`, `.volume`, topology
selection, Booleans and finishing operations.

## Related APIs

- [sweep](sweep.md) keeps one section along a path.
- [extrude](extrude.md) extends one planar profile along its normal.
