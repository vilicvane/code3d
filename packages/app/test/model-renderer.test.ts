import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as THREE from 'three';
import {box, group} from '@code3d/core';
import {
  createModelSnapshotter,
  disposeModelObjects,
} from '../../core/test/model-test.ts';
import type {ModelSnapshotObject, ModelKind} from '@code3d/core/tooling';
import {createAppTestServer} from './vite-test-server.ts';

let createRenderedModelNode: (typeof import('../src/rendering/model-renderer.ts'))['createRenderedModelNode'],
  createRenderedModel: (typeof import('../src/rendering/model-renderer.ts'))['createRenderedModel'],
  disposeObject: (typeof import('../src/rendering/model-renderer.ts'))['disposeObject'];
let server: Awaited<ReturnType<typeof createAppTestServer>>;

before(async () => {
  server = await createAppTestServer();
  ({createRenderedModelNode, createRenderedModel, disposeObject} =
    await server.ssrLoadModule<
      typeof import('../src/rendering/model-renderer.ts')
    >('/src/rendering/model-renderer.ts'));
});

after(async () => {
  await server?.close();
});

test('renders a group override on nested painted and unpainted parts', () => {
  const first = box(2, 4, 6).paint('#ff0000');
  const second = box(1, 2, 3);
  const assembly = group([first, group([second])]).paint('#345678');
  const rendered = createRenderedModel(createModelSnapshotter()(assembly));
  try {
    const meshes: THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >[] = [];
    rendered.traverse(object => {
      if (
        object instanceof THREE.Mesh &&
        object.material instanceof THREE.MeshStandardMaterial
      )
        meshes.push(object);
    });
    assert.equal(meshes.length, 2);
    for (const mesh of meshes) {
      assert.equal(mesh.material.color.getHexString(), '345678');
      assert.equal(mesh.material.transparent, false);
    }
  } finally {
    disposeObject(rendered);
    disposeModelObjects([first, second, assembly]);
  }
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
  assert.ok(painted.children[0] instanceof THREE.LineSegments);
  assert.equal(painted.children[0].material.color.getHexString(), 'ff4d81');
});

function snapshot(kind: ModelKind, color?: string): ModelSnapshotObject {
  return {
    ...createModelSnapshotter()(group([])),
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
