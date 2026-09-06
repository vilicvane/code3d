import {
  rotateVector,
  composeTransforms,
  type ElementSnapshot,
  type ModelSnapshotObject,
  type RenderMesh,
  type Transform,
  type Vec3,
} from '@code3d/core/tooling';
import type {
  SourceDecorationProvider,
  ViewportAnchorDecoration,
  ViewportDecoration,
} from '../viewport-decoration';
import type {ModelModule, SourceTargetEvaluation} from './compiler';
import {evaluatedConstraint, focusedConstraintSide} from './constraint-context';
import {boundAppearance} from '../rendering/bound-appearance';

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

const boundSurfaceAppearance = {
  ...boundAppearance,
  opacity: 0.18,
  depthBias: 3,
  shading: 'unlit',
} as const;

function sourceElementReferences(evaluation: SourceTargetEvaluation) {
  if (evaluation.element && evaluation.topologyReferences?.length) return [];
  return evaluation.element
    ? [evaluation.element]
    : (evaluation.anchorReferences ?? []);
}

export const elementSourceDecoration = {
  id: 'named-element',
  decorations({module, evaluation}) {
    if (evaluatedConstraint(module.objects, evaluation)) return [];
    return sourceElementReferences(evaluation).flatMap(reference => {
      const node = module.objects.get(reference.nodeId);
      return node ? namedElementDecorations(node, reference) : [];
    });
  },
} satisfies SourceDecorationProvider;

