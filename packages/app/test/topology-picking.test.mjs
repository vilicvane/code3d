import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {Matrix4, PerspectiveCamera} from 'three';
import {createAppTestServer} from './vite-test-server.mjs';

let server;
let pickScreenTopology;
const viewport = {width: 1000, height: 800};
const camera = new PerspectiveCamera(60, 1.25, 0.1, 1000);

before(async () => {
  server = await createAppTestServer();
  ({pickScreenTopology} = await server.ssrLoadModule(
    '/src/rendering/topology-picking.ts',
  ));
});
after(async () => {
  await server?.close();
});

function vertices(positions) {
  return {
    topologyVertices: new Float32Array(positions.flat()),
    vertexIds: positions.map((_, index) => index + 1),
  };
}
function edges(positions) {
  return {
    edges: new Float32Array(positions.flat()),
    edgeGroups: [{start: 0, count: positions.length, edgeId: 17}],
  };
}
function pick(mesh, kind, x, y, matrix = camera.projectionMatrix) {
  return pickScreenTopology(mesh, kind, matrix, {x, y}, viewport);
}

test('vertex tolerance stays six CSS pixels across zoom and model scale', () => {
  for (const depth of [1, 10, 100]) {
    const mesh = vertices([[0, 0, -depth]]);
    assert.equal(pick(mesh, 'vertex', 505, 400), 1);
    assert.equal(pick(mesh, 'vertex', 507, 400), undefined);
  }
  const matrix = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    new Matrix4().makeScale(10, 10, 10),
  );
  assert.equal(pick(vertices([[0, 0, -1]]), 'vertex', 505, 400, matrix), 1);
  assert.equal(
    pick(vertices([[0, 0, -1]]), 'vertex', 507, 400, matrix),
    undefined,
  );
});

test('chooses the nearest screen point, using depth for overlapping points', () => {
  assert.equal(
    pick(
      vertices([
        [0, 0, -10],
        [0.05, 0, -10],
      ]),
      'vertex',
      503,
      400,
    ),
    2,
  );
  assert.equal(
    pick(
      vertices([
        [0, 0, -10],
        [0, 0, -5],
      ]),
      'vertex',
      500,
      400,
    ),
    2,
  );
});

test('edge tolerance is measured from the segment in CSS pixels', () => {
  for (const depth of [1, 10, 100]) {
    const mesh = edges([
      [-2, 0, -depth],
      [2, 0, -depth],
    ]);
    assert.equal(pick(mesh, 'edge', 500, 405), 17);
    assert.equal(pick(mesh, 'edge', 500, 407), undefined);
  }
});

test('rejects geometry behind the camera and clips segments crossing the near plane', () => {
  assert.equal(pick(vertices([[0, 0, 1]]), 'vertex', 500, 400), undefined);
  assert.equal(
    pick(
      edges([
        [-1, 0, 1],
        [1, 0, 1],
      ]),
      'edge',
      500,
      400,
    ),
    undefined,
  );
  assert.equal(
    pick(
      edges([
        [0, 0, 1],
        [0, 0, -10],
      ]),
      'edge',
      500,
      400,
    ),
    17,
  );
});
