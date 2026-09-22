---
title: Model evaluation and lifetimes
description: Own serial evaluation scopes, identify model objects, retain geometry and dispose native resources.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/authoring-api.ts
      sha256: f19edb7d6875d7e407ff84f7c88ce7392df1aeb21cca65982f08d7ca44dd9f11
    - path: packages/core/src/library/kernel-cache.ts
      sha256: 779d4de9fa63c44633a16aac3c6e1125376dcc7483b0e6cf6d11d6970db87310
      commit: da2824c30b54a50ac216679fff96c67dd3dcee4c
    - path: packages/core/src/library/runtime.ts
      sha256: 1caf8c92de983f0c22b4da70e0af4216472b9ff8fe8e2f0ebc34ec9a84e259b0
sidebar:
  hidden: true
head:
  - tag: title
    content: Model evaluation and lifetimes — Code3D TypeScript API reference
---

Tooling hosts use these APIs to own serial evaluation scopes, identify model objects, retain geometry and dispose native resources.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {box} from '@code3d/core'; // Node initializes the runtime
import {
  beginModelEvaluation,
  createModelSnapshotter,
  isModelObject,
  retainModelGeometry,
  disposeModelObjects,
} from '@code3d/core/tooling';

const finish = beginModelEvaluation();
try {
  const model = box(20, 10, 8);
  if (!isModelObject(model)) throw new Error('Expected a model');
  const retained = retainModelGeometry([model]);
  try {
    const snapshot = createModelSnapshotter()(model);
    const topology = retained.inspect(model.nodeId, {kind: 'edge', limit: 12});
  } finally {
    retained.dispose();
    disposeModelObjects([model]);
  }
} finally {
  finish();
}
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## Evaluation scopes

`beginModelEvaluation(checkCancelled?)` starts a fresh serial evaluation, resets
source/operation traces and begins a protected kernel-cache working set. Its
returned function must run in `finally` **after** model snapshot/query work.
`checkCancelled` may throw before a kernel operation. Completed artifacts can
survive a later cancellation; ending the scope removes the cancellation hook.
This is not model disposal and does not invalidate previously observed geometry.

`beginModelInspection(checkCancelled?)` creates the corresponding inspection
cache scope without resetting authoring traces or replacing the retained model
working set. Serialize model and inspection executions sharing a kernel; these
global contexts are not independent concurrent sessions.

`authoringApi` is a frozen map of the built-in authoring functions used by host
execution and tooling. Its members below reference the ordinary APIs; it is not
the complete root export namespace (for example, `inspectGroupMembers` is not
part of that map). Normal authors import from `@code3d/core`.

## Runtime identities and graph traversal

`isModelObject(value)` guards Core model objects, including groups.
`isSolidModel(value)` narrows only solid model values. `isFrame(value)`
recognizes independent `Frame` values, including related copies, but not a
model's `.frame` anchor, exposed frame reference or Sketch. Neither guard accepts a
plain object merely because it has similarly named properties.
`modelObjectRuntimeInfo(object)` returns `nodeId`, `name` and source references
for diagnostics. `relatedModelObjects(object)` reports the runtime's related
participants; hosts must traverse and deduplicate the graph they retain or
release rather than assuming one exported object is the whole evaluation.

`RelationObject` and `ModelObject` are type-only exports, not constructor values
importable from the tooling entry. `RelationObject` is the base relation participant. Its public host members are
`nodeId`, `sourceRefs`, `parameters`, `solvePose(context)` and the static
`createSolveContext(roots, overrides?)`. A solve context belongs to its current
root graph; do not persist it across evaluations. Overrides use the runtime's
inferred placement records; most hosts should use snapshot and relation-preview
helpers instead of constructing those internal records.