export function namedElementDecorations(
  node: ModelSnapshotObject,
  element: ElementSnapshot,
): readonly ViewportDecoration[] {
  const surface = element.bound
    ? boundMesh(element)
    : element.kind === 'face' && node.mesh
      ? faceSurfaceAt(node.mesh, element.transform)
      : undefined;
  const anchorBase = {
    kind: 'anchor' as const,
    id: `${node.nodeId}:${element.name}`,
    nodeId: node.nodeId,
    transform: element.transform,
    facing: element.bound?.facing ?? element.facing,
  };
  const anchor: ViewportAnchorDecoration =
    element.kind === 'line'
      ? {
          ...anchorBase,
          elementKind: element.kind,
          span: axisDisplaySpan(node, element.transform),
          appearance: axisAppearance,
        }
      : {
          ...anchorBase,
          elementKind: element.kind,
          appearance: element.bound
            ? boundAppearance
            : element.kind === 'face'
              ? faceAppearance
              : elementAppearance,
        };
  return [
    ...(surface
      ? [
          {
            kind: 'surface' as const,
            id: `${node.nodeId}:${element.name}:surface`,
            nodeId: node.nodeId,
            mesh: surface,
            appearance: element.bound ? boundSurfaceAppearance : faceAppearance,
          },
        ]
      : []),
    ...(surface && element.bound
      ? [
          {
            kind: 'edges' as const,
            id: `${node.nodeId}:${element.name}:corners`,
            nodeId: node.nodeId,
            mesh: surface,
            transform: {
              position: [0, 0, 0],
              quaternion: [0, 0, 0, 1],
              scale: [1, 1, 1],
            } as const,
            visibility: 'without-object-bounds' as const,
            corners: true,
            appearance: boundAppearance,
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
  const groups = mesh.surfaceGroups.filter(group =>
    surfaceGroupMatches(mesh, group, transform.position, normal, tolerance),
  );
  if (groups.length === 0) return undefined;

  const indices = groups.flatMap(group => [
    ...mesh.triangles.slice(group.start, group.start + group.count),
  ]);
  const triangles = new Uint32Array(indices);
  let groupStart = 0;
  const surfaceGroups = groups.map(group => {
    const snapshot = {
      start: groupStart,
      count: group.count,
      surfaceId: group.surfaceId,
    };
    groupStart += group.count;
    return snapshot;
  });
  return {
    vertices: mesh.vertices,
    normals: mesh.normals,
    triangles,
    edges: boundaryEdges(mesh.vertices, triangles),
    topologyVertices: new Float32Array(),
    vertexIds: [],
    surfaceGroups,
    edgeGroups: [],
  };
}

function surfaceGroupMatches(
  mesh: RenderMesh,
  group: RenderMesh['surfaceGroups'][number],
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

function axisDisplaySpan(
  node: ModelSnapshotObject,
  transform: Transform,
): Readonly<{negative: number; positive: number}> {
  const direction = rotateVector([0, 1, 0], transform.quaternion);
  let negative = 0;
  let positive = 0;
  const visit = (
    node: ModelSnapshotObject,
    toRoot: (point: Vec3) => Vec3,
  ): void => {
    if (node.mesh) {
      const points = meshPoints(node.mesh);
      for (let index = 0; index < points.length; index += 3) {
        const point = toRoot([
          points[index],
          points[index + 1],
          points[index + 2],
        ]);
        const projection =
          dot(
            [
              point[0] - transform.position[0],
              point[1] - transform.position[1],
              point[2] - transform.position[2],
            ],
            direction,
          ) / transform.scale[1];
        negative = Math.max(negative, -projection);
        positive = Math.max(positive, projection);
      }
    }
    for (const child of node.children) {
      const placement = child.compositionTransform;
      visit(child, point =>
        toRoot(
          composeTransforms(placement, {
            position: [
              point[0] * placement.scale[0],
              point[1] * placement.scale[1],
              point[2] * placement.scale[2],
            ],
            quaternion: [0, 0, 0, 1],
          }).position,
        ),
      );
    }
  };
  visit(node, point => point);
  return {negative, positive};
}

function meshBounds(mesh: RenderMesh): Readonly<{min: Vec3; max: Vec3}> {
  const vertices = meshPoints(mesh);
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

function meshPoints(mesh: RenderMesh): Float32Array {
  return mesh.vertices.length >= 3
    ? mesh.vertices
    : mesh.edges.length >= 3
      ? mesh.edges
      : mesh.topologyVertices;
}

function boundMesh(element: ElementSnapshot): RenderMesh {
  const [x, z] = element.bound!.size;
  const points: Vec3[] = [
    [-x / 2, 0, -z / 2],
    [x / 2, 0, -z / 2],
    [x / 2, 0, z / 2],
    [-x / 2, 0, z / 2],
  ];
  const toWorld = (position: Vec3) =>
    composeTransforms(element.transform, {position, quaternion: [0, 0, 0, 1]})
      .position;
  const positions = points.map(toWorld);
  const normal = rotateVector(
    [0, element.bound!.facing, 0],
    element.transform.quaternion,
  );
  return {
    vertices: new Float32Array(positions.flat()),
    normals: new Float32Array(positions.flatMap(() => normal)),
    triangles: new Uint32Array([0, 2, 1, 0, 3, 2]),
    edges: new Float32Array(
      positions.flatMap((point, index) => [
        ...point,
        ...positions[(index + 1) % 4],
      ]),
    ),
    topologyVertices: new Float32Array(),
    vertexIds: [],
    surfaceGroups: [],
    edgeGroups: [],
  };
}

const secondaryRelationMarkerOpacity = 0.7;

export const relationSourceDecoration: SourceDecorationProvider = {
  id: 'relation-geometry',
  decorations({module, evaluation}) {
    const constraint = evaluatedConstraint(module.objects, evaluation);
    if (!constraint) return [];
    const focus = focusedConstraintSide(evaluation, constraint);
    return (['source', 'target'] as const).flatMap(side => {
      const node = module.objects.get(constraint[side].nodeId);
      if (!node) return [];
      const element =
        side === 'source' ? constraint.sourceElement : constraint.targetElement;
      const decorations: readonly ViewportDecoration[] =
        constraint.kind === 'align'
          ? alignedElementDecorations(module, node, element)
          : [
              ...(side === 'source'
                ? [
                    {
                      kind: 'bounds' as const,
                      id: 'bounds',
                      nodeId: node.nodeId,
                      ...constraint.sourceBounds,
                      appearance: boundAppearance,
                    },
                  ]
                : []),
              ...namedElementDecorations(node, element),
            ];
      const opacity = side === focus ? 1 : secondaryRelationMarkerOpacity;
      return decorations.map(decoration => ({
        ...decoration,
        id: `${constraint.id}:${side}:${decoration.id}`,
        appearance: {
          ...decoration.appearance,
          opacity: (decoration.appearance.opacity ?? 1) * opacity,
          edgeOpacity: decoration.appearance.edgeColor
            ? (decoration.appearance.edgeOpacity ?? 1) * opacity
            : undefined,
        },
      }));
    });
  },
};

function alignedElementDecorations(
  module: ModelModule,
  node: ModelSnapshotObject,
  element: ElementSnapshot,
): readonly ViewportDecoration[] {
  const decorations = namedElementDecorations(node, element);
  const topology = element.topology;
  const geometry = topology && module.objects.get(topology.geometryNodeId);
  const curve = element.kind === 'line' && element.arrow;
  const anchors = decorations
    .filter(d => d.kind === 'anchor')
    .map(d => ({
      ...d,
      transform: curve
        ? {...element.arrow!, scale: [1, 1, 1] as const}
        : d.transform,
      direction: curve ? (1 as const) : (element.direction ?? 1),
      headOnly: !!curve,
      directed: true,
    }));
  if (!geometry?.mesh || !topology)
    return [...decorations.filter(d => d.kind !== 'anchor'), ...anchors];
  if (topology.kind === 'edge')
    return [
      {
        kind: 'edges',
        nodeId: node.nodeId,
        id: 'curve',
        mesh: geometry.mesh,
        edgeIds: [topology.id],
        transform: topology.transform,
        appearance: axisAppearance,
      },
      ...anchors,
    ];
  if (topology.kind === 'surface') {
    const groups = geometry.mesh.surfaceGroups.filter(
      group => JSON.stringify(group.surfaceId) === JSON.stringify(topology.id),
    );
    const triangles = new Uint32Array(
      groups.flatMap(group => [
        ...geometry.mesh!.triangles.slice(
          group.start,
          group.start + group.count,
        ),
      ]),
    );
    const mesh = {
      ...geometry.mesh,
      triangles,
      edges: boundaryEdges(geometry.mesh.vertices, triangles),
      edgeGroups: [],
    };
    return [
      {
        kind: 'mesh',
        nodeId: node.nodeId,
        id: 'surface',
        mesh,
        transform: topology.transform,
        appearance: faceAppearance,
      },
      ...anchors,
    ];
  }
  return anchors;
}
