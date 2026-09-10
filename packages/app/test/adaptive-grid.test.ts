import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {createAppTestServer} from './vite-test-server.ts';

test('a position drag freezes grid spacing and the occurrence frame until released', async t => {
  const server = await createAppTestServer();
  t.after(() => server.close());
  const {AdaptiveGrid} = await server.ssrLoadModule<
    typeof import('../src/rendering/adaptive-grid.ts')
  >('/src/rendering/adaptive-grid.ts');
  const grid = new AdaptiveGrid(new THREE.Color('#171815'));
  t.after(() => {
    grid.geometry.dispose();
    grid.material.dispose();
  });
  const parent = new THREE.Object3D();
  parent.position.set(10, -4, 8);
  parent.rotation.y = 0.6;
  const target = new THREE.Object3D();
  target.position.set(2, 3, 4);
  parent.add(target);
  grid.target = target;
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 1000);
  camera.position.set(20, 30, 50);
  camera.lookAt(grid.focus);
  grid.update(camera, 600, 2);
  const snapshot = () => ({
    step: grid.step,
    plane: grid.plane,
    origin: grid['origin'].toArray(),
    frame: grid['frame'].toArray(),
  });
  const before = snapshot();
  assert.equal(grid.lock(), before.step);
  target.position.set(-50, 20, 80);
  parent.rotation.set(0.3, -0.7, 0.8);
  const otherView = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  otherView.position.set(0, 0, 100);
  otherView.lookAt(0, 0, 0);
  grid.update(otherView, 2400, 1);
  assert.deepEqual(
    snapshot(),
    before,
    'Moving instances and export cameras preserve the drag grid',
  );
  grid.unlock();
  grid.update(otherView, 2400, 1);
  assert.notEqual(grid.step, before.step);
  assert.notDeepEqual(grid['origin'].toArray(), before.origin);
  assert.deepEqual(
    grid['origin'].toArray(),
    target.getWorldPosition(new THREE.Vector3()).toArray(),
  );
  assert.deepEqual(
    grid['frame'].toArray(),
    target.getWorldQuaternion(new THREE.Quaternion()).toArray(),
  );
});
