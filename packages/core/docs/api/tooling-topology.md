---
title: Topology IDs and retained inspection
description: Compare hierarchical topology IDs and query paged native geometry from a retained model snapshot.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/topology-id.ts
      sha256: 49b2812aa89e5a886759166c89e32cf01a629fe888bcc57452ede2feeba7dc01
      commit: 904463d8c4405f4a2b1c073ba9a5edc997732e23
    - path: packages/core/src/library/topology-inspection.ts
      sha256: e9733df5345946fd5d3ec73e9f947b4d3e020f461dd15d12231b53c2c3771813
      commit: 4bc8579ec313ab4fb9acc42b06ff9e744725688f
sidebar:
  hidden: true
head:
  - tag: title
    content: Topology IDs and retained inspection — Code3D TypeScript API reference
---

Tooling hosts use these APIs to compare hierarchical topology IDs and query paged native geometry from a retained model snapshot.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {
  TopologyIdSet,
  formatTopologyId,
  compareTopologyIds,
} from '@code3d/core/tooling';

const selection = new TopologyIdSet([1, [2, 3], [2, 3]]);
const hasInherited = selection.has([2, 3]); // true: value equality
const ids = [...selection].sort(compareTopologyIds);
const labels = ids.map(id => formatTopologyId('edge', id)); // E1, E[2,3]
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## ID utilities

`TopologyId` is a positive safe integer or a flat path of at least two positive
safe integers. `VertexId`, `EdgeId` and `SurfaceId` are aliases, not globally
unique brands. `TopologyKind` is `'vertex' | 'edge' | 'surface'`. An ID is meaningful
only with its owning model and kind; see [topology selection](vertex.md).

| Function                          | Meaning                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `isTopologyId(value)`             | Validate the scalar/path structure and positive safe integers.                             |
| `topologyIdKey(id)`               | String key, using `/` between path components.                                             |
| `sameTopologyId(left, right)`     | Value equality for IDs; two `undefined` values also compare equal.                         |
| `compareTopologyIds(left, right)` | Numeric IDs before paths; paths compare numeric components lexicographically, then length. |
| `formatTopologyId(kind, id)`      | Display labels such as `V1`, `E[2,3]` or `S4`.                                             |

`TopologyIdSet(ids = [])` provides value-based uniqueness for reconstructed paths.
Its `size`, `has`, `add` (returns this), `delete` (boolean), `clear` and
`[Symbol.iterator]()` follow the corresponding set-style operations. Iteration
uses insertion order, not sorted topology order. `add` stores the supplied ID;
treat path arrays as immutable and validate untrusted IDs before adding them.

## Retained inspection

Obtain a [ModelGeometrySnapshot](tooling-evaluation.md#geometry-ownership), then
call its `inspect(nodeId, options?)` while retained geometry is alive. The query
uses actual B-rep geometry and its topology namespace rather than display meshes.
It returns plain data and releases its temporary native query shapes.

`TopologyInspectionOptions` accepts optional `kind`, `ids`, `offset`, `limit` and
`transform`. An ID filter requires a kind and all requested IDs must exist.
Offset defaults to 0 and must be a nonnegative safe integer; limit defaults to
48 and must be an integer from 1 to 200. Transform defaults to identity; optional
scale must be uniform, finite and nonzero. Supply a normalized quaternion.

`TopologyInspection.counts` describes each kind's total native count, while
`total` is the filtered result count. `offset` and optional `nextOffset` describe
pagination. `bounds` provides min/max/size with method `'kernel-enclosure'`;
these conservative kernel bounds differ from the author's tight bounds query.
`units: 'model'`, `coordinates: 'scene'`, `geometrySource: 'kernel'` and the
applied transform make the coordinate convention explicit.

## Geometry records

Every `TopologyInspectionItem` identifies `kind` and `id`, may list adjacent
vertices/edges/surfaces, and has either available `geometry` or an `unavailable`
message from a failed individual kernel query. An unavailable item does not
invalidate the entire page.

`TopologyGeometry.type` names the native analytic kind. Optional fields describe
point position; edge length/endpoints/closedness/direction; face area/centroid;
and analytic center/axis/radius or ellipse major/minor radii. Only fields relevant
to the actual geometry are present. Planar faces may provide `normal`.
Curved faces may instead provide `normalSample` at the UV-domain midpoint,
explicitly marked `trimMembership: 'unchecked'`; do not claim that sample lies
inside the trimmed face. The exact optional structures are listed below.

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### TopologyGeometry

```ts
type TopologyGeometry = {
  type: string;
  position?: Vec3;
  length?: number;
  area?: number;
  centroid?: Vec3;
  start?: Vec3;
  end?: Vec3;
  closed?: boolean;
  direction?: Vec3;
  normal?: Vec3;
  normalSample?: {
    position: Vec3;
    normal: Vec3;
    method: 'uv-domain-midpoint';
    trimMembership: 'unchecked';
  };
  center?: Vec3;
  axis?: Vec3;
  radius?: number;
  majorRadius?: number;
  minorRadius?: number;
};
```

### TopologyInspection

```ts
type TopologyInspection = Readonly<{
  counts: Record<TopologyKind, number>;
  bounds: {
    min: Vec3;
    max: Vec3;
    size: Vec3;
    method: 'kernel-enclosure';
  };
  total: number;
  offset: number;
  nextOffset?: number;
  items: readonly TopologyInspectionItem[];
  units: 'model';
  coordinates: 'scene';
  geometrySource: 'kernel';
  transform: NonNullable<TopologyInspectionOptions['transform']>;
}>;
```

### TopologyInspectionItem

```ts
type TopologyInspectionItem = {
  kind: TopologyKind;
  id: TopologyId;
  geometry?: TopologyGeometry;
  vertices?: readonly TopologyId[];
  edges?: readonly TopologyId[];
  surfaces?: readonly TopologyId[];
  unavailable?: string;
};
```

### TopologyInspectionOptions

```ts
type TopologyInspectionOptions = Readonly<{
  kind?: TopologyKind;
  ids?: readonly TopologyId[];
  offset?: number;
  limit?: number;
  transform?: RigidTransform & {
    scale?: Vec3;
  };
}>;
```

### EdgeId

Re-exported authoring type. See [EdgeId](edge.md) for its complete contract and member behavior.

### SurfaceId

Re-exported authoring type. See [SurfaceId](surface.md) for its complete contract and member behavior.

### TopologyId

Re-exported authoring type. See [TopologyId](vertex.md) for its complete contract and member behavior.

### TopologyKind

Re-exported authoring type. See [TopologyKind](vertex.md) for its complete contract and member behavior.

### VertexId

Re-exported authoring type. See [VertexId](vertex.md) for its complete contract and member behavior.

### TopologyIdSet

```ts
class TopologyIdSet implements Iterable<TopologyId> {
  constructor(ids?: Iterable<TopologyId>);
  get size(): number;
  has(id: TopologyId): boolean;
  add(id: TopologyId): this;
  delete(id: TopologyId): boolean;
  clear(): void;
  [Symbol.iterator](): IterableIterator<TopologyId>;
}
```

### compareTopologyIds

```ts
function compareTopologyIds(left: TopologyId, right: TopologyId): number;
```

### formatTopologyId

```ts
function formatTopologyId(kind: TopologyKind, id: TopologyId): string;
```

### isTopologyId

```ts
function isTopologyId(value: unknown): value is TopologyId;
```

### sameTopologyId

```ts
function sameTopologyId(
  left: TopologyId | undefined,
  right: TopologyId | undefined,
): boolean;
```

### topologyIdKey

```ts
function topologyIdKey(id: TopologyId): string;
```
