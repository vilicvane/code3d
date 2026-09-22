---
title: Model operations and snapshots
description: Capture model trees, source traces, reference geometry and batched mesh or bounds queries for host integration.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/kernel-cache.ts
      sha256: 779d4de9fa63c44633a16aac3c6e1125376dcc7483b0e6cf6d11d6970db87310
      commit: da2824c30b54a50ac216679fff96c67dd3dcee4c
    - path: packages/core/src/library/runtime.ts
      sha256: e3658b0ffa55da9d2c612f442ce1d5f190923aea1870122823677faa60fb0b84
      commit: 3d2db0c82c1ae0e6723ecd77fa6f571b326d1681
    - path: packages/core/src/library/topology.ts
      sha256: f9f0d048fe30cc80046a25123aa8101ca51e85cdb5b2e66260c6a68f43f84715
      commit: 67228dd8559d584852df7bfbd47ed89f1d8003e9
sidebar:
  hidden: true
head:
  - tag: title
    content: Model operations and snapshots — Code3D TypeScript API reference
---

Tooling hosts use these APIs to capture model trees, source traces, reference geometry and batched mesh or bounds queries for host integration.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {box} from '@code3d/core';
import {
  isModelObject,
  createModelSnapshotter,
  modelElementReference,
  modelTopologyIds,
  modelTopologyReference,
  disposeModelObjects,
} from '@code3d/core/tooling';

const model = box(20, 10, 8);
if (isModelObject(model)) {
  try {
    const snapshot = createModelSnapshotter()(model);
    const frame = modelElementReference(model.frame);
    const edgeIds = modelTopologyIds(model, 'edge');
    const edge = modelTopologyReference(model.edge(edgeIds![0]));
  } finally {
    disposeModelObjects([model]);
  }
}
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## Snapshot and reference access

`createModelSnapshotter()` returns a function accepting `RelationObject` and
producing `ModelSnapshotObject`. Reuse that function within one snapshot pass to
share its mesh cache; create a fresh one for a new host pass. The result tree
contains models and reference nodes. A root's `transform` uses model-local
coordinates; `compositionTransform` records placement when composed.

`modelElementReference(value)` recognizes a named model anchor and returns its
owner, name, element kind, transform and optional bound/direction/facing fields.
`modelTopologyReference(value)` recognizes a finite topology reference and adds
the actual geometry owner and selection. Each returns `undefined` for an
unsupported value rather than coercing arbitrary objects.

`modelTopologyIds(value, kind)` queries IDs available from a model, finite
reference or relation expression's self; unsupported/non-geometric values yield
`undefined`. IDs belong to that geometry namespace and topology kind.
`previewAnchorReference(value, direction?)` accepts a model or reference and
returns its owner, actual geometry objects and element snapshots, including
parts of an exposed group. Direction is `'none'`, `'forward'` or `'both'`.
It prepares reference preview data and does not change the model.

## Instrumentation and record fields

`instrumentModelOperation(object, instrumentation)` records the current source
site, execution index, authored order and parameter dependencies. `outputIndex`
distinguishes multiple model results from the same invocation. `SourceRef`
contains the source `file`, inclusive start offset and exclusive end offset in
JavaScript/TypeScript string positions; retain the same source version when
using them. `ParameterTarget` identifies a named numeric source target;
`ParameterUsage` links its value, operation/expression source spans and
`sensitivity` to one operation argument.

`ModelOperationSnapshot` records output identity, ordered inputs with roles,
selected topology, optional source/spatial data and authored dimensions.
`ModelOperationKind` and `ModelOperationInputRole` enumerate all supported
branches below; do not infer operation semantics from display names.
Selections express input geometry in the operation output's frame. Dimension
`origin` and `vector` use that same local frame.

`ElementSnapshot` describes named points, lines, faces or frames, with optional
bounds, orientation markers and finite topology. `ModelSpatialOperation` records
authored coordinates/offsets/angles plus optional relation frame and rotation
reference. `Transform` has position, quaternion and XYZ scale; unlike a
`RigidTransform`, it may represent scale.

