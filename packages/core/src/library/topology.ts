import {
  cast,
  getOC,
  type Edge as ReplicadEdge,
  type Face as ReplicadFace,
  type Shape3D,
} from 'replicad';
import type {
  NCollection_List_TopoDS_Shape,
  TopoDS_Shape,
} from 'replicad-opencascadejs';

export type EdgeId = number;
export type SurfaceId = number;

type StableTopology<Id extends number> = Readonly<{
  /** Stable IDs aligned with the corresponding Shape3D traversal order. */
  ids: readonly Id[];
  /** High-water mark. Retired IDs below this value are never reused. */
  nextId: Id;
}>;

export type EdgeTopology = StableTopology<EdgeId>;
export type SurfaceTopology = StableTopology<SurfaceId>;

export type SolidTopology = Readonly<{
  edges: EdgeTopology;
  surfaces: SurfaceTopology;
}>;

export type EdgeModificationResult = Readonly<{
  shape: Shape3D;
  topology: SolidTopology;
  selectedEdgeIds: readonly EdgeId[];
}>;

export type BooleanTopologyOperation = 'cut' | 'fuse' | 'intersect';

export type BooleanTopologyResult = Readonly<{
  shape: Shape3D;
  topology: SolidTopology;
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

export function initialSolidTopology(shape: Shape3D): SolidTopology {
  const edges = shape.edges;
  const surfaces = shape.faces;
  try {
    return solidTopology(
      initialTopology(edges) as EdgeTopology,
      initialTopology(surfaces) as SurfaceTopology,
    );
  } finally {
    deleteShapes(edges);
    deleteShapes(surfaces);
  }
}

export function preserveSolidTopology(
  shape: Shape3D,
  source: SolidTopology,
): SolidTopology {
  const edges = shape.edges;
  const surfaces = shape.faces;
  try {
    assertTopologyLength('edge', edges, source.edges);
    assertTopologyLength('surface', surfaces, source.surfaces);
    return solidTopology(
      stableTopology(source.edges.ids, source.edges.nextId),
      stableTopology(source.surfaces.ids, source.surfaces.nextId),
    );
  } finally {
    deleteShapes(edges);
    deleteShapes(surfaces);
  }
}

export function filletEdges(
  shape: Shape3D,
  source: SolidTopology,
  radius: number,
  edgeIds?: readonly EdgeId[],
): EdgeModificationResult {
  return modifyEdges('fillet', shape, source, radius, edgeIds);
}

export function chamferEdges(
  shape: Shape3D,
  source: SolidTopology,
  distance: number,
  edgeIds?: readonly EdgeId[],
): EdgeModificationResult {
  return modifyEdges('chamfer', shape, source, distance, edgeIds);
}

export function booleanWithTopology(
  left: Shape3D,
  right: Shape3D,
  operation: BooleanTopologyOperation,
  source: SolidTopology,
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
      topology: transferSolidTopology(left, source, result, builder),
    };
  } catch (error) {
    result?.delete();
    throw error;
  } finally {
    builder.delete();
  }
}

export function stableEdgeGroups(
  shape: Shape3D,
  topology: EdgeTopology,
  groups: readonly RawEdgeGroup[],
): readonly RawEdgeGroup[] {
  const edges = shape.edges;
  try {
    const ids = stableGroupIds(
      'edge',
      'E',
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
  shape: Shape3D,
  topology: SurfaceTopology,
  groups: readonly RawSurfaceGroup[],
): readonly StableSurfaceGroup[] {
  const surfaces = shape.faces;
  try {
    const ids = stableGroupIds(
      'surface',
      'S',
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
    assertTopologyId('edge', 'E', edgeId);
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

export function resolveEdge(topology: EdgeTopology, edgeId: EdgeId): EdgeId {
  return resolveTopologyId('edge', 'E', topology, edgeId);
}

export function resolveSurface(
  topology: SurfaceTopology,
  surfaceId: SurfaceId,
): SurfaceId {
  return resolveTopologyId('surface', 'S', topology, surfaceId);
}

function modifyEdges(
  kind: 'fillet' | 'chamfer',
  shape: Shape3D,
  source: SolidTopology,
  amount: number,
  requestedIds?: readonly EdgeId[],
): EdgeModificationResult {
  const selectedEdgeIds = resolveEdgeSelection(source.edges, requestedIds);
  if (selectedEdgeIds.length === 0) {
    const result = shape.clone();
    try {
      return {
        shape: result,
        topology: preserveSolidTopology(result, source),
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
      topology: transferSolidTopology(shape, source, result, builder),
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
  kind: 'edge' | 'surface',
  prefix: 'E' | 'S',
  topology: StableTopology<Id>,
  id: Id,
): Id {
  assertTopologyId(kind, prefix, id);
  if (!topology.ids.includes(id)) {
    throw new Error(`Unknown or retired ${kind} ${prefix}${id}.`);
  }
  return id;
}

function assertTopologyId(
  kind: 'edge' | 'surface',
  prefix: 'E' | 'S',
  id: number,
): void {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error(
      `${kind[0].toUpperCase()}${kind.slice(1)} IDs must be positive integers; received ${id}. Expected ${prefix}<positive integer>.`,
    );
  }
}

function transferSolidTopology(
  input: Shape3D,
  source: SolidTopology,
  output: Shape3D,
  history: ShapeHistory,
): SolidTopology {
  const inputEdges = input.edges;
  const outputEdges = output.edges;
  const inputSurfaces = input.faces;
  const outputSurfaces = output.faces;
  try {
    return solidTopology(
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
    deleteShapes(inputEdges);
    deleteShapes(outputEdges);
    deleteShapes(inputSurfaces);
    deleteShapes(outputSurfaces);
  }
}

function transferTopology<Id extends number>(
  kind: 'edge' | 'surface',
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
  kind: 'edge' | 'surface',
  prefix: 'E' | 'S',
  shapes: readonly TopologyShape[],
  topology: StableTopology<Id>,
  kernelIds: readonly number[],
): Id[] {
  assertTopologyLength(kind, shapes, topology);
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
  shapes: readonly (ReplicadEdge | ReplicadFace)[],
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

function solidTopology(
  edges: EdgeTopology,
  surfaces: SurfaceTopology,
): SolidTopology {
  return Object.freeze({edges, surfaces});
}

function assertTopologyLength<Id extends number>(
  kind: 'edge' | 'surface',
  shapes: readonly TopologyShape[],
  topology: StableTopology<Id>,
): void {
  if (shapes.length !== topology.ids.length) {
    throw new Error(
      `${kind[0].toUpperCase()}${kind.slice(1)} topology mismatch: the shape has ${shapes.length} ${kind}s but ${topology.ids.length} IDs.`,
    );
  }
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
