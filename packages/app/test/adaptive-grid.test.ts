import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {createAppTestServer} from './vite-test-server.ts';

test('a position drag freezes grid spacing and plane across export cameras until released', async t => {
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
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 1000);
  camera.position.set(20, 30, 50);
  camera.lookAt(grid.focus);
  grid.update(camera, 600, 2);
  const snapshot = () => ({
    step: grid.step,
    plane: grid.plane,
  });
  const before = snapshot();
  assert.equal(grid.lock(), before.step);
  const otherView = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  otherView.position.set(0, 0, 100);
  otherView.lookAt(0, 0, 0);
  grid.update(otherView, 2400, 1);
  assert.deepEqual(snapshot(), before, 'Export cameras preserve the drag grid');
  grid.unlock();
  grid.update(otherView, 2400, 1);
  assert.notEqual(grid.step, before.step);
  assert.equal(grid.plane, 'XY');
});
