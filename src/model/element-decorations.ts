import {rotateVector} from './spatial';
import type {
  ElementSnapshot,
  ModelSnapshotObject,
  RenderMesh,
  Transform,
  Vec3,
} from './runtime';
import type {
  SourceDecorationProvider,
  ViewportAnchorDecoration,
  ViewportDecoration,
} from '../viewport-decoration';

const elementAppearance = {
  color: '#d8ff3e',
  opacity: 0.92,
  emissive: '#8daa16',
  emissiveIntensity: 0.8,
  depthTest: false,
} as const;

const axisAppearance = {
  color: '#ffad4d',
  opacity: 0.98,
  emissive: '#a94300',
  emissiveIntensity: 1,
  depthTest: false,
} as const;

const faceAppearance = {
  color: '#63dcff',
  opacity: 0.66,
  emissive: '#075c78',
  emissiveIntensity: 0.95,
  edgeColor: '#d8f7ff',
  edgeOpacity: 1,
  depthBias: 3,
  depthTest: false,
  shading: 'unlit',
} as const;

export const elementSourceDecoration = {
  id: 'named-element',
  decorations({module, evaluation}) {
    const reference = evaluation.element;
    if (!reference) return [];
    const node = module.objects.get(reference.nodeId);
    const element = node?.elements.find(
      candidate =>
        candidate.name === reference.name && candidate.kind === reference.kind,
    );
    if (!node || !element) return [];
    return namedElementDecorations(node, element);
  },
} satisfies SourceDecorationProvider;

export function namedElementDecorations(
  node: ModelSnapshotObject,
  element: ElementSnapshot,
): readonly ViewportDecoration[] {
  const markerSize = elementDisplaySize(node);
  const surface =
    element.kind === 'face' && node.mesh
      ? faceSurfaceAt(node.mesh, element.transform)
      : undefined;
  const anchorBase = {
    kind: 'anchor' as const,
    id: `${node.nodeId}:${element.name}`,
    nodeId: node.nodeId,
    transform: element.transform,
    markerSize,
  };
  const anchor: ViewportAnchorDecoration =
    element.kind === 'line'
      ? {
          ...anchorBase,
          elementKind: element.kind,
          span: axisDisplaySpan(node, element.transform, markerSize),
          appearance: axisAppearance,
        }
      : {
          ...anchorBase,
          elementKind: element.kind,
          appearance:
            element.kind === 'face' ? faceAppearance : elementAppearance,
        };
  return [
    ...(surface
      ? [
          {
            kind: 'surface' as const,
            id: `${node.nodeId}:${element.name}:surface`,
            nodeId: node.nodeId,
            mesh: surface,
            appearance: faceAppearance,
          },
        ]
      : []),
    anchor,
  ];
}

function faceSurfaceAt(
  mesh: RenderMesh,
  transform: Transform,
): RenderMesh | undefined {
  const normal = rotateVector([0, 1, 0], transform.quaternion);
  const tolerance = Math.max(1e-4, meshDiagonal(mesh) * 1e-5);
  const groups = mesh.faceGroups.filter(group =>
    faceGroupMatches(mesh, group, transform.position, normal, tolerance),
  );
  if (groups.length === 0) return undefined;

  const indices = groups.flatMap(group => [
    ...mesh.triangles.slice(group.start, group.start + group.count),
  ]);
  const triangles = new Uint32Array(indices);
  let groupStart = 0;
  const faceGroups = groups.map(group => {
    const snapshot = {
      start: groupStart,
      count: group.count,
      faceId: group.faceId,
    };
    groupStart += group.count;
    return snapshot;
  });
  return {
    vertices: mesh.vertices,
    normals: mesh.normals,
    triangles,
    edges: boundaryEdges(mesh.vertices, triangles),
    faceGroups,
    edgeGroups: [],
  };
}