## Render meshes

`RenderMesh.vertices`, `normals` and optional `uvs` are tessellation arrays;
`triangles` indexes triangles and `edges` contains display edge segments.
`topologyVertices` are native topology points aligned with `vertexIds`.
`surfaceGroups` and `edgeGroups` associate draw ranges with actual topology IDs;
edge `linear` marks straight references suitable for rotation axes. Native face
UVs are normalized per tessellated face. Render triangulation indices are not
topology IDs and should not be used to infer B-rep connectivity.

## Batched snapshot queries

`planModelSnapshotQueries(objects)` prepares needed geometry queries grouped by
shared native input. A `SnapshotQueryBatch` has `id`, ordered `queries`, scheduling
`weight`, optional `sourceRef`, `encode()` and `accept(...)`. `weight` is a host
scheduling estimate, not a geometry measurement. Call `encode()` while its
source geometry is alive; it serializes the required input to transferable bytes.

In an initialized Worker/runtime, call `executeSnapshotQueryBatch(id, bytes,
queries, checkCancelled, onResult, onRestore?)`. The batch owns its restored
native shape and releases it in `finally`. `onRestore(milliseconds)` measures
input restoration. Each `onResult(query, value, milliseconds)` receives completed
computation before the next cancellation check; transport it to the originating
host and call that batch's `accept(query, value, milliseconds)` to populate the
shared cache. Reuse the exact query and batch identities; native handles do not
cross the Worker boundary.

`SnapshotQuery` discriminates `'bounds'` (transform, topology selection, uniform
scale) from `'mesh'` (tolerance, topology flag). Every query carries its cache
key (`id`, `signature`). A bounds result is the tuple `readonly [minimum: Vec3, maximum: Vec3]`;
a mesh result is `RenderMesh`. Match result shape to the query kind. Topology
selections are `{kind: 'solid'}` or a vertex/edge/surface kind plus its ID;
these structural helper names in signatures are inferred, not extra tooling exports.

Keep evaluation open through query completion and final snapshots, then follow
[geometry lifetime cleanup](tooling-evaluation.md). The declarations below list
every optional field and union branch of the public records.

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### createModelSnapshotter

```ts
function createModelSnapshotter(): (
  object: RelationObject,
) => ModelSnapshotObject;
```

### executeSnapshotQueryBatch

```ts
function executeSnapshotQueryBatch(
  id: string,
  bytes: Uint8Array,
  queries: readonly SnapshotQuery[],
  checkCancelled: () => void,
  onResult: (
    query: SnapshotQuery,
    value: SnapshotQueryResult,
    milliseconds: number,
  ) => void,
  onRestore?: (milliseconds: number) => void,
): void;
```

### instrumentModelOperation

```ts
function instrumentModelOperation(
  object: RelationObject,
  instrumentation: ModelOperationInstrumentation,
): void;
```

### modelElementReference

```ts
function modelElementReference(
  value: unknown,
): ModelElementReference | undefined;
```

### previewAnchorReference

```ts
function previewAnchorReference(
  value: unknown,
  direction?: 'none' | 'forward' | 'both',
):
  | Readonly<{
      model: RelationObject;
      geometries: readonly ModelObject[];
      elements: readonly ElementSnapshot[];
    }>
  | undefined;
```

### modelTopologyIds

```ts
function modelTopologyIds(
  value: unknown,
  kind: TopologyKind,
): readonly TopologyId[] | undefined;
```

### modelTopologyReference

```ts
function modelTopologyReference(
  value: unknown,
): ModelTopologyReference | undefined;
```

### planModelSnapshotQueries

```ts
function planModelSnapshotQueries(
  objects: readonly RelationObject[],
): SnapshotQueryBatch[];
```

### ElementKind

Re-exported authoring type. See [ElementKind](reference-elements.md) for its complete contract and member behavior.

