import {
  cast,
  getOC,
  iterTopo,
  type AnyShape,
  type Edge as ReplicadEdge,
  type Face as ReplicadFace,
  type Shape3D,
  type Vertex as ReplicadVertex,
} from 'replicad';
import type {
  NCollection_List_TopoDS_Shape,
  TopoDS_Shape,
} from 'replicad-opencascadejs';

export type VertexId = number;
export type EdgeId = number;
export type SurfaceId = number;

export type TopologyKind = 'vertex' | 'edge' | 'surface';

type StableTopology<Id extends number> = Readonly<{
  /** Stable IDs aligned with the corresponding shape traversal order. */
  ids: readonly Id[];
  /** High-water mark. Retired IDs below this value are never reused. */
  nextId: Id;
}>;

export type VertexTopology = StableTopology<VertexId>;
export type EdgeTopology = StableTopology<EdgeId>;
export type SurfaceTopology = StableTopology<SurfaceId>;

export type ShapeTopology = Readonly<{
  vertices: VertexTopology;
  edges: EdgeTopology;
  surfaces: SurfaceTopology;
}>;

export type VertexRenderData = Readonly<{
  positions: Float32Array;
  ids: readonly VertexId[];
}>;

export type EdgeModificationResult = Readonly<{
  shape: Shape3D;
  topology: ShapeTopology;
  selectedEdgeIds: readonly EdgeId[];
}>;

export type BooleanTopologyOperation = 'cut' | 'fuse' | 'intersect';

export type BooleanTopologyResult = Readonly<{
  shape: Shape3D;
  topology: ShapeTopology;
}>;

export type TopologyPointData = Readonly<{
  position: readonly [x: number, y: number, z: number];
}>;

export type TopologyDirectionData = TopologyPointData &
  Readonly<{
    direction: readonly [x: number, y: number, z: number];
  }>;

type ShapeHistory = Readonly<{
  Modified(shape: TopoDS_Shape): NCollection_List_TopoDS_Shape;
}>;

type TopologyShape = Readonly<{
  wrapped: TopoDS_Shape;
  hashCode: number;
  delete(): void;
}>;

type RawEdgeGroup = Readonly<{
  start: number;
  count: number;
  edgeId: number;
}>;

type RawSurfaceGroup = Readonly<{
  start: number;
  count: number;
  faceId: number;
}>;

type StableSurfaceGroup = Readonly<{
  start: number;
  count: number;
  surfaceId: SurfaceId;
}>;

type LocalEdgeOperation = Readonly<{
  NbContours(): number;
  NbEdges(index: number): number;
}>;

export function initialShapeTopology(shape: AnyShape): ShapeTopology {
  const vertices = shapeVertices(shape);
  const edges = shape.edges;
  const surfaces = shape.faces;
  try {
    return shapeTopology(
      initialTopology(vertices) as VertexTopology,
      initialTopology(edges) as EdgeTopology,
      initialTopology(surfaces) as SurfaceTopology,
    );
  } finally {
    deleteShapes(vertices);
    deleteShapes(edges);
    deleteShapes(surfaces);
  }
}

export function preserveShapeTopology(
  shape: AnyShape,
  source: ShapeTopology,
): ShapeTopology {
  const vertices = shapeVertices(shape);
  const edges = shape.edges;
  const surfaces = shape.faces;
  try {
    assertTopologyLength('vertex', vertices, source.vertices);
    assertTopologyLength('edge', edges, source.edges);
    assertTopologyLength('surface', surfaces, source.surfaces);
    return shapeTopology(
      stableTopology(source.vertices.ids, source.vertices.nextId),
      stableTopology(source.edges.ids, source.edges.nextId),
      stableTopology(source.surfaces.ids, source.surfaces.nextId),
    );
  } finally {
    deleteShapes(vertices);
    deleteShapes(edges);
    deleteShapes(surfaces);
  }
}

export function filletEdges(
  shape: Shape3D,
  source: ShapeTopology,
  radius: number,
  edgeIds?: readonly EdgeId[],
): EdgeModificationResult {
  return modifyEdges('fillet', shape, source, radius, edgeIds);
}

