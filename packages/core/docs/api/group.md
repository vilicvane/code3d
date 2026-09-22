---
title: group
description: Compose models into an assembly while preserving separate members and their hierarchy.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/group.ts
      sha256: c9592b8f7ed218c81a147f1a5102592cd8b21cde0953bf0178ea0b848e0952a6
    - path: packages/core/src/library/runtime.ts
      sha256: 1caf8c92de983f0c22b4da70e0af4216472b9ff8fe8e2f0ebc34ec9a84e259b0
sidebar:
  hidden: true
head:
  - tag: title
    content: group — Code3D TypeScript API reference
---

Compose models into an assembly while preserving separate members and their hierarchy.

## Example

```ts
import {box, group, on} from '@code3d/core';

const standBase = box(32, 4, 24);
const standPost = box(8, 12, 8).relate(() => on(standBase.up));
export const stand = group([standBase, standPost], {name: 'Stand'});
```

![Compose models into an assembly while preserving separate members and their hierarchy.](../../../web/src/assets/models/placement.png)

Complete example: [groups and placement](../../../app/examples/constraints/placement-api.ts).

## Signature

```ts
function group(children: readonly Model[], options?: GroupOptions): GroupModel;
type GroupOptions = Readonly<{name?: string; frame?: FrameAnchor}>;
```

Import the functions and named types from `@code3d/core`.

## Members and result

`children` is a readonly array of models: solids, faces, curves, points or nested
groups. An empty array is valid. A topology or anchor reference is not a model
and cannot be added as an independent child. `options.name` is an optional display
name, defaulting to `Group`. `options.frame` selects the assembly coordinates.
Omitting the options object is equivalent to `{}`.

Relations are solved at the composition boundary. The resulting `GroupModel`
retains each separate part, material and nested hierarchy. This does not fuse
geometry or remove internal overlaps; use [union](union.md) for a boolean solid.
The example contains two solids and puts the post's bottom against the base's top.

## Coordinate frame

Without `options.frame`, a nonempty group inherits its first member's solved local frame, including its
origin and axes. Reordering members can therefore change the result coordinates
without changing the intended relative placement. A nested group is one complete
member; its children are not flattened to choose the outer origin. An empty group
uses the default frame when no frame is selected, and has no finite geometric bounds.

With `{frame: reference}`, the reference's solved origin and all axes determine
the assembly coordinates independently of member order. Use an independent
[frame](frame.md), a model's `.frame`, or an exposed `FrameAnchor`. The reference
participates in solving but is not an output child. An exposed frame's own local
transform is included. Empty groups can also select a frame. Nested groups,
origin edits and rotations carry the chosen reference occurrence with the
completed assembly. Selecting the frame option in the App shows the reference
with member geometry as context.

## Group capabilities

Groups provide [metadata and withMetadata](model-data.md), `origin`, `frame`, directional bounds, [bounds](bounds.md),
`position`, [relate](relate.md), [expose](expose.md), material, originOffset,
originPoint and [model.rotate](model-rotate.md). Origin edits and rotation act on
the already assembled layout, preserving member relationships. Groups do not
provide aggregate topology IDs, geometric `center`, `axis`, area, volume,
originVertex, originCenter, scaling or solid modifications.

Use `expose({name: member})` to publish typed member references. Merely naming a
local variable does not add it to the group interface. Repeated use of one source
requires a specific instance reference when later queries would be ambiguous.

The constructor returns a new value; it does not alter its members. Invalid
children or unsatisfiable member relations report errors during composition.
See [local group coordinates](../local-coordinates.md#group-origins).
