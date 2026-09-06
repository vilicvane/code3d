import {
  getOC,
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

import {
  castOwnedShape3D,
  consumeShapeList,
  shapeSubshapes,
} from './kernel-shapes.js';

import {
  formatTopologyId,
  inheritedTopologyId,
  isTopologyId,
  sameTopologyId,
  TopologyIdSet,
  type TopologyId,
  type TopologyKind,
  type VertexId,
  type EdgeId,
  type SurfaceId,
} from './topology-id.js';
export type {
  TopologyId,
  TopologyKind,
  VertexId,
  EdgeId,
  SurfaceId,
} from './topology-id.js';

export type TopologySelection =
  Readonly<{kind: 'solid'}> | Readonly<{kind: TopologyKind; id: TopologyId}>;

/** Visit an owned wrapper; callers must not retain it beyond the callback. */
export function withTopologyShape<T>(
  shape: AnyShape,
  topology: ShapeTopology,
  selection: TopologySelection,
  visit: (selected: AnyShape) => T,
): T {
  if (selection.kind === 'solid') return visit(shape);
  const shapes = topologyShapes(shape, selection.kind);
  try {
    return visit(
      shapes[
        resolveTopologyIndex(
          selection.kind,
          topology[topologyMetadata[selection.kind].plural],
          selection.id,
        )
      ],
    );
  } finally {
    deleteShapes(shapes);
  }
}

/** Child IDs always belong to the original geometry's namespace. */
export function topologyChildren(
  shape: AnyShape,
  topology: ShapeTopology,
  selection: TopologySelection,
  kind: TopologyKind,
  ids?: readonly TopologyId[],
): readonly TopologyId[] {
  const all = topology[topologyMetadata[kind].plural];
  const available =
    selection.kind === 'solid'
      ? all.ids
      : withTopologyShape(shape, topology, selection, selected => {
          const children = topologyShapes(selected, kind);
          const originals = topologyShapes(shape, kind);
          try {
            return all.ids.filter((_, index) =>
              children.some(child => child.isSame(originals[index])),
            );
          } finally {
            deleteShapes(children);
            deleteShapes(originals);
          }
        });
  if (!ids) return available;
  return ids.map(id => {
    const resolved = resolveTopologyId(kind, all, id);
    if (!available.some(candidate => sameTopologyId(candidate, id))) {
      throw new Error(
        `${formatTopologyId(kind, id)} does not belong to ${selection.kind}${selection.kind === 'solid' ? '' : ` ${formatTopologyId(selection.kind, selection.id)}`}.`,
      );
    }
    return resolved;
  });
}

function topologyShapes(shape: AnyShape, kind: TopologyKind): AnyShape[] {
  return shapeSubshapes(shape, kind === 'surface' ? 'face' : kind);
}

type StableTopology = Readonly<{
  /** IDs aligned with the corresponding shape traversal order. */
  ids: readonly TopologyId[];
}>;

export type VertexTopology = StableTopology;
export type EdgeTopology = StableTopology;
export type SurfaceTopology = StableTopology;

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

type StableEdgeGroup = Readonly<{
  start: number;
  count: number;
  edgeId: EdgeId;
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
  const edges = shapeSubshapes(shape, 'edge');
  const surfaces = shapeSubshapes(shape, 'face');
  try {
    return shapeTopology(
      initialTopology(vertices),
      initialTopology(edges),
      initialTopology(surfaces),
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
  const edges = shapeSubshapes(shape, 'edge');
  const surfaces = shapeSubshapes(shape, 'face');
  try {
    assertTopologyLength('vertex', vertices, source.vertices);
    assertTopologyLength('edge', edges, source.edges);
    assertTopologyLength('surface', surfaces, source.surfaces);
    return source;
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
  left: TopologyInput,
  right: TopologyInput,
  operation: BooleanTopologyOperation,
): BooleanTopologyResult {
  const oc = getOC();
  const builder =
    operation === 'fuse'
      ? new oc.BRepAlgoAPI_Fuse(left.shape.wrapped, right.shape.wrapped)
      : operation === 'cut'
        ? new oc.BRepAlgoAPI_Cut(left.shape.wrapped, right.shape.wrapped)
        : new oc.BRepAlgoAPI_Common(left.shape.wrapped, right.shape.wrapped);
  let result: Shape3D | undefined;
  try {
    builder.Build();
    builder.SimplifyResult(true, true, 0.001);
    result = castOwnedShape3D(builder.Shape());
    return {
      shape: result,
      topology: transferShapeTopology([left, right], result, builder),
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
): readonly StableEdgeGroup[] {
  const edges = shapeSubshapes(shape, 'edge');
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
  const surfaces = shapeSubshapes(shape, 'face');
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
  return resolveTopologySelection('edge', topology, requestedIds);
}

/** Resolve an explicit selection in source order, including an empty selection. */
export function resolveTopologySelection(
  kind: TopologyKind,
  topology: StableTopology,
  requestedIds: readonly TopologyId[],
): readonly TopologyId[] {
  const requested = new TopologyIdSet();
  for (const id of requestedIds) {
    assertTopologyId(kind, id);
    requested.add(id);
  }
  const selected = topology.ids.filter(id => requested.has(id));
  const missing = [...requested].filter(
    id => !selected.some(candidate => sameTopologyId(candidate, id)),
  );
  if (missing.length > 0) {
    throw new Error(
      `Unknown or retired ${kind} ${missing.map(id => formatTopologyId(kind, id)).join(', ')}.`,
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
  const edges = shapeSubshapes(shape, 'edge');
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
  const surfaces = shapeSubshapes(shape, 'face');
  try {
    assertTopologyLength('surface', surfaces, topology);
    return surfaceIds.map(surfaceId => {
      const surface =
        surfaces[resolveTopologyIndex('surface', topology, surfaceId)];
      const center = surface.center;
      try {
        // A curved face's centroid need not lie on its surface, and projecting
        // it can be ambiguous (for example, a cylinder's center lies on its axis).
        // Sample the normal at the UV-domain midpoint without a projection.
        const normal = surface.normalAt();
        try {
          return {position: center.toTuple(), direction: normal.toTuple()};
        } finally {
          normal.delete();
        }
      } finally {
        center.delete();
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

  const edges = shapeSubshapes(shape, 'edge');
  const selected = new TopologyIdSet(selectedEdgeIds);
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
    result = castOwnedShape3D(builder.Shape());
    return {
      shape: result,
      topology: transferShapeTopology(
        [{shape, topology: source, index: 1}],
        result,
        builder,
      ),
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
  const visible = edgeIds
    .slice(0, 8)
    .map(edgeId => formatTopologyId('edge', edgeId));
  return edgeIds.length <= visible.length
    ? visible.join(', ')
    : `${visible.join(', ')}, and ${edgeIds.length - visible.length} more`;
}

function counted(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function resolveTopologyId(
  kind: TopologyKind,
  topology: StableTopology,
  id: TopologyId,
): TopologyId {
  return topology.ids[resolveTopologyIndex(kind, topology, id)];
}

function resolveTopologyIndex(
  kind: TopologyKind,
  topology: StableTopology,
  id: TopologyId,
): number {
  assertTopologyId(kind, id);
  const index = topology.ids.findIndex(candidate =>
    sameTopologyId(candidate, id),
  );
  if (index === -1)
    throw new Error(
      `Unknown or retired ${kind} ${formatTopologyId(kind, id)}.`,
    );
  return index;
}

function assertTopologyId(kind: TopologyKind, id: TopologyId): void {
  if (!isTopologyId(id)) {
    throw new Error(
      `${kind[0].toUpperCase()}${kind.slice(1)} IDs must be positive integers or paths of at least two positive integers; received ${JSON.stringify(id)}.`,
    );
  }
}

export type TopologyInput = Readonly<{
  shape: AnyShape;
  topology: ShapeTopology;
  /** Omitted only for intermediate results inside a single operation. */
  index?: number;
}>;

/** Returns owned handles, released by the transfer after matching. */
type TopologyHistory = (
  input: TopoDS_Shape,
  kind: TopologyKind,
  inputIndex: number,
) => readonly TopoDS_Shape[];

/** Resolve all input candidates together so merges never arbitrarily pick an owner. */
export function transferShapeTopology(
  inputs: readonly TopologyInput[],
  output: AnyShape,
  history: ShapeHistory | TopologyHistory,
): ShapeTopology {
  const transfer = (kind: TopologyKind): StableTopology => {
    const originals: AnyShape[][] = [];
    const results = topologyShapes(output, kind);
    try {
      const candidates = inputs.flatMap((input, inputIndex) => {
        const shapes = topologyShapes(input.shape, kind);
        originals.push(shapes);
        const source = input.topology[topologyMetadata[kind].plural];
        assertTopologyLength(kind, shapes, source);
        return shapes.map((shape, index) => {
          const id = source.ids[index];
          // Numeric elements in an internal prefix are still new to this
          // operation. Reallocate them with the final traversal, without exposing
          // internal creation steps or reserving numbers for discarded geometry.
          const inherited =
            input.index !== undefined
              ? inheritedTopologyId(input.index, id)
              : typeof id === 'number'
                ? undefined
                : id;
          const unchanged = matchingOutputShapes(shape.wrapped, results);
          if (unchanged.length) return {id: inherited, matches: unchanged};
          if (typeof history !== 'function') {
            return {
              id: inherited,
              matches: modifiedOutputShapes(shape.wrapped, results, history),
            };
          }
          const modified = history(shape.wrapped, kind, inputIndex);
          try {
            return {
              id: inherited,
              matches: [
                ...new Set(
                  modified.flatMap(candidate =>
                    matchingOutputShapes(candidate, results),
                  ),
                ),
              ],
            };
          } finally {
            modified.forEach(candidate => candidate.delete());
          }
        });
      });
      const counts = new Array<number>(results.length).fill(0);
      for (const candidate of candidates) {
        for (const index of candidate.matches) counts[index]++;
      }
      const inherited = new Map<number, TopologyId>();
      for (const candidate of candidates) {
        const [index] = candidate.matches;
        if (
          candidate.id !== undefined &&
          candidate.matches.length === 1 &&
          counts[index] === 1
        ) {
          inherited.set(index, candidate.id);
        }
      }
      let nextId = 1;
      return stableTopology(
        results.map((_, index) => inherited.get(index) ?? nextId++),
      );
    } finally {
      originals.forEach(deleteShapes);
      deleteShapes(results);
    }
  };
  return shapeTopology(
    transfer('vertex'),
    transfer('edge'),
    transfer('surface'),
  );
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
  const modified = consumeShapeList(history.Modified(input));
  try {
    return [
      ...new Set(
        modified.flatMap(candidate => matchingOutputShapes(candidate, output)),
      ),
    ];
  } finally {
    modified.forEach(candidate => candidate.delete());
  }
}

function stableGroupIds(
  kind: Exclude<TopologyKind, 'vertex'>,
  shapes: readonly TopologyShape[],
  topology: StableTopology,
  kernelIds: readonly number[],
): TopologyId[] {
  assertTopologyLength(kind, shapes, topology);
  const idsByKernelHash = new Map<number, TopologyId>();
  shapes.forEach((shape, index) => {
    const stableId = topology.ids[index];
    const previous = idsByKernelHash.get(shape.hashCode);
    if (previous !== undefined && !sameTopologyId(previous, stableId)) {
      throw new Error(
        `OpenCascade produced colliding ${kind} hashes for ${formatTopologyId(kind, previous)} and ${formatTopologyId(kind, stableId)}.`,
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
): StableTopology {
  return stableTopology(shapes.map((_, index) => index + 1));
}

function stableTopology(ids: readonly TopologyId[]): StableTopology {
  return {ids};
}

function shapeTopology(
  vertices: VertexTopology,
  edges: EdgeTopology,
  surfaces: SurfaceTopology,
): ShapeTopology {
  return {vertices, edges, surfaces};
}

function assertTopologyLength(
  kind: TopologyKind,
  shapes: readonly TopologyShape[],
  topology: StableTopology,
): void {
  if (shapes.length !== topology.ids.length) {
    throw new Error(
      `${kind[0].toUpperCase()}${kind.slice(1)} topology mismatch: the shape has ${shapes.length} ${topologyMetadata[kind].plural} but ${topology.ids.length} IDs.`,
    );
  }
}

const topologyMetadata = {
  vertex: {plural: 'vertices'},
  edge: {plural: 'edges'},
  surface: {plural: 'surfaces'},
} as const satisfies Record<TopologyKind, Readonly<{plural: string}>>;

function shapeVertices(shape: AnyShape): ReplicadVertex[] {
  return shapeSubshapes(shape, 'vertex');
}

function deleteShapes(shapes: readonly TopologyShape[]): void {
  shapes.forEach(shape => shape.delete());
}
