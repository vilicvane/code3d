---
title: Core API export index
description: Find the primary reference for every Core function, type, model member and integration entry point.
sourceReview:
  packageVersion: 0.0.1-alpha.16
  sources:
    - path: packages/core/src/library/index.ts
      sha256: 8f5784bccbc2f8a47139a71af3c3fbfe0c1e767dc9dcd61902fa06413dd40f54
      commit: b4fe7de02f59acbd2614a592a4b8ce0586243b22
    - path: packages/core/src/tooling/index.ts
      sha256: 540fe0cf5f3ba5f389da9f2a6441b722aac1b7de24530540eedee37eef8765dc
      commit: b4fe7de02f59acbd2614a592a4b8ce0586243b22
    - path: packages/core/src/library/replicad.ts
      sha256: 937b1c0bcdd8389e9c3724bb8bf867c3703509400a6bebfcfbcc84c8683e17fe
      commit: 5058f1bbd8f9289ad89f0cf6cb19f7b5fa143eae
    - path: packages/core/src/library/three.ts
      sha256: 14b4c9030e071ecd8a39dfc28a27ca7da6c2999c869a860b44525309613d7ba6
      commit: a7ca31b3b4369eb13e15604c281f99c7751ccc82
    - path: packages/core/src/node/index.ts
      sha256: 2c314699c2b47768bc4ae14b7713dc9eceb1111a3de7417820bdf4347bda3104
      commit: 5c8979f384280b644263a2d6ba3abacb69697c24
    - path: packages/core/package.json
      sha256: 08eda9195ce21309b89fd6c2389dbfa90ec202a872ab727df62dadc8736dd986
sidebar:
  hidden: true
head:
  - tag: title
    content: Core API export index — Code3D TypeScript API reference
---

This index records the public API surface and its documentation home. Start with task-based categories for modeling, or use exact export names here when reviewing a package upgrade.

## Example

```ts
import {box, type SolidModel, type Vec3} from '@code3d/core';

const dimensions: Vec3 = [20, 10, 8];
export const part: SolidModel = box(...dimensions);
```

## Signature

```ts
// Modeling values and types
import {box, type Model} from '@code3d/core';
// Host integration
import {isModelObject} from '@code3d/core/tooling';
// Native geometry and appearance
import {definePrimitive, replicad} from '@code3d/core/replicad';
import {MeshStandardMaterial} from '@code3d/core/three';
```

Import the functions and named types from `@code3d/core`.

## Root functions and values

