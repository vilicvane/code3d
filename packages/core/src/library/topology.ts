import {cast, getOC, type Edge, type Shape3D} from 'replicad';
import type {
  NCollection_List_TopoDS_Shape,
  TopoDS_Shape,
} from 'replicad-opencascadejs';

export type EdgeId = number;

export type EdgeTopology = Readonly<{
  /** Stable IDs aligned with Shape3D.edges traversal order. */
  edgeIds: readonly EdgeId[];
  /** High-water mark. Retired IDs below this value are never reused. */
  nextEdgeId: EdgeId;
}>;

export type EdgeModificationResult = Readonly<{
  shape: Shape3D;
  topology: EdgeTopology;
  selectedEdgeIds: readonly EdgeId[];
}>;

export type BooleanTopologyOperation = 'cut' | 'fuse' | 'intersect';

export type BooleanTopologyResult = Readonly<{
  shape: Shape3D;
  topology: EdgeTopology;
}>;

type ShapeHistory = Readonly<{
  Modified(shape: TopoDS_Shape): NCollection_List_TopoDS_Shape;
}>;

type RawEdgeGroup = Readonly<{
  start: number;
  count: number;
  edgeId: number;
}>;

export function initialEdgeTopology(shape: Shape3D): EdgeTopology {
  const edges = shape.edges;
  try {
    return topology(
      edges.map((_, index) => index + 1),
      edges.length + 1,
    );
  } finally {
    deleteEdges(edges);
  }
}

export function preserveEdgeTopology(
  shape: Shape3D,
  source: EdgeTopology,
): EdgeTopology {
  const edges = shape.edges;
  try {
    assertTopologyLength(edges, source);
    return topology(source.edgeIds, source.nextEdgeId);
  } finally {
    deleteEdges(edges);
  }
}

export function filletEdges(
  shape: Shape3D,
  source: EdgeTopology,
  radius: number,
  edgeIds?: readonly EdgeId[],
): EdgeModificationResult {
  return modifyEdges('fillet', shape, source, radius, edgeIds);
}

export function chamferEdges(
  shape: Shape3D,
  source: EdgeTopology,
  distance: number,
  edgeIds?: readonly EdgeId[],
): EdgeModificationResult {
  return modifyEdges('chamfer', shape, source, distance, edgeIds);
}

export function booleanWithTopology(
  left: Shape3D,
  right: Shape3D,
  operation: BooleanTopologyOperation,
  source: EdgeTopology,
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
    const nextTopology = transferEdgeTopology(left, source, result, builder);
    return {shape: result, topology: nextTopology};
  } catch (error) {
    result?.delete();
    throw error;
  } finally {
    builder.delete();
  }
}

export function stableEdgeGroups(
  shape: Shape3D,
  edgeTopology: EdgeTopology,
  groups: readonly RawEdgeGroup[],
): readonly RawEdgeGroup[] {
  const edges = shape.edges;
  try {
    assertTopologyLength(edges, edgeTopology);
    const idsByKernelHash = new Map<number, EdgeId>();
    edges.forEach((edge, index) => {
      const stableId = edgeTopology.edgeIds[index];
      const previous = idsByKernelHash.get(edge.hashCode);
      if (previous !== undefined && previous !== stableId) {
        throw new Error(
          `OpenCascade produced colliding edge hashes for E${previous} and E${stableId}.`,
        );
      }
      idsByKernelHash.set(edge.hashCode, stableId);
    });
    return groups.map(group => {
      const stableId = idsByKernelHash.get(group.edgeId);
      if (stableId === undefined) {
        throw new Error(
          `The mesh referenced an edge that is absent from the model topology (${group.edgeId}).`,
        );
      }
      return {...group, edgeId: stableId};
    });
  } finally {
    deleteEdges(edges);
  }
}

