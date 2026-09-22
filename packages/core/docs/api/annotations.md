---
title: Inspection annotations
description: Create passive dimension, bounds and anchor-direction annotations in an owner model’s local coordinates.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/app/src/rendering/parameter-dimension.ts
      sha256: b166988b7f2f948432fb6b7504f6c47c074e322b0af69d7fc64d88adc68212ab
      commit: da2824c30b54a50ac216679fff96c67dd3dcee4c
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
    content: Inspection annotations — Code3D TypeScript API reference
---

`dimension`, `boundsAnnotation` and `anchorAnnotation` create preview values for inspectors. They add visual information without creating CAD geometry or editable model parameters.

## Example

```ts
import {box, dimension, boundsAnnotation, anchorAnnotation} from '@code3d/core';

const owner = box(20, 10, 8);
export const preview = {
  target: [
    owner,
    dimension({owner, value: 20, start: [-10, 5, 4], end: [10, 5, 4]}),
    boundsAnnotation({
      owner,
      size: [20, 10, 8],
      frame: {position: [0, 0, 0], quaternion: [0, 0, 0, 1]},
    }),
    anchorAnnotation(owner.axis, {direction: 'both'}),
  ],
};
```

## Signature

```ts
dimension(value: {
  owner: Model; value: number; axisLabel?: string;
} & (
  | DimensionSegment
  | {candidates: readonly DimensionSegment[]}
  | {at: Vec3}
)): Dimension;
boundsAnnotation(value: Omit<BoundsAnnotation, 'kind'>): BoundsAnnotation;
anchorAnnotation(
  anchor: Anchor,
  options: Pick<AnchorAnnotation, 'direction'>,
): AnchorAnnotation;
```

Import the functions and named types from `@code3d/core`.

## Dimensions

`Dimension` combines `kind: 'dimension'`, `owner: Model`, `value: number`,
optional `axisLabel: string`, and exactly one of these line descriptions:

| Shape                                     | Meaning                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `start: Vec3; end: Vec3`                  | A fixed segment in the owner's local coordinates.                                  |
| `candidates: readonly DimensionSegment[]` | Alternative segments for the same displayed measurement; at least one is required. |
| `at: Vec3`                                | A value label at one local point, with no dimension line.                          |

`DimensionSegment` is `Readonly<{start: Vec3; end: Vec3}>`. The constructors
return readonly records. The numeric `value` is supplied by the caller; the
renderer does not derive it from segment length. This lets the same passive
label show length, angle or other queried values. `axisLabel` supplies an
optional short label such as `X`.

An empty candidates array throws. For alternatives, the App picks a suitable
near segment when inspection starts and preserves that choice while orbiting or
rechecking the same parameter; leaving that inspection resets the choice.
Segment dimensions use endpoint ticks and a screen-sized dashed line.

## BoundsAnnotation

| Field          | Meaning                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `kind`         | Always `'bounds'`, supplied by the helper.                                                                   |
| `owner: Model` | The model whose local frame contains the annotation.                                                         |
| `size: Vec3`   | Full extent along the annotation frame's local XYZ axes.                                                     |
| `frame`        | `{position: Vec3; quaternion: readonly [x, y, z, w]}` relative to the owner; its position is the box center. |

The App draws screen-sized bounds corners. A bound may represent a flat or
linear range; it need not be a solid box. Supply the exact extent being
explained, such as a contact support range, rather than substituting unrelated
whole-model bounds.

## AnchorAnnotation

`AnchorAnnotation` has `kind: 'anchor-annotation'`, `anchor: Anchor` and
`direction: 'none' | 'forward' | 'both'`. The second argument is required and
selects those direction markers. The helper retains the wrapped anchor's
inspection identity so source selection still focuses the same reference.
It does not reverse or otherwise change the anchor; use [flip / reverse](flip-reverse.md)
when changing the actual reference direction is intended.

For curves, arrows follow the actual endpoint tangents; reversing the reference
reverses its authored direction. Returning an ordinary anchor keeps its default
object preview.

## Use in an inspector

Return annotations alongside their owners in `target` or `ambient` arrays of an
[InspectResult](inspectors.md#inspection-types). The example exports such a record
for clarity; returning it from an inspector displays its scene. Exporting the
record alone does not turn it into a model or automatically register an inspector.

Coordinates are local to the stated owner and move with its inspected placement.
Annotations do not affect bounds, area, volume, Boolean operations or exported
CAD files. They are passive inspection values, not handles for editing source.
The helpers add discriminants and perform only limited validation; supply finite,
meaningful values and a normalized rotation quaternion.