function faceGroupMatches(
  mesh: RenderMesh,
  group: RenderMesh['faceGroups'][number],
  planeOrigin: Vec3,
  planeNormal: Vec3,
  tolerance: number,
): boolean {
  const vertexIndices = new Set(
    mesh.triangles.slice(group.start, group.start + group.count),
  );
  return [...vertexIndices].every(vertexIndex => {
    const offset = vertexIndex * 3;
    const distance = dot(
      [
        mesh.vertices[offset] - planeOrigin[0],
        mesh.vertices[offset + 1] - planeOrigin[1],
        mesh.vertices[offset + 2] - planeOrigin[2],
      ],
      planeNormal,
    );
    const alignment = dot(
      [
        mesh.normals[offset],
        mesh.normals[offset + 1],
        mesh.normals[offset + 2],
      ],
      planeNormal,
    );
    return Math.abs(distance) <= tolerance && alignment >= 0.95;
  });
}

function boundaryEdges(
  vertices: Float32Array,
  triangles: Uint32Array,
): Float32Array {
  const edges = new Map<string, {from: number; to: number; uses: number}>();
  const add = (from: number, to: number): void => {
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    const edge = edges.get(key);
    if (edge) {
      edge.uses += 1;
    } else {
      edges.set(key, {from, to, uses: 1});
    }
  };
  for (let index = 0; index < triangles.length; index += 3) {
    const first = triangles[index];
    const second = triangles[index + 1];
    const third = triangles[index + 2];
    add(first, second);
    add(second, third);
    add(third, first);
  }
  return new Float32Array(
    [...edges.values()].flatMap(edge =>
      edge.uses === 1
        ? [
            ...vertices.slice(edge.from * 3, edge.from * 3 + 3),
            ...vertices.slice(edge.to * 3, edge.to * 3 + 3),
          ]
        : [],
    ),
  );
}

function meshDiagonal(mesh: RenderMesh): number {
  const {min, max} = meshBounds(mesh);
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function elementDisplaySize(node: ModelSnapshotObject): number {
  const mesh = node.mesh;
  if (!mesh || mesh.vertices.length < 3) return 2;
  const {min, max} = meshBounds(mesh);
  const diagonal = Math.hypot(
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  );
  return Math.min(8, Math.max(0.8, diagonal * 0.14));
}

function axisDisplaySpan(
  node: ModelSnapshotObject,
  transform: Transform,
  markerSize: number,
): Readonly<{negative: number; positive: number}> {
  const mesh = node.mesh;
  if (!mesh || mesh.vertices.length < 3) {
    return {negative: markerSize, positive: markerSize};
  }
  const direction = rotateVector([0, 1, 0], transform.quaternion);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < mesh.vertices.length; index += 3) {
    const projection = dot(
      [
        mesh.vertices[index] - transform.position[0],
        mesh.vertices[index + 1] - transform.position[1],
        mesh.vertices[index + 2] - transform.position[2],
      ],
      direction,
    );
    minimum = Math.min(minimum, projection);
    maximum = Math.max(maximum, projection);
  }
  const overhang = markerSize * 1.5;
  return {
    negative: Math.max(0, -minimum) + overhang,
    positive: Math.max(0, maximum) + overhang,
  };
}

function meshBounds(mesh: RenderMesh): Readonly<{min: Vec3; max: Vec3}> {
  const {vertices} = mesh;
  let minX = vertices[0];
  let minY = vertices[1];
  let minZ = vertices[2];
  let maxX = minX;
  let maxY = minY;
  let maxZ = minZ;
  for (let index = 3; index < vertices.length; index += 3) {
    minX = Math.min(minX, vertices[index]);
    minY = Math.min(minY, vertices[index + 1]);
    minZ = Math.min(minZ, vertices[index + 2]);
    maxX = Math.max(maxX, vertices[index]);
    maxY = Math.max(maxY, vertices[index + 1]);
    maxZ = Math.max(maxZ, vertices[index + 2]);
  }
  return {min: [minX, minY, minZ], max: [maxX, maxY, maxZ]};
}
