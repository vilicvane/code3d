---
title: Reference elements
description: Understand frames, origins, centers, axes, planes and curve point references.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: fc22c45a8a4fd68eaf51c43b8dc100f9337fc8bcb59760e2cc2e0dcbc437b337
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
    content: Reference elements — Code3D TypeScript API reference
---

Understand frames, origins, centers, axes, planes and curve point references.

## Example

```ts
import {box, line, point, rectangle} from '@code3d/core';

export const marker = point([10, 0, 0]);
export const block = box(20, 10, 14);
export const profile = rectangle(12, 8);
export const path = line([10, 0, 0], [30, 0, 0]);

export const localFrame = marker.frame;
export const zero = marker.origin;
export const geometricPoint = marker.center;
export const centerline = block.axis;
export const workplane = profile.plane;
export const middle = path.midpoint;
```

Complete example: [topology and references](../../../app/examples/operations/topology-api.ts).

## Signature

```ts
model.frame: FrameAnchor;
model.origin: PointAnchor;
frame.origin: PointAnchor;
geometricModel.center: PointAnchor;
// Members published by the constructor's element type:
solid.axis: LineAnchor;
planarFace.plane: FaceAnchor;
curve.start: PointAnchor;
curve.midpoint: PointAnchor;
curve.end: PointAnchor;
```

Import the functions and named types from `@code3d/core`.

## References and model values

An `Anchor<Kind>` is an opaque reference accepted by compatible modeling APIs.
`PointAnchor`, `LineAnchor`, `FaceAnchor` and `FrameAnchor` express the geometry
or coordinate system being referenced. They do not expose raw position tuples.
Use them with [align](align.md), [on](on.md), [distance](distance.md),
[originPoint](origin-point.md) and rotation selectors.

A reference keeps its owner and occurrence. It is not an independently exportable
model and cannot be added as a geometry child in [group](group.md). Modeling
methods return new values; old references retain the meaning of their original
owner. Select `self` in [relate](relate.md) to refer to the new value.

## frame and origin

Every model, including a group, provides `frame`, its local coordinate system.
`model.origin` is the same point reference as `model.frame.origin`; local zero
is always `[0, 0, 0]`. The frame's axes describe model coordinates, independently
of where its geometry happens to be.

In the example, `marker` has geometry at `[10, 0, 0]`, while `zero` refers to
`[0, 0, 0]`. Neither property constructs extra point geometry. An exposed frame
retains its origin and follows the selected occurrence through nested groups.
`align(self.frame, other.frame)` coincides all axes and origins; aligning only
origins leaves orientation unconstrained.

## center

Geometric models provide a `PointAnchor` for their initial local bounding-box
center, and local transforms carry it with the geometry. This need not be the
construction center: [regularPolygon](regular-polygon.md) with an odd side count
can have a bounding-box center away from its construction-circle center.
A group does not provide a geometric center.

Rotation does not replace a carried center with the center of the new axis-aligned
bounds. A boolean or other geometry edit can also leave the carried reference
away from the current bounds center. Use [originCenter](origin-center.md) when
recomputed geometric bounds should define zero, or `originPoint(model.center)`
when this stable reference should define it. A topology reference's `center`
comes from its selected geometry's bounding box and follows its transformations.

## axis

`CanonicalElements` publishes `center` and `axis` on ordinary solid results.
Each constructor defines the axis position and direction, normally +Y. It need
not pass through `model.center`: [regularPrism](regular-prism.md) keeps the
polygon's central axis even when its bounding-box center is offset. The axis is
a carried line reference, not a principal inertia axis recomputed after each
edit. Local geometry transforms carry it; a model's local `up` bound still uses
+Y independently.

Use `axis.reverse()` to reverse its sense, [axisLine](axis-line.md) for rotation,
and [coupleRotation](couple-rotation.md) for fixed-axis transmission. Generic models
or groups do not automatically have an axis; expose one when it is part of the
part's interface. `LineAnchor` can also represent curved edges; APIs that require
a straight axis validate the underlying geometry.

## plane

`PlanarElements` publishes `center` and `plane` on planar face constructors.
The usual initial profile is in XZ with normal +Y. The plane follows local
transforms and is an infinite reference, not the finite trim of the face model.
Use `surface(id)` when finite geometry is required, such as a [wrap](wrap.md)
target. Curved faces do not automatically publish a planar element.
`plane.flip()` changes its normal sense for relations.

## start, midpoint and end

`CurveElements` publishes these point references at curve parameters 0, 0.5 and 1.
For the line in the example they are `[10, 0, 0]`, `[20, 0, 0]` and `[30, 0, 0]`.
On general curves, a parameter midpoint need not be halfway along arc length.
They remain distinct from the model's origin and bounding-box center. Closed
curves can have coincident start/end positions.

## Exposed solid references

[expose](expose.md) converts a solid model source into a `Solid` reference.
It has `kind: 'solid'`, center, directional bounds, topology selection, area and
volume, but no `id` for the entire solid and no modeling operations. Its named
members survive with their reference types. Exposed groups provide frame and
bound references rather than an aggregate topology namespace.