export function chamferEdges(
  shape: Shape3D,
  source: ShapeTopology,
  distance: number,
  edgeIds?: readonly EdgeId[],
): EdgeModificationResult {
  return modifyEdges('chamfer', shape, source, distance, edgeIds);
}

export function booleanWithTopology(
  left: Shape3D,
  right: Shape3D,
  operation: BooleanTopologyOperation,
  source: ShapeTopology,
): BooleanTopologyResult {
  const oc = getOC();
  const builder =
    operation === 'fuse'
      ? new oc.BRepAlgoAPI_Fuse(left.wrapped, right.wrapped)
      : operation === 'cut'
        ? new oc.BRepAlgoAPI_Cut(left.wrapped, right.wrapped)
        : new oc.BRepAlgoAPI_Common(left.wrapped, right.wrapped);
  let result: Shape3D | undefined;
  try {
    builder.Build();
    builder.SimplifyResult(true, true, 0.001);
    result = castShape3D(builder.Shape());
    return {
      shape: result,
      topology: transferShapeTopology(left, source, result, builder),
    };
  } catch (error) {
    result?.delete();
    throw error;
  } finally {
    builder.delete();
  }
}

export function stableEdgeGroups(
  shape: AnyShape,
  topology: EdgeTopology,
  groups: readonly RawEdgeGroup[],
): readonly RawEdgeGroup[] {
  const edges = shape.edges;
  try {
    const ids = stableGroupIds(
      'edge',
      edges,
      topology,
      groups.map(group => group.edgeId),
    );
    return groups.map((group, index) => ({...group, edgeId: ids[index]}));
  } finally {
    deleteShapes(edges);
  }
}

export function stableSurfaceGroups(
  shape: AnyShape,
  topology: SurfaceTopology,
  groups: readonly RawSurfaceGroup[],
): readonly StableSurfaceGroup[] {
  const surfaces = shape.faces;
  try {
    const ids = stableGroupIds(
      'surface',
      surfaces,
      topology,
      groups.map(group => group.faceId),
    );
    return groups.map((group, index) => ({
      start: group.start,
      count: group.count,
      surfaceId: ids[index],
    }));
  } finally {
    deleteShapes(surfaces);
  }
}

export function stableVertexData(
  shape: AnyShape,
  topology: VertexTopology,
): VertexRenderData {
  const vertices = shapeVertices(shape);
  try {
    assertTopologyLength('vertex', vertices, topology);
    return {
      positions: new Float32Array(vertices.flatMap(vertex => vertex.asTuple())),
      ids: [...topology.ids],
    };
  } finally {
    deleteShapes(vertices);
  }
}

export function resolveEdgeSelection(
  topology: EdgeTopology,
  requestedIds: readonly EdgeId[] | undefined,
): readonly EdgeId[] {
  if (requestedIds === undefined) {
    return [...topology.ids];
  }
  if (requestedIds.length === 0) {
    throw new Error(
      'An edge selection cannot be empty; omit the second argument to select all edges.',
    );
  }
  const requested = new Set<EdgeId>();
  for (const edgeId of requestedIds) {
    assertTopologyId('edge', edgeId);
    requested.add(edgeId);
  }
  const selected = topology.ids.filter(edgeId => requested.has(edgeId));
  const missing = [...requested].filter(edgeId => !selected.includes(edgeId));
  if (missing.length > 0) {
    throw new Error(
      `Unknown or retired edge ${missing.map(edgeId => `E${edgeId}`).join(', ')}.`,
    );
  }
  return selected;
}

export function topologyVertexPoints(
  shape: AnyShape,
  topology: VertexTopology,
  vertexIds: readonly VertexId[],
): readonly TopologyPointData[] {
  const vertices = shapeVertices(shape);
  try {
    assertTopologyLength('vertex', vertices, topology);
    return vertexIds.map(vertexId => ({
      position:
        vertices[resolveTopologyIndex('vertex', topology, vertexId)].asTuple(),
    }));
  } finally {
    deleteShapes(vertices);
  }
}

