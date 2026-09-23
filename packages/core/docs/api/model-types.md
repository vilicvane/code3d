---
title: Model types and capabilities
description: Choose a model type, retain named references and understand geometry-specific capability interfaces.
sourceReview:
  packageVersion: 0.0.1-alpha.16
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: dcee3d2388a9b7b3819bb4897edd894463daa0e5b519e832a3349fac98c3bff8
    - path: packages/core/src/library/spatial.ts
      sha256: 810c4fa69352c26c32fb04a0e7867f6327698e02f3212669f17d777784322a78
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
sidebar:
  hidden: true
head:
  - tag: title
    content: Model types and capabilities — Code3D TypeScript API reference
---

Core models are immutable modeling values with capabilities determined by their geometry kind. Use a concrete model type when your function needs geometry operations, or `Model` for capabilities shared by every model.

## Example

```ts
import {box, circle, group, type Model, type SolidModel} from '@code3d/core';

function paint(model: Model): Model {
  return model.material('#9bc7c5');
}
function drill(stock: SolidModel<{}>): SolidModel {
  return stock.cut([circle(2).extrude(30)]);
}
const part = drill(box(20, 20, 20));
export default group([paint(part)]);
```

## Signature

```ts
type ModelGeometryKind = 'solid' | 'face' | 'edge' | 'vertex';
type ModelKind = ModelGeometryKind | 'group';
type Vec3 = readonly [x: number, y: number, z: number];

type Model<Elements extends NamedElements = {}> = ModelCapabilities<
  Elements,
  ModelKind
> &
  Elements;
type GroupModel<Elements extends NamedElements = {}> = ModelCapabilities<
  Elements,
  'group'
> &
  Elements;

// Concrete geometry models add the capabilities listed below:
// VertexModel<Elements = {}>
// EdgeModel<Elements = CurveElements>
// FaceModel<Elements = PlanarElements>
// SolidModel<Elements = CanonicalElements>
```

Import the functions and named types from `@code3d/core`.

## Model kinds

