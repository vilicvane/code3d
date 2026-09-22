---
title: align
description: Align supporting geometry or coincide two complete coordinate frames.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/align.ts
      sha256: ea171203ce58b50b86f522331e911d62cf2ee5f5c65d4b4e3e103aac3b2651f6
      commit: 757c8003e4ef2c3e4b4e85561e186a82a1dd1c39
    - path: packages/core/src/library/runtime.ts
      sha256: fc22c45a8a4fd68eaf51c43b8dc100f9337fc8bcb59760e2cc2e0dcbc437b337
    - path: packages/core/src/library/alignment-geometry.ts
      sha256: 5d0a2bee2c0254805edb71643a44b33149a92d2d6253b3a6eb437cd6720156fc
      commit: 7f67264a5c862cdb95c408bcaedff43a3f8f46dd
    - path: packages/core/src/library/relation-solver.ts
      sha256: 57d7233eb74cba8255805756053b2385a4dca8a78dad6a9a09590bda68630e47
      commit: 91ff6d31aa4440565eb7ffc4ef30dd1ffd50707a
sidebar:
  hidden: true
head:
  - tag: title
    content: align — Code3D TypeScript API reference
---

Align supporting geometry or coincide two complete coordinate frames.

## Example

```ts
import {align, box, group, point} from '@code3d/core';

const datum = point([16, 8, 0]);
const alignedPart = box(8, 6, 10).relate(self => align(self.center, datum));
export const alignedAssembly = group([point(), datum, alignedPart]);
```

![Align supporting geometry or coincide two complete coordinate frames.](../../../web/src/assets/models/placement-align.png)

Complete example: [groups and placement](../../../app/examples/constraints/placement-api.ts).

## Signature

```ts
function align(
  source: Anchor<'point' | 'line' | 'face'>,
  target: Anchor<'point' | 'line' | 'face'>,
): Constraint;
function align(source: FrameAnchor, target: FrameAnchor): Constraint;
```

Import the functions and named types from `@code3d/core`.

## Geometry alignment

The first overload works on geometric references. Point–point alignment coincides
positions; points may also lie on a supporting curve or surface. Curves can
coincide or lie wholly on a surface. Compatible surfaces coincide with matching
normal sense. The example puts the part center at `[16, 8, 0]`.

Supported underlying geometry is points, straight lines, circles, ellipses,
planes, cylinders and spheres. Other curve and surface types are unsupported.
Edges and surfaces contribute their complete supporting geometry: a point may
lie on a line beyond an edge's endpoints, and arcs may share a circle even if
their trimmed ranges differ. Aligning geometry does not pair endpoints or
parameter origins. Select vertices, start/midpoint/end or explicit origins when
those positions matter.

Directions matter for curve coincidence and face normals. Use `reverse()` on
a line or edge to reverse its positive direction, or `flip()` on a surface to
reverse normal sense. These do not rotate the reference coordinate axes.
Point membership ignores direction; a curve on a surface does not acquire an
arbitrary heading within that surface.

## Frame alignment

`align(self.frame, other.frame)` coincides origins and all three coordinate axes.
Select `.frame` explicitly: aligning models does not implicitly align their
coordinate systems. `align(self.origin, other.origin)` is point coincidence
and leaves orientation free. Mixing a frame and geometric reference is invalid.

## Solving and errors

Use the returned `Constraint` in [relate](relate.md). Either argument may contain
self, but every constraint must involve that new value. Geometry alignment can
rotate self as well as translate it. Unconstrained freedom follows the surrounding
solve sequence; multiple solutions may remain. Joint incompatible conditions,
unsupported geometry and numerical failure have distinct diagnostics.

Add independent [offset](offset.md) or [rotate](rotate.md) steps to adjust the
joint solution. Constraints have no transform methods. Use [on](on.md) for
translation-only contact of finite directional bounds.