export function topologyEdgeDirections(
  shape: AnyShape,
  topology: EdgeTopology,
  edgeIds: readonly EdgeId[],
): readonly TopologyDirectionData[] {
  const edges = shape.edges;
  try {
    assertTopologyLength('edge', edges, topology);
    return edgeIds.map(edgeId => {
      const edge = edges[resolveTopologyIndex('edge', topology, edgeId)];
      const point = edge.pointAt(0.5);
      const tangent = edge.tangentAt(0.5);
      try {
        return {position: point.toTuple(), direction: tangent.toTuple()};
      } finally {
        point.delete();
        tangent.delete();
      }
    });
  } finally {
    deleteShapes(edges);
  }
}

export function topologySurfaceDirections(
  shape: AnyShape,
  topology: SurfaceTopology,
  surfaceIds: readonly SurfaceId[],
): readonly TopologyDirectionData[] {
  const surfaces = shape.faces;
  try {
    assertTopologyLength('surface', surfaces, topology);
    return surfaceIds.map(surfaceId => {
      const surface =
        surfaces[resolveTopologyIndex('surface', topology, surfaceId)];
      const center = surface.center;
      const normal = surface.normalAt(center);
      try {
        return {position: center.toTuple(), direction: normal.toTuple()};
      } finally {
        center.delete();
        normal.delete();
      }
    });
  } finally {
    deleteShapes(surfaces);
  }
}

function modifyEdges(
  kind: 'fillet' | 'chamfer',
  shape: Shape3D,
  source: ShapeTopology,
  amount: number,
  requestedIds?: readonly EdgeId[],
): EdgeModificationResult {
  const selectedEdgeIds = resolveEdgeSelection(source.edges, requestedIds);
  if (selectedEdgeIds.length === 0) {
    const result = shape.clone();
    try {
      return {
        shape: result,
        topology: preserveShapeTopology(result, source),
        selectedEdgeIds,
      };
    } catch (error) {
      result.delete();
      throw error;
    }
  }

  const edges = shape.edges;
  const selected = new Set(selectedEdgeIds);
  const oc = getOC();
  const builder =
    kind === 'fillet'
      ? new oc.BRepFilletAPI_MakeFillet(
          shape.wrapped,
          oc.ChFi3d_FilletShape.ChFi3d_Rational,
        )
      : new oc.BRepFilletAPI_MakeChamfer(shape.wrapped);
  let result: Shape3D | undefined;
  try {
    assertTopologyLength('edge', edges, source.edges);
    edges.forEach((edge, index) => {
      if (selected.has(source.edges.ids[index])) {
        builder.Add(amount, edge.wrapped);
      }
    });
    builder.Build();
    if (!builder.IsDone()) {
      throw edgeModificationError(kind, amount, selectedEdgeIds, builder);
    }
    result = castShape3D(builder.Shape());
    return {
      shape: result,
      topology: transferShapeTopology(shape, source, result, builder),
      selectedEdgeIds,
    };
  } catch (error) {
    result?.delete();
    throw error;
  } finally {
    builder.delete();
    deleteShapes(edges);
  }
}

function edgeModificationError(
  kind: 'fillet' | 'chamfer',
  amount: number,
  selectedEdgeIds: readonly EdgeId[],
  builder: LocalEdgeOperation,
): Error {
  const parameter = kind === 'fillet' ? 'radius' : 'distance';
  const selection = formattedEdgeSelection(selectedEdgeIds);
  const contourDetail = propagatedContourDetail(builder, selectedEdgeIds);

  return new Error(
    `Could not construct ${kind} with ${parameter} ${amount} on ${selection}.\n` +
      `${contourDetail} The edge/${parameter} combination may create degenerate, self-intersecting, or otherwise unsupported geometry. Try a slightly different ${parameter} or edge selection.`.trim(),
  );
}

