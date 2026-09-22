import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BoxGeometry, Group, Mesh, Raycaster, Vector2, Vector3} from 'three';
import {
  cameraViewHeight,
  cameraContainsGeometry,
  createViewCamera,
  perspectiveDistance,
  resizeViewCamera,
  setCameraViewHeight,
  updateProjectionCamera,
} from '../src/rendering/view-camera.ts';

test('viewport containment projects transformed geometry with pixel margins in both projections', () => {
  const root = new Group();
  const geometry = new BoxGeometry(10, 10, 10);
  const body = new Mesh(geometry);
  root.add(body);
  try {
    for (const projection of ['perspective', 'orthographic'] as const) {
      const camera = createViewCamera(projection, 1);
      camera.position.set(0, 0, 50);
      camera.lookAt(0, 0, 0);
      setCameraViewHeight(camera, 20, 50);
      body.position.set(0, 0, 0);
      body.scale.setScalar(1);
      assert.equal(cameraContainsGeometry(camera, root, 800, 800, 12), true);
      body.scale.setScalar(5);
      assert.equal(cameraContainsGeometry(camera, root, 800, 800), false);
      body.scale.setScalar(1);
      body.position.set(20, 0, 0);
      assert.equal(cameraContainsGeometry(camera, root, 800, 800), false);
      body.visible = false;
      assert.equal(cameraContainsGeometry(camera, root, 800, 800), true);
      body.visible = true;
      body.position.set(0, 0, 70);
      assert.equal(cameraContainsGeometry(camera, root, 800, 800), false);
    }
    const camera = createViewCamera('orthographic', 1);
    camera.position.z = 50;
    setCameraViewHeight(camera, 10, 50);
    body.position.set(0.01, 0, 0);
    assert.equal(cameraContainsGeometry(camera, root, 800, 800, 3), false);
    assert.equal(cameraContainsGeometry(camera, root, 800, 800, -3), true);
    body.position.x = 0.1;
    assert.equal(cameraContainsGeometry(camera, root, 800, 800, -3), false);

    // A rotated thin model fits even when its world-axis box would be clipped.
    const aligned = createViewCamera('orthographic', 20);
    aligned.position.z = 50;
    aligned.rotation.z = Math.PI / 4;
    setCameraViewHeight(aligned, 2, 50);
    body.position.set(0, 0, 0);
    body.scale.set(3, 0.05, 0.05);
    body.rotation.z = Math.PI / 4;
    assert.equal(cameraContainsGeometry(aligned, root, 1000, 50), true);
  } finally {
    geometry.dispose();
    (body.material as import('three').Material).dispose();
  }
});

test('projection changes preserve the observation plane and orthographic depth has no scale', () => {
  for (const aspect of [0.5, 1.5, 3]) {
    const perspective = createViewCamera('perspective', aspect);
    const center = new Vector3(30, -5, 12);
    perspective.position.copy(center).add(new Vector3(0, 0, 100));
    perspective.lookAt(center);
    perspective.updateMatrixWorld();
    const height = cameraViewHeight(perspective, 100);
    const ortho = createViewCamera('orthographic', aspect);
    ortho.position.copy(perspective.position);
    ortho.quaternion.copy(perspective.quaternion);
    setCameraViewHeight(ortho, height, 100);
    ortho.updateMatrixWorld();
    for (const [x, y] of [
      [0, 0],
      [12, 8],
      [-10, -7],
    ]) {
      const point = center.clone().add(new Vector3(x, y, 0));
      const before = point.clone().project(perspective);
      const after = point.clone().project(ortho);
      near(before.x, after.x);
      near(before.y, after.y);
      point.z += 30;
      const raised = point.project(ortho);
      near(raised.x, after.x);
      near(raised.y, after.y);
    }
    ortho.zoom = 2.5;
    ortho.updateProjectionMatrix();
    const zoomedHeight = cameraViewHeight(ortho, 100);
    const returning = createViewCamera('perspective', aspect);
    const distance = perspectiveDistance(zoomedHeight);
    returning.position.copy(center).add(new Vector3(0, 0, distance));
    returning.lookAt(center);
    setCameraViewHeight(returning, zoomedHeight, distance);
    returning.updateMatrixWorld();
    const point = center.clone().add(new Vector3(5, 7, 0));
    const before = point.clone().project(ortho);
    const after = point.project(returning);
    near(before.x, after.x);
    near(before.y, after.y);
    resizeViewCamera(ortho, aspect / 2);
    near(cameraViewHeight(ortho, 100), zoomedHeight);
    near(
      ortho.projectionMatrix.elements[5] / ortho.projectionMatrix.elements[0],
      aspect / 2,
    );
  }
});

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

test('projection transitions preserve focus scale and continuously flatten depth', () => {
  const navigation = createViewCamera('perspective', 1.5);
  const focus = new Vector3(30, -5, 12);
  navigation.position.copy(focus).add(new Vector3(0, 0, 100));
  navigation.lookAt(focus);
  navigation.updateMatrixWorld();
  const plane = focus.clone().add(new Vector3(10, 5, 0));
  const nearPoint = plane.clone().add(new Vector3(0, 0, 25));
  const planeProjection = plane.clone().project(navigation);
  const displayed = createViewCamera('perspective', 1.5);
  let lastX = Infinity;
  for (const mix of [1, 0.75, 0.5, 0.25, 0.01, 0.001]) {
    updateProjectionCamera(displayed, navigation, focus, mix);
    near(plane.clone().project(displayed).x, planeProjection.x);
    near(plane.clone().project(displayed).y, planeProjection.y);
    const x = nearPoint.clone().project(displayed).x;
    assert.ok(x < lastX);
    lastX = x;
    // A native ray through a projected point still hits that point during the morph.
    const ray = new Raycaster();
    const projected = nearPoint.clone().project(displayed);
    ray.setFromCamera(new Vector2(projected.x, projected.y), displayed);
    assert.ok(ray.ray.distanceToPoint(nearPoint) < 1e-7);
  }
  const orthographic = createViewCamera('orthographic', 1.5);
  updateProjectionCamera(orthographic, navigation, focus, 0);
  near(nearPoint.clone().project(orthographic).x, planeProjection.x);
  assert.ok(
    (lastX - planeProjection.x) * 1000 < 0.1,
    'The final native-camera handoff is subpixel',
  );
});
