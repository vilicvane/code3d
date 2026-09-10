import {Box3, Vector3} from 'three';
import {
  frameCameraBounds,
  setCameraViewHeight,
  type ViewCamera,
} from './view-camera.ts';

export type ImageView = Readonly<{
  direction: readonly [number, number, number];
  up: readonly [number, number, number];
}>;

/** Fit the observation bounds for the image aspect ratio, without moving a live camera. */
export function orientImageCamera(
  camera: ViewCamera,
  bounds: Box3,
  view: ImageView,
): void {
  const {focus, distance, viewHeight} = frameCameraBounds(
    camera,
    bounds,
    1 / 1.15,
  );
  camera.position
    .copy(focus)
    .addScaledVector(new Vector3(...view.direction).normalize(), distance);
  camera.up.set(...view.up);
  camera.lookAt(focus);
  camera.near = Math.max(distance / 1000, Number.EPSILON);
  camera.far = distance + bounds.getSize(new Vector3()).length() * 2 + 1;
  setCameraViewHeight(camera, viewHeight, distance);
  camera.updateMatrixWorld(true);
}