### ElementSnapshot

```ts
type ElementSnapshot = Readonly<{
  name: string;
  kind: ElementKind;
  transform: Transform;
  bound?: Readonly<{
    size: readonly [number, number];
    facing: 1 | -1;
  }>;
  facing?: 1 | -1;
  direction?: 1 | -1;
  arrows?: readonly RigidTransform[];
  topology?: Readonly<{
    geometryNodeId: string;
    transform: Transform;
  }> &
    TopologySelection;
}>;
```

### ModelElementReference

```ts
type ModelElementReference = Readonly<{
  model: RelationObject;
  name: string;
  kind: ElementKind;
  transform: Transform;
  bound?: ElementSnapshot['bound'];
  facing?: 1 | -1;
  direction?: 1 | -1;
}>;
```

### ModelOperationInputRole

```ts
type ModelOperationInputRole =
  | 'source'
  | 'receiver'
  | 'operand'
  | 'tool'
  | 'child'
  | 'collection'
  | 'reference'
  | 'section'
  | 'spine';
```

### ModelOperationInstrumentation

```ts
type ModelOperationInstrumentation = Readonly<{
  siteId: string;
  execution: number;
  /** Distinguishes operation results produced by the same call execution. */
  outputIndex?: number;
  order: number;
  sourceRef: SourceRef;
  parameters: readonly ParameterUsage[];
}>;
```

### ModelOperationKind

```ts
type ModelOperationKind =
  | 'sketch'
  | 'box'
  | 'cylinder'
  | 'tube'
  | 'coil'
  | 'sphere'
  | 'ellipsoid'
  | 'frustum'
  | 'regularPrism'
  | 'circle'
  | 'ellipse'
  | 'rectangle'
  | 'regularPolygon'
  | 'point'
  | 'line'
  | 'arc'
  | 'bezier'
  | 'spline'
  | 'loft'
  | 'sketchFace'
  | 'text'
  | 'extrude'
  | 'revolve'
  | 'sweep'
  | 'wrap'
  | 'thicken'
  | 'primitive'
  | 'material'
  | 'scaled'
  | 'originOffset'
  | 'originVertex'
  | 'originPoint'
  | 'originCenter'
  | 'rotate'
  | 'fillet'
  | 'chamfer'
  | 'shell'
  | 'relate'
  | 'expose'
  | 'group'
  | 'union'
  | 'cut'
  | 'intersect';
```

### ModelOperationSelectionSnapshot

```ts
type ModelOperationSelectionSnapshot = Readonly<{
  kind: TopologyKind;
  inputNodeId: string;
  ids: readonly TopologyId[];
  /** Input geometry coordinates expressed in the operation output's frame. */
  transform: Transform;
}>;
```

### ModelOperationSnapshot

```ts
type ModelOperationSnapshot = Readonly<{
  id: string;
  siteId?: string;
  execution?: number;
  kind: ModelOperationKind;
  order?: number;
  outputNodeId: string;
  inputs: readonly Readonly<{
    nodeId: string;
    role: ModelOperationInputRole;
    index: number;
  }>[];
  selections: readonly ModelOperationSelectionSnapshot[];
  sourceRef?: SourceRef;
  spatial?: ModelSpatialOperation;
  /** Authored dimensions in the operation output's local geometry frame. */
  dimensions?: Readonly<Record<string, ModelParameterDimension>>;
}>;
```

### ModelParameterDimension

```ts
type ModelParameterDimension = Readonly<{
  origin: Vec3;
  vector: Vec3;
}>;
```

### ModelSnapshotObject

