---
title: bounds
description: Read finite axis-aligned geometry extents in a chosen model frame.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: e3658b0ffa55da9d2c612f442ce1d5f190923aea1870122823677faa60fb0b84
    - path: packages/core/src/library/spatial.ts
      sha256: 810c4fa69352c26c32fb04a0e7867f6327698e02f3212669f17d777784322a78
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
    - path: packages/core/src/library/topology.ts
      sha256: f9f0d048fe30cc80046a25123aa8101ca51e85cdb5b2e66260c6a68f43f84715
      commit: 67228dd8559d584852df7bfbd47ed89f1d8003e9
sidebar:
  hidden: true
head:
  - tag: title
    content: bounds — Code3D TypeScript API reference
---

Read finite axis-aligned geometry extents in a chosen model frame.

## Example

```ts
import {on, box, group, offset} from '@code3d/core';

const base = box(20, 4, 20);
const part = box(8, 12, 4).relate(() => [on(base.up), offset(20, 0, 0)]);
export const size = part.bounds().size; // [8, 12, 4]
export const origin = part.position(base); // [20, 8, 0]
export const minimum = part.bounds(base).minimum; // [16, 2, -2]
export default group([base, part]);
```

## Signature

```ts
model.bounds(relativeTo?: Model): ModelBounds;
type ModelBounds = Readonly<{
  minimum: Vec3;
  maximum: Vec3;
  size: Vec3;
}>;
```

Import the functions and named types from `@code3d/core`.

## Frame and result fields

Every model kind, including groups, supports this method. With no argument it
measures geometry in the receiver's own local coordinate frame. Standalone
placement does not change these local dimensions. Passing `relativeTo` instead
expresses the finite geometry in that model's frame, including solved relations
and nested group member occurrences.

`minimum` and `maximum` are readonly XYZ tuples; `size` is `maximum - minimum`
componentwise. The bounds are axis-aligned in the chosen frame. Rotating a body
can therefore change its extents even though lengths, areas and volume are
unchanged. Geometry is measured in that frame; it is not merely a transformed
pair of precomputed extrema.

In the example, the part's own size is `[8, 12, 4]`. Its origin in the base frame
is `[20, 8, 0]`, so its base-frame minimum is `[16, 2, -2]` and maximum is
`[24, 14, 2]`. Query results are ordinary numeric data in model units.

## Groups and occurrences

A group's bounds include its actual finite members after their assembly is
solved. The group frame follows the first member, as described in [group](group.md).
An empty group has no finite bounds and throws. A point has zero size in every
axis; edges or planar faces may have zero extent along some directions.

An explicit reference must be a model. When a source occurs multiple times in
the reference assembly, its occurrence is ambiguous and the query reports an
error; use distinct part values or an unambiguous containing instance. Named
geometry references can instead be used with [directional bounds](directional-bounds.md)
and [distance](distance.md).

## Value semantics

The query does not edit geometry or placement. It solves relationships already
attached at the time of the call and returns numbers; later model values do not
mutate an earlier result. `bounds` is a reserved model member name and cannot
be replaced using [expose](expose.md).

The method is distinct from `model.up` and the other `Bound` references used in
contact constraints. A bounding-box midpoint is also distinct from the carried
`center` reference and from the local origin. Use [originCenter](origin-center.md)
when the current geometry bounds should determine local zero.