function propagatedContourDetail(
  builder: LocalEdgeOperation,
  selectedEdgeIds: readonly EdgeId[],
): string {
  try {
    const contourCount = builder.NbContours();
    let contourEdgeCount = 0;
    for (let index = 1; index <= contourCount; index += 1) {
      contourEdgeCount += builder.NbEdges(index);
    }
    return contourEdgeCount > selectedEdgeIds.length
      ? ` OpenCascade expanded the selection to ${counted(contourCount, 'tangent contour')} containing ${counted(contourEdgeCount, 'edge')}.`
      : '';
  } catch {
    return '';
  }
}

function formattedEdgeSelection(edgeIds: readonly EdgeId[]): string {
  const visible = edgeIds.slice(0, 8).map(edgeId => `E${edgeId}`);
  return edgeIds.length <= visible.length
    ? visible.join(', ')
    : `${visible.join(', ')}, and ${edgeIds.length - visible.length} more`;
}

function counted(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function resolveTopologyId<Id extends number>(
  kind: TopologyKind,
  topology: StableTopology<Id>,
  id: Id,
): Id {
  assertTopologyId(kind, id);
  if (!topology.ids.includes(id)) {
    throw new Error(
      `Unknown or retired ${kind} ${topologyMetadata[kind].prefix}${id}.`,
    );
  }
  return id;
}

function resolveTopologyIndex<Id extends number>(
  kind: TopologyKind,
  topology: StableTopology<Id>,
  id: Id,
): number {
  resolveTopologyId(kind, topology, id);
  return topology.ids.indexOf(id);
}

function assertTopologyId(kind: TopologyKind, id: number): void {
  if (!Number.isSafeInteger(id) || id < 1) {
    const prefix = topologyMetadata[kind].prefix;
    throw new Error(
      `${kind[0].toUpperCase()}${kind.slice(1)} IDs must be positive integers; received ${id}. Expected ${prefix}<positive integer>.`,
    );
  }
}

function transferShapeTopology(
  input: Shape3D,
  source: ShapeTopology,
  output: Shape3D,
  history: ShapeHistory,
): ShapeTopology {
  const inputVertices = shapeVertices(input);
  const outputVertices = shapeVertices(output);
  const inputEdges = input.edges;
  const outputEdges = output.edges;
  const inputSurfaces = input.faces;
  const outputSurfaces = output.faces;
  try {
    return shapeTopology(
      transferTopology(
        'vertex',
        inputVertices,
        source.vertices,
        outputVertices,
        history,
      ),
      transferTopology('edge', inputEdges, source.edges, outputEdges, history),
      transferTopology(
        'surface',
        inputSurfaces,
        source.surfaces,
        outputSurfaces,
        history,
      ),
    );
  } finally {
    deleteShapes(inputVertices);
    deleteShapes(outputVertices);
    deleteShapes(inputEdges);
    deleteShapes(outputEdges);
    deleteShapes(inputSurfaces);
    deleteShapes(outputSurfaces);
  }
}

function transferTopology<Id extends number>(
  kind: TopologyKind,
  input: readonly TopologyShape[],
  source: StableTopology<Id>,
  output: readonly TopologyShape[],
  history: ShapeHistory,
): StableTopology<Id> {
  assertTopologyLength(kind, input, source);
  const candidates = input.map(shape => {
    const unchanged = matchingOutputShapes(shape.wrapped, output);
    return unchanged.length > 0
      ? unchanged
      : modifiedOutputShapes(shape.wrapped, output, history);
  });
  const inputCountsByOutput = new Array<number>(output.length).fill(0);
  for (const indices of candidates) {
    for (const index of indices) inputCountsByOutput[index] += 1;
  }

  const transferred = new Map<number, Id>();
  candidates.forEach((indices, inputIndex) => {
    if (indices.length !== 1) return;
    const [outputIndex] = indices;
    if (inputCountsByOutput[outputIndex] === 1) {
      transferred.set(outputIndex, source.ids[inputIndex]);
    }
  });

  let nextId = source.nextId;
  const ids = output.map((_, outputIndex) => {
    const inherited = transferred.get(outputIndex);
    if (inherited !== undefined) return inherited;
    return nextId++ as Id;
  });
  return stableTopology(ids, nextId);
}

function matchingOutputShapes(
  input: TopoDS_Shape,
  output: readonly TopologyShape[],
): number[] {
  const matches: number[] = [];
  output.forEach((shape, index) => {
    if (shape.wrapped.IsSame(input)) matches.push(index);
  });
  return matches;
}

function modifiedOutputShapes(
  input: TopoDS_Shape,
  output: readonly TopologyShape[],
  history: ShapeHistory,
): number[] {
  const modified = history.Modified(input);
  const matches = new Set<number>();
  try {
    while (!modified.IsEmpty()) {
      const candidate = modified.First();
      modified.RemoveFirst();
      try {
        output.forEach((shape, index) => {
          if (shape.wrapped.IsSame(candidate)) matches.add(index);
        });
      } finally {
        candidate.delete();
      }
    }
  } finally {
    modified.delete();
  }
  return [...matches];
}

function stableGroupIds<Id extends number>(
  kind: Exclude<TopologyKind, 'vertex'>,
  shapes: readonly TopologyShape[],
  topology: StableTopology<Id>,
  kernelIds: readonly number[],
): Id[] {
  assertTopologyLength(kind, shapes, topology);
  const prefix = topologyMetadata[kind].prefix;
  const idsByKernelHash = new Map<number, Id>();
  shapes.forEach((shape, index) => {
    const stableId = topology.ids[index];
    const previous = idsByKernelHash.get(shape.hashCode);
    if (previous !== undefined && previous !== stableId) {
      throw new Error(
        `OpenCascade produced colliding ${kind} hashes for ${prefix}${previous} and ${prefix}${stableId}.`,
      );
    }
    idsByKernelHash.set(shape.hashCode, stableId);
  });
  return kernelIds.map(kernelId => {
    const stableId = idsByKernelHash.get(kernelId);
    if (stableId === undefined) {
      throw new Error(
        `The mesh referenced a ${kind} that is absent from the model topology (${kernelId}).`,
      );
    }
    return stableId;
  });
}

function initialTopology(
  shapes: readonly (ReplicadVertex | ReplicadEdge | ReplicadFace)[],
): StableTopology<number> {
  return stableTopology(
    shapes.map((_, index) => index + 1),
    shapes.length + 1,
  );
}

function stableTopology<Id extends number>(
  ids: readonly Id[],
  nextId: Id,
): StableTopology<Id> {
  return Object.freeze({ids: Object.freeze([...ids]), nextId});
}

function shapeTopology(
  vertices: VertexTopology,
  edges: EdgeTopology,
  surfaces: SurfaceTopology,
): ShapeTopology {
  return Object.freeze({vertices, edges, surfaces});
}

function assertTopologyLength<Id extends number>(
  kind: TopologyKind,
  shapes: readonly TopologyShape[],
  topology: StableTopology<Id>,
): void {
  if (shapes.length !== topology.ids.length) {
    throw new Error(
      `${kind[0].toUpperCase()}${kind.slice(1)} topology mismatch: the shape has ${shapes.length} ${topologyMetadata[kind].plural} but ${topology.ids.length} IDs.`,
    );
  }
}

const topologyMetadata = {
  vertex: {prefix: 'V', plural: 'vertices'},
  edge: {prefix: 'E', plural: 'edges'},
  surface: {prefix: 'S', plural: 'surfaces'},
} as const satisfies Record<
  TopologyKind,
  Readonly<{prefix: string; plural: string}>
>;

function shapeVertices(shape: AnyShape): ReplicadVertex[] {
  return Array.from(iterTopo(shape.wrapped, 'vertex'), vertex =>
    cast(vertex),
  ) as ReplicadVertex[];
}

function castShape3D(shape: TopoDS_Shape): Shape3D {
  let result: ReturnType<typeof cast>;
  try {
    result = cast(shape);
  } finally {
    shape.delete();
  }
  try {
    return result.asShape3D();
  } catch (error) {
    result.delete();
    throw error;
  }
}

function deleteShapes(shapes: readonly TopologyShape[]): void {
  shapes.forEach(shape => shape.delete());
}
