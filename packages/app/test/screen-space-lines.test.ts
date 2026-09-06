import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as THREE from 'three';
import {createAppTestServer, type AppTestServer} from './vite-test-server.ts';

let server: AppTestServer;
let ScreenSpaceCornerLines: typeof import('../src/rendering/screen-space-lines.ts').ScreenSpaceCornerLines;
let writeBoxEdges: typeof import('../src/rendering/box-edges.ts').writeBoxEdges;
before(async () => {
  server = await createAppTestServer();
  ({ScreenSpaceCornerLines} = await server.ssrLoadModule<
    typeof import('../src/rendering/screen-space-lines.ts')
  >('/src/rendering/screen-space-lines.ts'));
  ({writeBoxEdges} = await server.ssrLoadModule<
    typeof import('../src/rendering/box-edges.ts')
  >('/src/rendering/box-edges.ts'));
});
after(async () => server?.close());

test('flat, linear and point bounds do not duplicate or invent edges', () => {
  const positions = new Float32Array(72);
  for (const [max, expected] of [
    [[2, 3, 4], 12],
    [[2, 0, 4], 4],
    [[0, 3, 0], 1],
    [[0, 0, 0], 0],
  ] as const) {
    const count = writeBoxEdges(positions, [0, 0, 0], max);
    assert.equal(count, expected);
    const edges = new Set();
    for (let index = 0; index < count * 6; index += 6) {
      const ends = [
        [...positions.slice(index, index + 3)].join(','),
        [...positions.slice(index + 3, index + 6)].join(','),
      ];
      assert.notEqual(ends[0], ends[1]);
      edges.add(ends.sort().join('|'));
    }
    assert.equal(edges.size, expected);
  }
});

test('both ends of a receding edge obey the pixel cap while short edges retain corners', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  const edges = new Float32Array([-100, 0, -10, 100, 0, -500]);
  const lines = new ScreenSpaceCornerLines(edges, '#d8ff3e', 1);
  for (const height of [200, 1000])
    for (const distance of [0, 500]) {
      camera.position.z = distance;
      camera.updateMatrixWorld();
      lines.update(camera, height, height);
      const starts = lines.geometry.getAttribute('instanceStart');
      const ends = lines.geometry.getAttribute('instanceEnd');
      for (const i of [0, 1]) {
        const start = new THREE.Vector3()
          .fromBufferAttribute(starts, i)
          .project(camera);
        const end = new THREE.Vector3()
          .fromBufferAttribute(ends, i)
          .project(camera);
        const pixels =
          (start.distanceTo(new THREE.Vector3(end.x, end.y, start.z)) *
            height) /
          2;
        assert.ok(pixels <= 32.001, String(pixels));
        assert.ok(pixels > 0);
        const extent = Math.abs(ends.getX(i) - starts.getX(i));
        assert.ok(extent <= 36.0001);
        assert.ok(Math.abs(pixels - 32) < 1e-3 || Math.abs(extent - 36) < 1e-4);
      }
    }
  lines.geometry.dispose();
  lines.material.dispose();
});

test('zero-length corners remain finite', () => {
  const lines = new ScreenSpaceCornerLines(
    new Float32Array([0, 0, -10, 0, 0, -10]),
    '#d8ff3e',
    1,
  );
  lines.update(new THREE.PerspectiveCamera(), 600, 600);
  const starts = lines.geometry.getAttribute('instanceStart');
  for (const i of [0, 1])
    assert.ok(
      [starts.getX(i), starts.getY(i), starts.getZ(i)].every(Number.isFinite),
    );
  lines.geometry.dispose();
  lines.material.dispose();
});
