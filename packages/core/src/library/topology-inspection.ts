import {
  BoundingBox,
  getOC,
  measureShapeLinearProperties,
  measureShapeSurfaceProperties,
  type AnyShape,
  type Edge,
  type Face,
  type Vector,
} from 'replicad';
import {shapeSubshapes} from './kernel-shapes.js';
import type {ShapeTopology, TopologyId, TopologyKind} from './topology.js';
import {sameTopologyId} from './topology-id.js';
import {
  identityRigidTransform,
  quaternionAxisAngle,
  type RigidTransform,
  type Vec3,
} from './spatial.js';

export type TopologyInspectionOptions = Readonly<{
  kind?: TopologyKind;
  ids?: readonly TopologyId[];
  offset?: number;
  limit?: number;
  transform?: RigidTransform & {scale?: Vec3};
}>;
export type TopologyGeometry = {
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
export type TopologyInspectionItem = {
  kind: TopologyKind;
  id: TopologyId;
  geometry?: TopologyGeometry;
  vertices?: readonly TopologyId[];
  edges?: readonly TopologyId[];
  surfaces?: readonly TopologyId[];
  unavailable?: string;
};
export type TopologyInspection = Readonly<{
  counts: Record<TopologyKind, number>;
  bounds: {min: Vec3; max: Vec3; size: Vec3; method: 'kernel-enclosure'};
  total: number;
  offset: number;
  nextOffset?: number;
  items: readonly TopologyInspectionItem[];
  units: 'model';
  coordinates: 'scene';
  geometrySource: 'kernel';
  transform: NonNullable<TopologyInspectionOptions['transform']>;
}>;

/** Query retained B-rep geometry and its actual ID namespace, never the render mesh. */
export function inspectShapeTopology(
  original: AnyShape,
  topology: ShapeTopology,
  options: TopologyInspectionOptions = {},
): TopologyInspection {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 48;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new Error(
      'Topology pages require a nonnegative offset and a limit from 1 to 200.',
    );
  if (options.ids && !options.kind)
    throw new Error('Specify a topology kind when filtering IDs.');
  const transform: NonNullable<TopologyInspectionOptions['transform']> =
    options.transform ?? identityRigidTransform;
  const scale = transform.scale ?? [1, 1, 1];
  if (
    scale.some(
      value => !Number.isFinite(value) || value === 0 || value !== scale[0],
    )
  )
    throw new Error('Topology inspection requires a uniform nonzero scale.');
  let shape = original.clone();
  const owned: AnyShape[] = [];
  try {
    if (scale[0] !== 1) shape = shape.scale(scale[0]);
    const {axis, angleDegrees} = quaternionAxisAngle(transform.quaternion);
    if (Math.abs(angleDegrees) > 1e-9)
      shape = shape.rotate(angleDegrees, [0, 0, 0], [...axis]);
    shape = shape.translate([...transform.position]);
    const vertices = shapeSubshapes(shape, 'vertex');
    owned.push(...vertices);
    const edges = shapeSubshapes(shape, 'edge');
    owned.push(...edges);
    const surfaces = shapeSubshapes(shape, 'face');
    owned.push(...surfaces);
    const shapes = {vertex: vertices, edge: edges, surface: surfaces};
    const ids = {
      vertex: topology.vertices.ids,
      edge: topology.edges.ids,
      surface: topology.surfaces.ids,
    };
    for (const kind of ['vertex', 'edge', 'surface'] as const)
      if (shapes[kind].length !== ids[kind].length)
        throw new Error(
          'Retained geometry does not match its topology namespace.',
        );
    if (
      options.ids?.some(
        id =>
          !ids[options.kind!].some(available => sameTopologyId(available, id)),
      )
    )
      throw new Error(
        'A requested topology ID is absent from this model snapshot.',
      );
    const all = (
      options.kind ? [options.kind] : (['surface', 'edge', 'vertex'] as const)
    ).flatMap(kind =>
      ids[kind].flatMap((id, index) =>
        !options.ids ||
        options.ids.some(requested => sameTopologyId(requested, id))
          ? [{kind, id, index}]
          : [],
      ),
    );
    const page = all.slice(offset, offset + limit);
    const childIndices = (
      parent: AnyShape,
      kind: 'edge' | 'vertex',
    ): number[] => {
      const children = shapeSubshapes(parent, kind);
      try {
        return shapes[kind].flatMap((candidate, index) =>
          children.some(child => child.isSame(candidate)) ? [index] : [],
        );
      } finally {
        children.forEach(child => child.delete());
      }
    };
    const edgeVertices = new Map<number, number[]>();
    const surfaceEdges = new Map<number, number[]>();
    const verticesOf = (index: number) => {
      if (!edgeVertices.has(index))
        edgeVertices.set(index, childIndices(edges[index], 'vertex'));
      return edgeVertices.get(index)!;
    };
    const edgesOf = (index: number) => {
      if (!surfaceEdges.has(index))
        surfaceEdges.set(index, childIndices(surfaces[index], 'edge'));
      return surfaceEdges.get(index)!;
    };
    const items = page.map(({kind, id, index}): TopologyInspectionItem => {
      try {
        if (kind === 'vertex')
          return {
            kind,
            id,
            geometry: {type: 'POINT', position: vertices[index].asTuple()},
            edges: edges.flatMap((_, edge) =>
              verticesOf(edge).includes(index) ? [ids.edge[edge]] : [],
            ),
          };
        if (kind === 'edge')
          return {
            kind,
            id,
            geometry: inspectEdge(edges[index]),
            vertices: verticesOf(index).map(vertex => ids.vertex[vertex]),
            surfaces: surfaces.flatMap((_, surface) =>
              edgesOf(surface).includes(index) ? [ids.surface[surface]] : [],
            ),
          };
        return {
          kind,
          id,
          geometry: inspectSurface(surfaces[index]),
          edges: edgesOf(index).map(edge => ids.edge[edge]),
        };
      } catch (error) {
        return {
          kind,
          id,
          unavailable:
            error instanceof Error
              ? error.message
              : 'Kernel geometry query failed.',
        };
      }
    });
    const box = new BoundingBox();
    let min: Vec3, max: Vec3;
    try {
      getOC().BRepBndLib.Add(shape.wrapped, box.wrapped, false);
      [min, max] = box.bounds;
    } finally {
      box.delete();
    }
    return {
      counts: {
        vertex: vertices.length,
        edge: edges.length,
        surface: surfaces.length,
      },
      bounds: {
        min,
        max,
        size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
        method: 'kernel-enclosure',
      },
      total: all.length,
      offset,
      ...(offset + page.length < all.length
        ? {nextOffset: offset + page.length}
        : {}),
      items,
      units: 'model',
      coordinates: 'scene',
      geometrySource: 'kernel',
      transform,
    };
  } finally {
    owned.forEach(value => value.delete());
    shape.delete();
  }
}

function vector(value: Vector, normalize = false): Vec3 {
  try {
    const tuple = value.toTuple();
    if (!normalize) return tuple;
    const length = Math.hypot(...tuple);
    if (length < 1e-14) throw new Error('The sampled direction is singular.');
    return [tuple[0] / length, tuple[1] / length, tuple[2] / length];
  } finally {
    value.delete();
  }
}
function xyz(value: {
  X(): number;
  Y(): number;
  Z(): number;
  delete(): void;
}): Vec3 {
  try {
    return [value.X(), value.Y(), value.Z()];
  } finally {
    value.delete();
  }
}
function analytic(value: {
  Location(): {X(): number; Y(): number; Z(): number; delete(): void};
  Axis(): {
    Direction(): {X(): number; Y(): number; Z(): number; delete(): void};
    delete(): void;
  };
  delete(): void;
}): {center: Vec3; axis: Vec3} {
  try {
    const axis = value.Axis();
    try {
      return {center: xyz(value.Location()), axis: xyz(axis.Direction())};
    } finally {
      axis.delete();
    }
  } finally {
    value.delete();
  }
}

function inspectEdge(edge: Edge): TopologyGeometry {
  const properties = measureShapeLinearProperties(edge);
  let length: number;
  try {
    length = properties.length;
  } finally {
    properties.delete();
  }
  const type = edge.geomType;
  const result: TopologyGeometry = {
    type,
    length,
    start: vector(edge.startPoint),
    end: vector(edge.endPoint),
    closed: edge.isClosed,
  };
  if (type === 'LINE') result.direction = vector(edge.tangentAt(0.5), true);
  if (type === 'CIRCLE' || type === 'ELLIPSE') {
    const curve = new (getOC().BRepAdaptor_Curve)(edge.wrapped);
    try {
      if (type === 'CIRCLE') {
        const circle = curve.Circle();
        result.radius = circle.Radius();
        Object.assign(result, analytic(circle));
      } else {
        const ellipse = curve.Ellipse();
        result.majorRadius = ellipse.MajorRadius();
        result.minorRadius = ellipse.MinorRadius();
        Object.assign(result, analytic(ellipse));
      }
    } finally {
      curve.delete();
    }
  }
  return result;
}

function inspectSurface(face: Face): TopologyGeometry {
  const properties = measureShapeSurfaceProperties(face);
  const type = face.geomType;
  let result: TopologyGeometry;
  try {
    result = {
      type: type === 'CYLINDRE' ? 'CYLINDER' : type,
      area: properties.area,
      centroid: properties.centerOfMass,
    };
  } finally {
    properties.delete();
  }
  if (type === 'PLANE') result.normal = vector(face.normalAt(), true);
  else
    result.normalSample = {
      position: vector(face.pointOnSurface(0.5, 0.5)),
      normal: vector(face.normalAt(), true),
      method: 'uv-domain-midpoint',
      trimMembership: 'unchecked',
    };
  const surface = face.surface;
  try {
    if (type === 'CYLINDRE') {
      const cylinder = surface.wrapped.Cylinder();
      result.radius = cylinder.Radius();
      Object.assign(result, analytic(cylinder));
    }
    if (type === 'SPHERE') {
      const sphere = surface.wrapped.Sphere();
      try {
        result.radius = sphere.Radius();
        result.center = xyz(sphere.Location());
      } finally {
        sphere.delete();
      }
    }
  } finally {
    surface.delete();
  }
  return result;
}
