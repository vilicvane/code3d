import {Box3, PerspectiveCamera, Sphere, Vector3} from 'three';

export type ImageView = Readonly<{
  direction: readonly [number, number, number];
  up: readonly [number, number, number];
}>;

/** Fit the observation bounds for the image aspect ratio, without moving a live camera. */
export function orientImageCamera(
  camera: PerspectiveCamera,
  bounds: Box3,
  view: ImageView,
): void {
  const sphere = bounds.getBoundingSphere(new Sphere());
  const halfVertical = (camera.getEffectiveFOV() * Math.PI) / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
  const radius = Math.max(sphere.radius, 0.5);
  const distance =
    (radius * 1.15) / Math.sin(Math.min(halfVertical, halfHorizontal));
  camera.position
    .copy(sphere.center)
    .addScaledVector(new Vector3(...view.direction).normalize(), distance);
  camera.up.set(...view.up);
  camera.lookAt(sphere.center);
  camera.near = Math.max(distance / 1000, Number.EPSILON);
  camera.far = distance + radius * 4;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}
