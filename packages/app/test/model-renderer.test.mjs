import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as THREE from 'three';
import {createAppTestServer} from './vite-test-server.mjs';

let createRenderedModelNode;
let server;

before(async () => {
  server = await createAppTestServer();
  ({createRenderedModelNode} = await server.ssrLoadModule(
    '/src/rendering/model-renderer.ts',
  ));
});

after(async () => {
  await server?.close();
});

test('renders face models from both sides without changing solid culling', () => {
  const face = createRenderedModelNode(snapshot('face'));
  const solid = createRenderedModelNode(snapshot('solid'));

  assert.ok(face.children[0] instanceof THREE.Mesh);
  assert.equal(face.children[0].material.side, THREE.DoubleSide);
  assert.ok(solid.children[0] instanceof THREE.Mesh);
  assert.equal(solid.children[0].material.side, THREE.FrontSide);
});

test('renders curves in their model color with a visible neutral fallback', () => {
  const unpainted = createRenderedModelNode(snapshot('edge'));
  const painted = createRenderedModelNode(snapshot('edge', '#ff4d81'));

  assert.equal(unpainted.children.length, 1);
  assert.ok(unpainted.children[0] instanceof THREE.LineSegments);
  assert.equal(unpainted.children[0].material.color.getHexString(), 'dde0dc');
  assert.equal(unpainted.children[0].material.opacity, 1);
  assert.equal(unpainted.children[0].material.transparent, false);
  assert.equal(unpainted.children[0].material.toneMapped, false);
  assert.equal(painted.children[0].material.color.getHexString(), 'ff4d81');
});

function snapshot(kind, color) {
  return {
    kind,
    name: kind,
    color,
    children: [],
    mesh: {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      triangles: new Uint32Array([0, 1, 2]),
      edges: new Float32Array([0, 0, 0, 1, 0, 0]),
      topologyVertices: new Float32Array([0, 0, 0, 1, 0, 0]),
      vertexIds: [1, 2],
      surfaceGroups: [{start: 0, count: 3, surfaceId: 1}],
      edgeGroups: [{start: 0, count: 6, edgeId: 1}],
    },
  };
}
