import * as THREE from 'three';

/** World distance subtended by one CSS pixel at a marker's camera depth. */
export function worldUnitsPerPixel(
  camera: THREE.Camera,
  position: THREE.Vector3,
  viewportHeight: number,
): number {
  const depth =
    camera instanceof THREE.PerspectiveCamera
      ? Math.abs(position.clone().applyMatrix4(camera.matrixWorldInverse).z)
      : 1;
  return (2 * depth) / (camera.projectionMatrix.elements[5] * viewportHeight);
}
