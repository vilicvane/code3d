import {
  Box3,
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Sphere,
  Vector3,
} from 'three';

export type ViewCamera = PerspectiveCamera | OrthographicCamera;
export type CameraProjection = 'perspective' | 'orthographic';
export type CameraFraming = Readonly<{
  focus: Vector3;
  distance: number;
  viewHeight: number;
}>;

export const defaultFieldOfView = 42;

export function cameraProjection(camera: ViewCamera): CameraProjection {
  return camera instanceof PerspectiveCamera ? 'perspective' : 'orthographic';
}

export function cameraAspect(camera: ViewCamera): number {
  return camera instanceof PerspectiveCamera
    ? camera.aspect
    : (camera.right - camera.left) / (camera.top - camera.bottom);
}

export function resizeViewCamera(camera: ViewCamera, aspect: number): void {
  if (camera instanceof PerspectiveCamera) camera.aspect = aspect;
  else {
    const halfWidth = ((camera.top - camera.bottom) * aspect) / 2;
    camera.left = -halfWidth;
    camera.right = halfWidth;
  }
  camera.updateProjectionMatrix();
}

/** Vertical world span at the observation center, including orthographic zoom. */
export function cameraViewHeight(camera: ViewCamera, distance: number): number {
  return (
    (2 * (camera instanceof PerspectiveCamera ? distance : 1)) /
    camera.projectionMatrix.elements[5]
  );
}

export function perspectiveDistance(viewHeight: number): number {
  return (
    viewHeight / (2 * Math.tan(MathUtils.degToRad(defaultFieldOfView) / 2))
  );
}

export function setCameraViewHeight(
  camera: ViewCamera,
  viewHeight: number,
  distance: number,
): void {
  const aspect = cameraAspect(camera);
  camera.zoom = 1;
  if (camera instanceof PerspectiveCamera)
    camera.fov = MathUtils.radToDeg(2 * Math.atan(viewHeight / (2 * distance)));
  else {
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.left = (-viewHeight * aspect) / 2;
    camera.right = (viewHeight * aspect) / 2;
  }
  camera.updateProjectionMatrix();
}

export function createViewCamera(
  projection: CameraProjection,
  aspect: number,
): ViewCamera {
  return projection === 'perspective'
    ? new PerspectiveCamera(defaultFieldOfView, aspect, 0.1, 2000)
    : new OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 2000);
}

export function frameCameraBounds(
  camera: ViewCamera,
  bounds: Box3,
  availableFraction = 1,
): CameraFraming {
  const sphere = bounds.getBoundingSphere(new Sphere());
  const radius = (sphere.radius || 0.5) / availableFraction;
  const aspect = cameraAspect(camera);
  const halfVertical =
    MathUtils.degToRad(
      camera instanceof PerspectiveCamera
        ? camera.getEffectiveFOV()
        : defaultFieldOfView,
    ) / 2;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  const distance = radius / Math.sin(Math.min(halfVertical, halfHorizontal));
  return {
    focus: sphere.center,
    distance,
    viewHeight:
      camera instanceof PerspectiveCamera
        ? 2 * distance * Math.tan(halfVertical)
        : (2 * radius) / Math.min(aspect, 1),
  };
}

/** Native-camera dolly zoom: flatten depth while preserving the focus-plane scale. */
export function updateProjectionCamera(
  camera: ViewCamera,
  navigation: ViewCamera,
  focus: Vector3,
  perspective: number,
): void {
  const distance = navigation.position.distanceTo(focus);
  const viewHeight = cameraViewHeight(navigation, distance);
  // The final frame uses a true orthographic camera. This finite intermediate
  // limit avoids sending a perspective eye to infinity as its field of view closes.
  const displayedDistance =
    perspective === 0 ? distance : distance / Math.max(perspective, 0.001);
  resizeViewCamera(camera, cameraAspect(navigation));
  camera.quaternion.copy(navigation.quaternion);
  camera.up.copy(navigation.up);
  camera.position
    .set(0, 0, displayedDistance)
    .applyQuaternion(camera.quaternion)
    .add(focus);
  setCameraViewHeight(camera, viewHeight, displayedDistance);
  camera.updateMatrixWorld();
}
