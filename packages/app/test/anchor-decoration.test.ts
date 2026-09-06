import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as THREE from 'three';
import type {ViewportAnchorDecoration} from '../src/viewport-decoration.ts';
import {createAppTestServer, type AppTestServer} from './vite-test-server.ts';

let server: AppTestServer;
let AnchorDecorationObject: typeof import('../src/rendering/anchor-decoration.ts').AnchorDecorationObject;

before(async () => {
  server = await createAppTestServer();
  ({AnchorDecorationObject} = await server.ssrLoadModule<
    typeof import('../src/rendering/anchor-decoration.ts')
  >('/src/rendering/anchor-decoration.ts'));
});
after(async () => server?.close());

const base = {
  kind: 'anchor',
  nodeId: 'node',
  id: 'marker',
  transform: {position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1]},
  appearance: {color: '#d8ff3e', opacity: 0.4},
} as const;

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
}

for (const perspective of [true, false]) {
  test(`face and axis arrows keep their pixel lengths with ${perspective ? 'perspective' : 'orthographic'} projection`, () => {
    const camera = perspective
      ? new THREE.PerspectiveCamera(60, 1, 0.001, 10000)
      : new THREE.OrthographicCamera(-50, 50, 50, -50, 0.001, 10000);
    const configurations: ViewportAnchorDecoration[] = [
      {...base, elementKind: 'face', facing: 1},
      {...base, elementKind: 'face', facing: -1},
      {...base, elementKind: 'line', span: {negative: 3, positive: 7}},
      {
        ...base,
        elementKind: 'line',
        span: {negative: 3, positive: 7},
        directed: true,
        direction: -1,
      },
    ];
    for (const decoration of configurations) {
      const anchor = new AnchorDecorationObject(decoration);
      const parent = new THREE.Group();
      parent.add(anchor);
      for (const distance of [10, 1000])
        for (const scale of [0.01, 1, 100])
          for (const height of [240, 960])
            for (const zoom of [0.5, 2]) {
              camera.position.set(0, 0, distance);
              camera.zoom = zoom;
              camera.updateProjectionMatrix();
              parent.scale.set(scale * 0.5, scale, scale * 2);
              anchor.update(camera, height);
              parent.updateMatrixWorld(true);
              const heads: THREE.Object3D[] = [];
              anchor.traverse(object => {
                if (object.name === 'direction-arrow-head') heads.push(object);
              });
              assert.equal(
                heads.length,
                decoration.elementKind === 'line' && !decoration.directed
                  ? 2
                  : 1,
              );
              for (const head of heads) {
                const tip = head
                  .getWorldPosition(new THREE.Vector3())
                  .project(camera);
                const tail = head
                  .parent!.getWorldPosition(new THREE.Vector3())
                  .project(camera);
                near((Math.abs(tip.y - tail.y) * height) / 2, 28);
                const direction =
                  decoration.elementKind === 'face'
                    ? decoration.facing
                    : decoration.directed
                      ? decoration.direction
                      : Math.sign(tip.y);
                assert.equal(Math.sign(tip.y - tail.y), direction);
              }
            }
    }
  });
}

test('point, ring and coordinate-frame markers ignore occurrence scale', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  for (const elementKind of ['point', 'frame', 'face'] as const) {
    const anchor = new AnchorDecorationObject({...base, elementKind});
    const parent = new THREE.Group();
    parent.add(anchor);
    for (const [distance, height, scale] of [
      [10, 240, 0.01],
      [1000, 960, 100],
    ]) {
      camera.position.z = distance;
      parent.scale.setScalar(scale);
      anchor.update(camera, height);
      parent.updateMatrixWorld(true);
      const marker = anchor.children[0];
      const origin = marker.localToWorld(new THREE.Vector3()).project(camera);
      const unit = marker
        .localToWorld(new THREE.Vector3(0, 1, 0))
        .project(camera);
      near(((unit.y - origin.y) * height) / 2, 1);
    }
  }
});

test('curve direction heads stay exactly at the supplied endpoint', () => {
  const decoration: ViewportAnchorDecoration = {
    ...base,
    elementKind: 'line',
    headOnly: true,
    span: {negative: 0, positive: 0},
    transform: {...base.transform, position: [3, 4, 5]},
  };
  const anchor = new AnchorDecorationObject(decoration);
  anchor.update(new THREE.PerspectiveCamera(), 600);
  const head = anchor.children[0];
  assert.deepEqual(
    head.getWorldPosition(new THREE.Vector3()).toArray(),
    [3, 4, 5],
  );
});