function modifyEdges(
  kind: 'fillet' | 'chamfer',
  shape: Shape3D,
  source: EdgeTopology,
  amount: number,
  requestedIds?: readonly EdgeId[],
): EdgeModificationResult {
  const selectedEdgeIds = selectEdgeIds(source, requestedIds);
  if (selectedEdgeIds.length === 0) {
    const result = shape.clone();
    try {
      return {
        shape: result,
        topology: preserveEdgeTopology(result, source),
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
    assertTopologyLength(edges, source);
    edges.forEach((edge, index) => {
      if (selected.has(source.edgeIds[index])) {
        builder.Add(amount, edge.wrapped);
      }
    });
    builder.Build();
    result = castShape3D(builder.Shape());
    const nextTopology = transferEdgeTopologyFromEdges(
      edges,
      source,
      result,
      builder,
    );
    return {
      shape: result,
      topology: nextTopology,
      selectedEdgeIds,
    };
  } catch (error) {
    result?.delete();
    throw error;
  } finally {
    builder.delete();
    deleteEdges(edges);
  }
}

function selectEdgeIds(
  topology: EdgeTopology,
  requestedIds: readonly EdgeId[] | undefined,
): readonly EdgeId[] {
  if (requestedIds === undefined) {
    return [...topology.edgeIds];
  }
  if (requestedIds.length === 0) {
    throw new Error(
      'An edge selection cannot be empty; omit the second argument to select all edges.',
    );
  }
  const requested = new Set<EdgeId>();
  for (const edgeId of requestedIds) {
    if (!Number.isSafeInteger(edgeId) || edgeId < 1) {
      throw new Error(
        `Edge IDs must be positive integers; received ${edgeId}.`,
      );
    }
    requested.add(edgeId);
  }
  const selected = topology.edgeIds.filter(edgeId => requested.has(edgeId));
  const missing = [...requested].filter(edgeId => !selected.includes(edgeId));
  if (missing.length > 0) {
    throw new Error(
      `Unknown or retired edge ${missing.map(edgeId => `E${edgeId}`).join(', ')}.`,
    );
  }
  return selected;
}

function transferEdgeTopology(
  input: Shape3D,
  source: EdgeTopology,
  output: Shape3D,
  history: ShapeHistory,
): EdgeTopology {
  const inputEdges = input.edges;
  try {
    return transferEdgeTopologyFromEdges(inputEdges, source, output, history);
  } finally {
    deleteEdges(inputEdges);
  }
}

function transferEdgeTopologyFromEdges(
  inputEdges: readonly Edge[],
  source: EdgeTopology,
  output: Shape3D,
  history: ShapeHistory,
): EdgeTopology {
  assertTopologyLength(inputEdges, source);
  const outputEdges = output.edges;
  try {
    const candidates = inputEdges.map(edge => {
      const unchanged = matchingOutputEdges(edge.wrapped, outputEdges);
      return unchanged.length > 0
        ? unchanged
        : modifiedOutputEdges(edge.wrapped, outputEdges, history);
    });
    const inputCountsByOutput = new Array<number>(outputEdges.length).fill(0);
    for (const indices of candidates) {
      for (const index of indices) {
        inputCountsByOutput[index] += 1;
      }
    }

    const transferred = new Map<number, EdgeId>();
    candidates.forEach((indices, inputIndex) => {
      if (indices.length !== 1) return;
      const [outputIndex] = indices;
      if (inputCountsByOutput[outputIndex] === 1) {
        transferred.set(outputIndex, source.edgeIds[inputIndex]);
      }
    });

    let nextEdgeId = source.nextEdgeId;
    const edgeIds = outputEdges.map((_, outputIndex) => {
      const inherited = transferred.get(outputIndex);
      if (inherited !== undefined) return inherited;
      return nextEdgeId++;
    });
    return topology(edgeIds, nextEdgeId);
  } finally {
    deleteEdges(outputEdges);
  }
}

function matchingOutputEdges(
  input: TopoDS_Shape,
  outputEdges: readonly Edge[],
): number[] {
  const matches: number[] = [];
  outputEdges.forEach((edge, index) => {
    if (edge.wrapped.IsSame(input)) matches.push(index);
  });
  return matches;
}

function modifiedOutputEdges(
  input: TopoDS_Shape,
  outputEdges: readonly Edge[],
  history: ShapeHistory,
): number[] {
  const modified = history.Modified(input);
  const matches = new Set<number>();
  try {
    while (!modified.IsEmpty()) {
      const candidate = modified.First();
      modified.RemoveFirst();
      try {
        outputEdges.forEach((edge, index) => {
          if (edge.wrapped.IsSame(candidate)) matches.add(index);
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

function assertTopologyLength(
  edges: readonly Edge[],
  topology: EdgeTopology,
): void {
  if (edges.length !== topology.edgeIds.length) {
    throw new Error(
      `Edge topology mismatch: the shape has ${edges.length} edges but ${topology.edgeIds.length} IDs.`,
    );
  }
}

function topology(
  edgeIds: readonly EdgeId[],
  nextEdgeId: EdgeId,
): EdgeTopology {
  return Object.freeze({
    edgeIds: Object.freeze([...edgeIds]),
    nextEdgeId,
  });
}

function deleteEdges(edges: readonly Edge[]): void {
  edges.forEach(edge => edge.delete());
}