`ModelObject<Elements, Kind>` extends it with model operations. Concrete geometry
support still depends on `Kind`; consult [model capabilities](model-types.md)
for common methods. The class declaration also includes static `centerOrigins(models)` for
multi-model recentering, but the constructor is not a tooling value export;
use public [originCenter](origin-center.md) in author code. `previewElement`
accepts a runtime stored reference and optional forward/both markers; prefer
[previewAnchorReference](tooling-snapshots.md#previewanchorreference) when holding
a public anchor. Private brands, fields and protected constructors are not host APIs.

### isFrame

```ts
function isFrame(value: unknown): value is FrameObject;
```

The narrowed implementation type is inferred from the guard, not a constructor
export from this tooling entry. It implements the public [Frame](frame.md)
contract and the runtime relation-participant members.

## Geometry ownership

`retainModelGeometry(objects)` clones and deduplicates the supplied models'
native geometry into an independent `ModelGeometrySnapshot`. Supply all geometry
objects needed later; the function does not recursively discover omitted group
members for you. `shapes` maps node IDs to **borrowed** native shapes: clone before
using any consuming or mutating Replicad operation.

`inspect(nodeId, options?)` queries retained B-rep topology and throws if that node
is absent or the snapshot has been disposed. [Topology inspection](tooling-topology.md)
explains options and results. `dispose()` releases owned clones and clears maps;
do not use the borrowed shapes afterward.

`disposeModelObjects(objects)` releases native model geometry, deduplicating
shared handles within that call. Dispose a shared graph in one call; separately
disposing material/relation copies can delete a shared handle twice. Do not
reuse author model objects after their geometry is disposed. Pass the complete set of runtime objects your
host owns when their evaluation is no longer needed. Keep retained snapshots
alive only as long as inspection/export requires, and dispose those separately.
Plain [render snapshots](tooling-snapshots.md) do not replace native ownership.

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### authoringApi

```ts
const authoringApi: Readonly<{
  frame: typeof frame;
  originCenter: typeof originCenter;
  input: typeof input;
  timeOffset: typeof timeOffset;
  dimension: typeof dimension;
  boundsAnnotation: typeof boundsAnnotation;
  anchorAnnotation: typeof anchorAnnotation;
  captureInspectData: typeof captureInspectData;
  offset: typeof offset;
  rotate: typeof rotate;
  pivot: typeof pivot;
  pivotVertex: typeof pivotVertex;
  pivotPoint: typeof pivotPoint;
  axisEdge: typeof axisEdge;
  axisLine: typeof axisLine;
  coupleRotation: typeof coupleRotation;
  on: typeof on;
  align: typeof align;
  cache: typeof cache;
  font: typeof font;
  googleFont: typeof googleFont;
  text: typeof text;
  sketch: typeof sketch;
  circle: typeof circle;
  ellipse: typeof ellipse;
  extrude: typeof extrude;
  rectangle: typeof rectangle;
  regularPolygon: typeof regularPolygon;
  point: typeof point;
  line: typeof line;
  arc: typeof arc;
  bezier: typeof bezier;
  spline: typeof spline;
  loft: typeof loft;
  revolve: typeof revolve;
  sweep: typeof sweep;
  wrap: typeof wrap;
  thicken: typeof thicken;
  box: typeof box;
  cylinder: typeof cylinder;
  tube: typeof tube;
  coil: typeof coil;
  sphere: typeof sphere;
  ellipsoid: typeof ellipsoid;
  frustum: typeof frustum;
  regularPrism: typeof regularPrism;
  group: typeof group;
  distance: typeof distance;
  union: typeof union;
  cut: typeof cut;
  intersect: typeof intersect;
}>;
```

### beginModelEvaluation

```ts
function beginModelEvaluation(checkCancelled?: () => void): () => void;
```

### beginModelInspection

```ts
function beginModelInspection(checkCancelled?: () => void): () => void;
```

### disposeModelObjects

```ts
function disposeModelObjects(objects: Iterable<RelationObject>): void;
```

### isModelObject

```ts
function isModelObject(value: unknown): value is ModelObject;
```

### isSolidModel

```ts
function isSolidModel(value: unknown): value is SolidModel<{}>;
```

### modelObjectRuntimeInfo

```ts
function modelObjectRuntimeInfo(object: RelationObject): ModelObjectRuntimeInfo;
```

### relatedModelObjects

```ts
function relatedModelObjects(object: RelationObject): readonly RelationObject[];
```

### retainModelGeometry

```ts
function retainModelGeometry(
  objects: Iterable<RelationObject>,
): ModelGeometrySnapshot;
```

### ModelObject

```ts
class ModelObject<
  Elements extends NamedElements = {},
  Kind extends ModelKind = ModelKind,
>
  extends RelationObject
  implements Anchor<ModelElementKind<Kind>>
{
  readonly metadata: ModelMetadata;
  withMetadata(metadata: ModelMetadata): RuntimeModel<Elements, Kind>;
  get length(): number;
  get area(): number;
  get volume(): number;
  get origin(): PointAnchor;
  get frame(): FrameAnchor;
  get up(): Bound;
  get down(): Bound;
  get left(): Bound;
  get right(): Bound;
  get front(): Bound;
  get back(): Bound;
  reverse(): Edge;
  flip(): Surface;
  relate(
    build: (
      self: RuntimeModel<Elements, Kind>,
    ) => Relation | readonly Relation[],
  ): RuntimeModel<Elements, Kind>;
  expose<const Sources extends ElementSources>(
    sources: Sources,
  ): RuntimeModel<MergedElements<Elements, ExposedElements<Sources>>, Kind>;
  bounds(relativeTo?: Model): ModelBounds;
  position(relativeTo: Model): Vec3;
  vertex(id: VertexId): Vertex;
  vertices(ids?: readonly VertexId[]): readonly Vertex[];
  edge(id: EdgeId): Edge;
  edges(ids?: readonly EdgeId[]): readonly Edge[];
  surface(id: SurfaceId): Surface;
  surfaces(ids?: readonly SurfaceId[]): readonly Surface[];
  material(material: Material | string): RuntimeModel<Elements, Kind>;
  originOffset(
    dx: number,
    dy: number,
    dz: number,
  ): RuntimeModel<Elements, Kind>;
  originPoint(point: PointAnchor): RuntimeModel<Elements, Kind>;
  originVertex(id: VertexId): RuntimeModel<Elements, Kind>;
  originCenter(): RuntimeModel<Elements, Kind>;
  static centerOrigins(models: readonly ModelObject[]): readonly ModelObject[];
  rotate(x: number, y: number, z: number): RuntimeModel<Elements, Kind>;
  scaled(factor: number): RuntimeModel<Elements, Kind>;
  thicken(this: ModelObject<Elements, 'face'>, thickness?: number): SolidModel;
  extrude(this: ModelObject<Elements, 'face'>, distance: number): SolidModel;
  revolve(
    this: ModelObject<Elements, 'face'>,
    axis: LineAnchor,
    config?: RevolveConfig,
  ): SolidModel;
  sweep(this: ModelObject<Elements, 'face'>, spine: EdgeModel<{}>): SolidModel;
  cut(
    this: ModelObject<Elements, 'solid'>,
    tools: readonly SolidModel<{}>[],
  ): SolidModel;
  fillet(
    this: ModelObject<Elements, 'solid'>,
    radius: number,
    edgeIds?: readonly EdgeId[],
  ): SolidModel<Elements>;
  chamfer(
    this: ModelObject<Elements, 'solid'>,
    distance: number,
    edgeIds?: readonly EdgeId[],
  ): SolidModel<Elements>;
  shell(
    this: ModelObject<Elements, 'solid'>,
    thickness: number,
    removedSurfaceIds?: readonly SurfaceId[],
  ): SolidModel<Elements>;
  previewElement(
    reference: StoredAnchor,
    direction?: 'forward' | 'both',
  ): ElementSnapshot;
}
```

### ModelObjectRuntimeInfo

```ts
type ModelObjectRuntimeInfo = Readonly<{
  nodeId: string;
  name: string;
  sourceRefs: readonly SourceRef[];
}>;
```

### ModelGeometrySnapshot

```ts
type ModelGeometrySnapshot = Readonly<{
  /** Borrowed shapes; clone before passing them to consuming operations. */
  shapes: ReadonlyMap<string, AnyShape>;
  inspect(
    nodeId: string,
    options?: TopologyInspectionOptions,
  ): TopologyInspection;
  dispose(): void;
}>;
```

### ModelKind

Re-exported authoring type. See [ModelKind](model-types.md) for its complete contract and member behavior.

### ModelGeometryKind

Re-exported authoring type. See [ModelGeometryKind](model-types.md) for its complete contract and member behavior.

### RelationObject

```ts
abstract class RelationObject {
  readonly nodeId: string;
  get sourceRefs(): SourceRef[];
  get parameters(): ParameterUsage[];
  solvePose(context: SolveContext): RigidTransform;
  static createSolveContext(
    roots: readonly RelationObject[],
    overrides?: Map<RelationObject, readonly StoredPlacement[]>,
  ): SolveContext;
}
```
