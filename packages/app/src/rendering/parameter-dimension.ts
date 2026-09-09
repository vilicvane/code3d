import * as THREE from 'three';
import type {
  EdgeId,
  ModelParameterDimension,
  RenderMesh,
  Vec3,
} from '@code3d/core/tooling';

export type DimensionEdge = Readonly<{
  id: EdgeId;
  start: Vec3;
  end: Vec3;
}>;

/** A dimension is represented only by a complete straight edge of that length. */
export function dimensionEdges(
  mesh: Pick<RenderMesh, 'edges' | 'edgeGroups'>,
  dimension: ModelParameterDimension,
): readonly DimensionEdge[] {
  const vector = new THREE.Vector3(...dimension.vector);
  const length = vector.length();
  const direction = vector.clone().normalize();
  const tolerance = length * 1e-5;
  return mesh.edgeGroups.flatMap(group => {
    const points = mesh.edges.subarray(
      group.start * 3,
      (group.start + group.count) * 3,
    );
    if (points.length < 6) return [];
    const start = new THREE.Vector3().fromArray(points);
    const end = new THREE.Vector3().fromArray(points, points.length - 3);
    const delta = end.clone().sub(start);
    if (
      Math.abs(delta.length() - length) > tolerance ||
      delta.clone().cross(direction).length() > tolerance
    )
      return [];
    for (let i = 0; i < points.length; i += 3) {
      const point = new THREE.Vector3().fromArray(points, i).sub(start);
      if (point.cross(direction).length() > tolerance) return [];
    }
    return [{id: group.edgeId, start: start.toArray(), end: end.toArray()}];
  });
}

/** Pick once when focus enters the parameter; orbiting cannot make it jump. */
export function representativeDimensionEdge(
  edges: readonly DimensionEdge[],
  camera: THREE.Camera,
  matrixWorld: THREE.Matrix4,
): DimensionEdge | undefined {
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
  let nearest: DimensionEdge | undefined;
  let distance = Infinity;
  for (const edge of edges) {
    const center = new THREE.Vector3(...edge.start)
      .add(new THREE.Vector3(...edge.end))
      .multiplyScalar(0.5)
      .applyMatrix4(matrixWorld);
    const candidateDistance = center.distanceToSquared(cameraPosition);
    if (candidateDistance < distance) {
      nearest = edge;
      distance = candidateDistance;
    }
  }
  return nearest;
}
