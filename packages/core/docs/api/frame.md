---
title: frame
description: Create an independent coordinate frame and choose a stable assembly reference.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/frame.ts
      sha256: 1a24a9b8bd10b6ffa302b8ae83e6c8f8872d2e71011d4b72c839beb19f8c26bf
    - path: packages/core/src/library/runtime.ts
      sha256: 1caf8c92de983f0c22b4da70e0af4216472b9ff8fe8e2f0ebc34ec9a84e259b0
    - path: packages/core/src/library/group.ts
      sha256: c9592b8f7ed218c81a147f1a5102592cd8b21cde0953bf0178ea0b848e0952a6
sidebar:
  hidden: true
head:
  - tag: title
    content: frame — Code3D TypeScript API reference
---

`frame` creates an independent origin and three axes. Use it as the coordinate reference for an assembly without adding placeholder geometry.

## Example

```ts
import {align, box, frame, group, input, rotate} from '@code3d/core';

const base = frame('Assembly frame');
const angle = input('Angle', 0);
const crank = box(30, 4, 8).relate(self => [
  align(self.frame, base),
  rotate(0, angle, 0),
]);
export default group([crank], {name: 'Crank', frame: base});
```

## Signature

```ts
function frame(name?: string): Frame;
interface Frame extends FrameAnchor {
  readonly origin: PointAnchor;
  relate(build: (self: Frame) => Relation | readonly Relation[]): Frame;
}
```

Import the functions and named types from `@code3d/core`.

## Name and result

`name` is an optional display label, defaulting to `Frame`. A `Frame` is a
`FrameAnchor` with its own placement program and `.relate()` method. It has no
finite geometry, bounding box, topology, material or mesh, and is not a `Model`.
It cannot be added to the children of a group. Use a [point](point.md) when you
need actual point geometry.

## Placement and assembly coordinates

Use `align(self, otherFrame)` to align an independent frame, or
`align(model.frame, reference)` to align a model's frame. `.origin` selects only
the zero point. Relations return a new frame; the callback's `self` denotes that
new value, and references captured outside the callback retain their old identity.
Constraints must involve `self`. See [relate](relate.md) for solve order and
[align](align.md) for compatible reference kinds.

The reference's own zero point and axes remain its local coordinates. Relations
are resolved within a composition. [Group options](group.md#coordinate-frame)
select the reference's solved origin and axes, including any exposed frame's
local transform. In the example the crank rotates inside `base`; its changing
angle does not rotate the assembly's coordinate system.

`group([], {frame: base})` is valid but has no finite bounds. Selecting a frame
never adds output geometry. Origin edits and rotation of a completed group
carry the reference occurrence along with the assembly, including nested groups.
An independent frame accepts relation transformations such as `rotate` and
`pivotPoint`; topology-based selectors require finite model geometry.

## Exposed references and host inspection

`expose({mount: base})` publishes a transformed `FrameAnchor`, with `.origin`,
rather than guaranteeing the independent `Frame` construction methods. Keep the
original `Frame` when authoring a new relation value; use the exposed reference
when positioning another part against the completed assembly.

The App can inspect frame references and the `frame` option of a group, with
assembly members as context. A [dimension annotation](annotations.md) may use an
independent frame as owner even when no finite owner geometry exists. Host code
uses [isFrame and runtime identities](tooling-evaluation.md#isframe), or
[modelOperationObject](tooling-snapshots.md#modeloperationobject) to resolve a
model, frame or sketch into its relation participant.
