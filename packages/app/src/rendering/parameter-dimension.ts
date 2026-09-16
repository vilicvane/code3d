import * as THREE from 'three';
import type {Vec3} from '@code3d/core/tooling';

/** Pick once when focus enters the parameter; orbiting cannot make it jump. */
export function representativeDimensionEdge<
  Edge extends Readonly<{start: Vec3; end: Vec3}>,
>(
  edges: readonly Edge[],
  camera: THREE.Camera,
  matrixWorld: THREE.Matrix4,
): Edge | undefined {
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
  let nearest: Edge | undefined;
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