| Type                                       | Geometry and capabilities beyond shared model operations                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VertexModel<Elements = {}>`               | One point; geometry operations and vertex selection. Construct with [point](point.md).                                                                                 |
| `EdgeModel<Elements = CurveElements>`      | One curve; geometry operations, edge/vertex selection, readonly [length](length.md), and [reverse(): Edge](flip-reverse.md).                                           |
| `FaceModel<Elements = PlanarElements>`     | One face; geometry operations, surface/edge/vertex selection, readonly [area](area.md), [flip(): Surface](flip-reverse.md), and the four solid-building methods below. |
| `SolidModel<Elements = CanonicalElements>` | Solid geometry; geometry operations, all topology selection, [solid modifications](#solidmodificationcapabilities), readonly [area](area.md) and [volume](volume.md).  |
| `GroupModel<Elements = {}>`                | A hierarchy of models; shared model operations only. It has no own topology selectors, center, area, volume or uniform scaling. See [group](group.md).                 |
| `Model<Elements = {}>`                     | The common authoring contract, useful for mixed collections and utilities. It does not expose a public `kind` discriminator or geometry-specific methods.              |

`Elements` always extends `NamedElements`. The default named references describe
usual constructor results, not extra members guaranteed by every generic model.
For example, `SolidModel<{}>` accepts solids without requiring a named `axis`;
geometry capabilities still provide `center`. `EdgeModel<{}>` need not expose
`start`, `midpoint` and `end` names. Preserve inferred types when consumers need
custom references; widening to `Model` deliberately forgets them.

Model values are created by Core APIs. Private brands establish model/reference
identity; a plain object cast to `Model` is not a valid runtime model. Runtime
integration uses tooling guards and runtime information instead of inspecting
private fields from author code.

## ModelCapabilities

`ModelCapabilities<Elements, Kind>` combines an anchor of
`ModelElementKind<Kind>` with `DirectionalBounds` and these shared members.
Methods that return models preserve `Kind` and `Elements`, except that `expose`
merges its new names.

| Member                                                | Contract and primary reference                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `metadata: ModelMetadata`                             | Readonly symbol-keyed [metadata](model-data.md).                                                                 |
| `withMetadata(entries: ModelMetadata)`                | Return a new model with merged metadata entries.                                                                 |
| `origin: PointAnchor`                                 | Same zero-point reference as `frame.origin`; [reference elements](reference-elements.md).                        |
| `frame: FrameAnchor`                                  | Local coordinate frame, independent of geometry; [reference elements](reference-elements.md).                    |
| `up`, `down`, `left`, `right`, `front`, `back: Bound` | Six finite [directional bounds](directional-bounds.md).                                                          |
| `bounds(relativeTo?: Model): ModelBounds`             | [Axis-aligned geometry bounds](bounds.md).                                                                       |
| `position(relativeTo: Model): Vec3`                   | [Origin position](position.md) in an explicit model frame.                                                       |
| `relate(build): ModelForKind<Elements, Kind>`         | [Placement relations](relate.md) built against the new callback value.                                           |
| `expose(sources)`                                     | [Named references](expose.md); returns `ModelForKind<MergedElements<Elements, ExposedElements<Sources>>, Kind>`. |
| `originOffset(dx, dy, dz)`                            | [Move local zero](origin-offset.md) by a finite displacement.                                                    |
| `originPoint(point: PointAnchor)`                     | [Place local zero at a reference](origin-point.md).                                                              |
| `rotate(x, y, z)`                                     | [Rotate local geometry](model-rotate.md) in degrees.                                                             |
| `material(value: Material \| string)`                 | [Capture appearance](material.md), including descendants of a group.                                             |

`ModelForKind<Elements, Kind>` maps each literal kind to its corresponding model
alias: solid → `SolidModel`, face → `FaceModel`, edge → `EdgeModel`, vertex →
`VertexModel`, group → `GroupModel`. A union of kinds distributes over those
results. It is a type-level result mapping, not a constructor or runtime guard.

`ModelElementKind<Kind>` maps face → `'face'`, edge → `'line'`, vertex → `'point'`,
and solid/group → `'frame'`. These anchor categories describe placement
interfaces; they are different from finite topology kinds.

## GeometryCapabilities and GeometryQueryCapabilities

`GeometryQueryCapabilities` extends `DirectionalBounds` with readonly
`center: PointAnchor`, the carried local bounding-box center. It is shared by
finite references and geometric models; it does not imply that a value can be
modified as a model.

`GeometryCapabilities<Elements, Kind extends ModelGeometryKind>` extends that
query interface with [originCenter()](origin-center.md),
[originVertex(id: VertexId)](origin-vertex.md), and
[scaled(factor: number)](scaled.md). All return `ModelForKind<Elements, Kind>`.
Groups have no such capability; their shared `bounds()` method can still measure
finite descendants.

## Topology capabilities

| Interface                     | Members added                                                | Inheritance               |
| ----------------------------- | ------------------------------------------------------------ | ------------------------- |
| `VertexTopologyCapabilities`  | `vertex(id): Vertex`, `vertices(ids?): readonly Vertex[]`    | None                      |
| `EdgeTopologyCapabilities`    | `edge(id): Edge`, `edges(ids?): readonly Edge[]`             | Vertex selection          |
| `SurfaceTopologyCapabilities` | `surface(id): Surface`, `surfaces(ids?): readonly Surface[]` | Edge and vertex selection |

IDs use the matching `VertexId`, `EdgeId` or `SurfaceId`; list arguments are
readonly arrays. Omission selects all available entries while `[]` selects none.
See [vertex](vertex.md), [edge](edge.md) and [surface](surface.md) for ownership,
ordering, hierarchical IDs and invalid selections.

These interfaces also occur on finite `Vertex`, `Edge`, `Surface` and `Solid`
references. A reference supports queries, not the originating model's creation
methods, material assignment or independent placement.

## SolidModificationCapabilities

`SolidModificationCapabilities<Elements>` contributes:

- [union(operands)](union.md), [intersect(operands)](intersect.md) and
  [cut(tools)](cut.md) accept a solid or a nonempty readonly array of solids and
  return `SolidModel` with the new solid's canonical references. The receiver
  is the first operand; the free functions keep their array parameters.
- [fillet(radius, edgeIds?): SolidModel<Elements>](fillet.md), preserving named elements.
- [chamfer(distance, edgeIds?): SolidModel<Elements>](chamfer.md), preserving named elements.
- [shell(thickness, removedSurfaceIds?): SolidModel<Elements>](shell.md), preserving named elements.

The selectors are readonly arrays of `EdgeId` or `SurfaceId`. The linked
references define geometric validation, default selections and topology changes.

## Face construction members

`FaceModel` adds these methods, all returning `SolidModel`:

- [extrude(distance: number)](extrude.md).
- [revolve(axis: LineAnchor, config: RevolveConfig)](revolve.md).
- [sweep(spine: EdgeModel<{}>)](sweep.md).
- [thicken(thickness: number)](thicken.md).

`flip()` instead returns a `Surface` reference; similarly `EdgeModel.reverse()`
returns an `Edge` reference. Neither is a new independently placeable model.

## Named elements and common vectors

`Vec3` is a readonly three-number XYZ tuple. Its units and frame come from the
receiving API: coordinates and offsets use model units, rotation vectors use
degrees. The type alone does not validate finiteness or normalize a direction.

The named-element types have their primary definitions on [expose](expose.md):
`NamedElements`, `ElementSources`, `ExposedValue`, `ExposedElements` and
`MergedElements`. Default `CanonicalElements` (`center`, `axis`),
`PlanarElements` (`center`, `plane`) and `CurveElements` (`start`, `midpoint`,
`end`) are explained with [reference elements](reference-elements.md).

`ModelBounds` belongs to [bounds](bounds.md), `DistanceAxis` to
[distance](distance.md), and `TopologyId` / `TopologyKind` to
[topology selection](vertex.md). For the difference between models, finite
references, frames and abstract anchors, see [reference elements](reference-elements.md).

## Value semantics

Operations return new values. Geometry, material, topology and relations on an
already observed model are preserved. Model values are not MobX view state;
measurement results are ordinary values captured at the call. Hosts own kernel
resources and disposal, while ordinary model code uses the authoring API.
See the [model values guide](../values.md) for composition and measurement examples.