```ts
type ModelSnapshotObject = Readonly<{
  nodeId: string;
  /** Original author geometry retained in an inspection frame, for tool binding. */
  sourceNodeId?: string;
  name: string;
  /** Effective material, including recursive overrides from enclosing groups. */
  material?: ModelMaterialSnapshot;
  children: readonly ModelSnapshotObject[];
  /** Placement used when this snapshot participates in a composition. */
  compositionTransform: Transform;
  /** Placement in this snapshot tree; a root value uses model-local coordinates. */
  transform: Transform;
  constraints: readonly ConstraintSnapshot[];
  transformations?: readonly TransformationSnapshot[];
  relationStages?: readonly RelationStageSnapshot[];
  elements: readonly ElementSnapshot[];
  origin: Vec3;
  sourceRefs: readonly SourceRef[];
  parameters: readonly ParameterUsage[];
  operation: ModelOperationSnapshot;
}> &
  (
    | Readonly<{
        kind: ModelKind;
        mesh?: RenderMesh;
      }>
    | Readonly<{
        kind: 'reference';
        mesh?: never;
      }>
  );
```

### ModelSpatialOperation

```ts
type ModelSpatialOperation = Readonly<{
  origin: Vec3;
  vector: Vec3;
  /** Relation edits use self's frame at this authored operation. */
  frame?: RigidTransform;
  rotation?: Vec3;
  axisOnly?: boolean;
  reference?: RotationReferenceSnapshot;
}>;
```

### ModelTopologyReference

```ts
type ModelTopologyReference = Readonly<{
  model: RelationObject;
  geometry: ModelObject;
  transform: Transform;
}> &
  TopologySelection;
```

### ParameterKind

```ts
type ParameterKind = 'length' | 'angle' | 'ratio' | 'count' | 'scalar';
```

### ParameterTarget

```ts
type ParameterTarget = Readonly<{
  id: string;
  label: string;
  kind: ParameterKind;
  value: number;
  sourceRef: SourceRef;
}>;
```

### ParameterUsage

```ts
type ParameterUsage = Readonly<{
  operation: string;
  argument: string;
  value: number;
  operationRef: SourceRef;
  expressionRef: SourceRef;
  target: ParameterTarget;
  sensitivity: number;
}>;
```

### RenderMesh

```ts
type RenderMesh = Readonly<{
  /** Tessellation vertices used by the triangle mesh. */
  vertices: Float32Array;
  normals: Float32Array;
  /** Native face UVs normalized to each tessellated face's range. */
  uvs?: Float32Array;
  triangles: Uint32Array;
  edges: Float32Array;
  /** OpenCascade topology vertices, aligned with vertexIds. */
  topologyVertices: Float32Array;
  vertexIds: readonly VertexId[];
  surfaceGroups: readonly Readonly<{
    start: number;
    count: number;
    surfaceId: SurfaceId;
  }>[];
  edgeGroups: readonly Readonly<{
    start: number;
    count: number;
    edgeId: EdgeId;
    /** True for native straight edges, suitable as rotation references. */
    linear?: boolean;
  }>[];
}>;
```

### SnapshotQuery

```ts
type SnapshotQuery = Readonly<{
  key: KernelOperationKey;
}> &
  (
    | Readonly<{
        kind: 'bounds';
        transform: RigidTransform;
        selection: TopologySelection;
        scale: number;
      }>
    | Readonly<{
        kind: 'mesh';
        tolerance: number;
        topology: boolean;
      }>
  );
```

### SnapshotQueryBatch

```ts
type SnapshotQueryBatch = Readonly<{
  id: string;
  queries: readonly SnapshotQuery[];
  weight: number;
  sourceRef?: SourceRef;
  encode(): Uint8Array;
  accept(
    query: SnapshotQuery,
    value: SnapshotQueryResult,
    milliseconds: number,
  ): void;
}>;
```

### SnapshotQueryResult

```ts
type SnapshotQueryResult = LocalBounds | RenderMesh;
```

### SourceRef

```ts
type SourceRef = Readonly<{
  file: string;
  start: number;
  end: number;
}>;
```

### Transform

```ts
type Transform = Readonly<{
  position: Vec3;
  quaternion: Quaternion;
  scale: Vec3;
}>;
```