Import these 52 runtime values from `@code3d/core`. Equivalent free-function and
model-method forms share one primary reference. The table is alphabetical;
[browse by task](../api.md#browse-by-task) when choosing an operation.

| Export                | Primary reference                                 |
| --------------------- | ------------------------------------------------- |
| `align`               | [align](align.md)                                 |
| `anchorAnnotation`    | [annotations](annotations.md)                     |
| `arc`                 | [arc](arc.md)                                     |
| `axisEdge`            | [axis edge](axis-edge.md)                         |
| `axisLine`            | [axis line](axis-line.md)                         |
| `bezier`              | [bezier](bezier.md)                               |
| `boundsAnnotation`    | [annotations](annotations.md)                     |
| `box`                 | [box](box.md)                                     |
| `cache`               | [cache](cache.md)                                 |
| `captureInspectData`  | [inspectors](inspectors.md)                       |
| `circle`              | [circle](circle.md)                               |
| `coil`                | [coil](coil.md)                                   |
| `coupleRotation`      | [couple rotation](couple-rotation.md)             |
| `cut`                 | [cut](cut.md)                                     |
| `cylinder`            | [cylinder](cylinder.md)                           |
| `dimension`           | [annotations](annotations.md)                     |
| `distance`            | [distance](distance.md)                           |
| `ellipse`             | [ellipse](ellipse.md)                             |
| `ellipsoid`           | [ellipsoid](ellipsoid.md)                         |
| `extrude`             | [extrude](extrude.md)                             |
| `font`                | [font](font.md)                                   |
| `frame`               | [frame](frame.md)                                 |
| `frustum`             | [frustum](frustum.md)                             |
| `googleFont`          | [google font](google-font.md)                     |
| `group`               | [group](group.md)                                 |
| `input`               | [input](input.md)                                 |
| `inspectGroupMembers` | [inspect group members](inspect-group-members.md) |
| `intersect`           | [intersect](intersect.md)                         |
| `line`                | [line](line.md)                                   |
| `loft`                | [loft](loft.md)                                   |
| `offset`              | [offset](offset.md)                               |
| `on`                  | [on](on.md)                                       |
| `originCenter`        | [origin center](origin-center.md)                 |
| `pivot`               | [pivot](pivot.md)                                 |
| `pivotPoint`          | [pivot point](pivot-point.md)                     |
| `pivotVertex`         | [pivot vertex](pivot-vertex.md)                   |
| `point`               | [point](point.md)                                 |
| `rectangle`           | [rectangle](rectangle.md)                         |
| `regularPolygon`      | [regular polygon](regular-polygon.md)             |
| `regularPrism`        | [regular prism](regular-prism.md)                 |
| `revolve`             | [revolve](revolve.md)                             |
| `rotate`              | [rotate](rotate.md)                               |
| `sketch`              | [sketch](sketch.md)                               |
| `sphere`              | [sphere](sphere.md)                               |
| `spline`              | [spline](spline.md)                               |
| `sweep`               | [sweep](sweep.md)                                 |
| `text`                | [text](text.md)                                   |
| `thicken`             | [thicken](thicken.md)                             |
| `timeOffset`          | [time offset](time-offset.md)                     |
| `tube`                | [tube](tube.md)                                   |
| `union`               | [union](union.md)                                 |
| `wrap`                | [wrap](wrap.md)                                   |

## Root types

Import these 83 named types with `import type` from `@code3d/core`. An interface
may inherit members, and a model alias may intersect several capabilities; the
primary reference covers that full contract. Private brands are not author fields.
Configuration fields and union branches are documented with the operation that
uses them rather than split into otherwise empty type pages.

| Type                            | Primary reference                           |
| ------------------------------- | ------------------------------------------- |
| `Anchor`                        | [reference elements](reference-elements.md) |
| `AnchorAnnotation`              | [annotations](annotations.md)               |
| `AxisChain`                     | [axis edge](axis-edge.md)                   |
| `AxisRotation`                  | [axis edge](axis-edge.md)                   |
| `Bound`                         | [directional bounds](directional-bounds.md) |
| `BoundsAnnotation`              | [annotations](annotations.md)               |
| `CacheOptions`                  | [cache](cache.md)                           |
| `CanonicalElements`             | [reference elements](reference-elements.md) |
| `Constraint`                    | [relate](relate.md)                         |
| `CurveElements`                 | [reference elements](reference-elements.md) |
| `Dimension`                     | [annotations](annotations.md)               |
| `DimensionSegment`              | [annotations](annotations.md)               |
| `DirectionalBounds`             | [directional bounds](directional-bounds.md) |
| `DistanceAxis`                  | [distance](distance.md)                     |
| `Edge`                          | [edge](edge.md)                             |
| `EdgeId`                        | [edge](edge.md)                             |
| `EdgeModel`                     | [model types](model-types.md)               |
| `EdgeTopologyCapabilities`      | [model types](model-types.md)               |
| `ElementKind`                   | [reference elements](reference-elements.md) |
| `ElementSources`                | [expose](expose.md)                         |
| `ExposedElements`               | [expose](expose.md)                         |
| `ExposedValue`                  | [expose](expose.md)                         |
| `FaceAnchor`                    | [reference elements](reference-elements.md) |
| `FaceModel`                     | [model types](model-types.md)               |
| `Font`                          | [font](font.md)                             |
| `Frame`                         | [frame](frame.md)                           |
| `FrameAnchor`                   | [reference elements](reference-elements.md) |
| `GeometryCapabilities`          | [model types](model-types.md)               |
| `GeometryQueryCapabilities`     | [model types](model-types.md)               |
| `GoogleFontOptions`             | [google font](google-font.md)               |
| `GroupModel`                    | [model types](model-types.md)               |
| `GroupOptions`                  | [group](group.md)                           |
| `InputOptions`                  | [input](input.md)                           |
| `InspectCall`                   | [inspectors](inspectors.md)                 |
| `InspectClosure`                | [inspectors](inspectors.md)                 |
| `InspectClosureExecution`       | [inspectors](inspectors.md)                 |
| `InspectContext`                | [inspectors](inspectors.md)                 |
| `InspectContextFactory`         | [inspectors](inspectors.md)                 |
| `InspectResult`                 | [inspectors](inspectors.md)                 |
| `Inspector`                     | [inspectors](inspectors.md)                 |
| `LineAnchor`                    | [reference elements](reference-elements.md) |
| `LoftOptions`                   | [loft](loft.md)                             |
| `MergedElements`                | [expose](expose.md)                         |
| `Model`                         | [model types](model-types.md)               |
| `ModelBounds`                   | [bounds](bounds.md)                         |
| `ModelCapabilities`             | [model types](model-types.md)               |
| `ModelElementKind`              | [model types](model-types.md)               |
| `ModelForKind`                  | [model types](model-types.md)               |
| `ModelGeometryKind`             | [model types](model-types.md)               |
| `ModelKind`                     | [model types](model-types.md)               |
| `ModelMetadata`                 | [model metadata](model-data.md)             |
| `NamedElements`                 | [expose](expose.md)                         |
| `PivotChain`                    | [pivot](pivot.md)                           |
| `PivotRotation`                 | [pivot](pivot.md)                           |
| `PlanarElements`                | [reference elements](reference-elements.md) |
| `PointAnchor`                   | [reference elements](reference-elements.md) |
| `PreviewValue`                  | [inspectors](inspectors.md)                 |
| `Relation`                      | [relate](relate.md)                         |
| `RevolveConfig`                 | [revolve](revolve.md)                       |
| `RotationCouplingConfig`        | [couple rotation](couple-rotation.md)       |
| `Sketch`                        | [sketch](sketch.md)                         |
| `SketchArcDirection`            | [sketch entities](sketch-entities.md)       |
| `SketchConstraint`              | [sketch constraints](sketch-constraints.md) |
| `SketchEntry`                   | [sketch entities](sketch-entities.md)       |
| `SketchOptions`                 | [sketch](sketch.md)                         |
| `SketchPoint`                   | [sketch derive](sketch-derive.md)           |
| `SketchPosition`                | [sketch entities](sketch-entities.md)       |
| `Solid`                         | [reference elements](reference-elements.md) |
| `SolidModel`                    | [model types](model-types.md)               |
| `SolidModificationCapabilities` | [model types](model-types.md)               |
| `Surface`                       | [surface](surface.md)                       |
| `SurfaceId`                     | [surface](surface.md)                       |
| `SurfaceTopologyCapabilities`   | [model types](model-types.md)               |
| `TextOptions`                   | [text](text.md)                             |
| `TopologyId`                    | [vertex](vertex.md)                         |
| `TopologyKind`                  | [vertex](vertex.md)                         |
| `Transformation`                | [relate](relate.md)                         |
| `Vec3`                          | [model types](model-types.md)               |
| `Vertex`                        | [vertex](vertex.md)                         |
| `VertexId`                      | [vertex](vertex.md)                         |
| `VertexModel`                   | [model types](model-types.md)               |
| `VertexTopologyCapabilities`    | [model types](model-types.md)               |
| `WrapOptions`                   | [wrap](wrap.md)                             |

## Model and reference members

Model members are separate from root free-function exports. Some names occur on
both models and references with different results; use the owner-specific
contract instead of relying on a method's spelling.

| Owner / capability           | Primary member references                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every model and group        | [metadata / withMetadata](model-data.md), [frame / origin](reference-elements.md), [directional bounds](directional-bounds.md), [bounds](bounds.md), [position](position.md), [relate](relate.md), [expose](expose.md), [material](material.md), [originOffset](origin-offset.md), [originPoint](origin-point.md), [rotate](model-rotate.md) |
| Geometric models             | [center](reference-elements.md#center), [originCenter](origin-center.md), [originVertex](origin-vertex.md), [scaled](scaled.md)                                                                                                                                                                                                              |
| Vertex topology              | [vertex / vertices](vertex.md)                                                                                                                                                                                                                                                                                                               |
| Edge topology                | [edge / edges](edge.md), inherited vertex selection                                                                                                                                                                                                                                                                                          |
| Surface topology             | [surface / surfaces](surface.md), inherited edge and vertex selection                                                                                                                                                                                                                                                                        |
| Solid models                 | [cut](cut.md), [fillet](fillet.md), [chamfer](chamfer.md), [shell](shell.md), [area](area.md), [volume](volume.md)                                                                                                                                                                                                                           |
| Face models                  | [extrude](extrude.md), [revolve](revolve.md), [sweep](sweep.md), [thicken](thicken.md), [area](area.md), [flip](flip-reverse.md)                                                                                                                                                                                                             |
| Edge models                  | [length](length.md), [reverse](flip-reverse.md)                                                                                                                                                                                                                                                                                              |
| Finite references and frames | [kind / id and topology](vertex.md), [center / axis / plane / curve points / frame.origin](reference-elements.md), [flip / reverse](flip-reverse.md), [measurements](distance.md)                                                                                                                                                            |
| Independent Frame            | [origin / relate](frame.md)                                                                                                                                                                                                                                                                                                                  |
| Sketch                       | [point / derive](sketch-derive.md), [face / faces](sketch-faces.md), [plane / relate](sketch-relate.md)                                                                                                                                                                                                                                      |
| Pivot chains                 | [pivotOffset / rotate](pivot.md), [pivotVertex](pivot-vertex.md), [pivotPoint](pivot-point.md)                                                                                                                                                                                                                                               |
| Axis chains                  | [axisOffset / rotate](axis-edge.md), [axisLine](axis-line.md)                                                                                                                                                                                                                                                                                |
| Font and query results       | [family / style](font.md), [ModelBounds fields](bounds.md)                                                                                                                                                                                                                                                                                   |

[Model types and capabilities](model-types.md) gives the complete inheritance
matrix. A finite reference is not an independently placeable model; a group
has no aggregate solid topology or area/volume properties.

## Host and interoperability entries

- [Tooling integration](tooling.md) covers all 83 values and 73 type exports of
  `@code3d/core/tooling`, including host-only members, lifecycle exits, snapshots
  and every discriminated result branch. Shared author types link to their
  primary references above.
- [definePrimitive and Replicad](define-primitive.md) covers `definePrimitive`,
  `replicad` and `Replicad` from `@code3d/core/replicad`. Upstream types are passed
  through; native runtime operations are properties of the shared `replicad`
  object. Follow its upstream reference after reading Code3D ownership rules.
- [Three.js integration](three.md) covers the shared `@code3d/core/three`
  passthrough and Code3D material/texture capture restrictions. Upstream Three.js
  exports are documented upstream, rather than duplicated as Code3D APIs.

The Node authoring entry initializes the runtime then re-exports the same root
API. Source exports stripped from public declarations by `@internal` are not
ordinary public free functions; this includes the implementation helpers named
`relate`, `expose`, `inspectTopologyReference`, `inspectLength`, `inspectArea` and
`inspectVolume`. Public model `.relate()` and `.expose()` remain documented.

## How this reference stays current

Each detailed page independently records its reviewed package version and the
SHA-256 of the source files reviewed for that page. When content matches a Git
commit, the rendered reference links to that committed source. A new package
version alone does not rewrite old review records. A source mismatch fails the
read-only documentation check until the affected page is reviewed explicitly.

The export index tracks entry-point changes; detailed pages track their relevant
implementations and shared mechanisms. Source hashes help identify review work,
but maintainers must also consider indirect behavioral dependencies when a
shared implementation changes. See the [documentation workflow](../../../web/README.md)
for review commands and publication checks.
