import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as THREE from 'three';
import {box, group, point} from '@code3d/core';
import {
  createModelSnapshotter,
  disposeModelObjects,
} from '../../core/test/model-test.ts';
import type {ModelSnapshotObject, ModelKind} from '@code3d/core/tooling';
import {createAppTestServer} from './vite-test-server.ts';

let applySourceEmphasis: (typeof import('../src/rendering/source-appearance.ts'))['applySourceEmphasis'],
  createRenderedModelNode: (typeof import('../src/rendering/model-renderer.ts'))['createRenderedModelNode'],
  createRenderedModel: (typeof import('../src/rendering/model-renderer.ts'))['createRenderedModel'],
  disposeObject: (typeof import('../src/rendering/model-renderer.ts'))['disposeObject'];
let server: Awaited<ReturnType<typeof createAppTestServer>>;

before(async () => {
  server = await createAppTestServer();
  ({createRenderedModelNode, createRenderedModel, disposeObject} =
    await server.ssrLoadModule<
      typeof import('../src/rendering/model-renderer.ts')
    >('/src/rendering/model-renderer.ts'));
  ({applySourceEmphasis} = await server.ssrLoadModule<
    typeof import('../src/rendering/source-appearance.ts')
  >('/src/rendering/source-appearance.ts'));
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

for (const kind of ['solid', 'face', 'edge', 'vertex'] as const) {
  test(`${kind} paint keeps RGB and alpha for hex and functional colors`, () => {
    for (const [paint, rgb, opacity] of [
      ['#1a28', '11aa22', 8 / 15],
      ['#12345600', '123456', 0],
      ['#abcdefFF', 'abcdef', 1],
      ['rgb(17, 170, 34)', '11aa22', 1],
      ['rgba(17, 170, 34, 0.25)', '11aa22', 0.25],
      ['rgb(100%, 50%, 0%)', 'ff8000', 1],
      ['rgba(100%, 50%, 0%, 50%)', 'ff8000', 0.5],
      ['rgb(17 170 34 / 25%)', '11aa22', 0.25],
      ['rgb(\n17 170 34 / 25%\n)', '11aa22', 0.25],
      ['rgba(17 170 34 / 0)', '11aa22', 0],
      ['transparent', '000000', 0],
    ] as const) {
      const rendered = createRenderedModelNode(snapshot(kind, paint));
      try {
        const material = (
          rendered.children[0] as THREE.Mesh<
            THREE.BufferGeometry,
            THREE.MeshStandardMaterial
          >
        ).material;
        assert.equal(material.color.getHexString(), rgb, paint);
        assert.equal(material.opacity, opacity, paint);
        assert.equal(material.transparent, opacity < 1, paint);
        assert.equal(material.depthWrite, opacity === 1, paint);
        if (kind === 'solid' || kind === 'face') {
          const boundary = rendered.children[1] as THREE.LineSegments<
            THREE.BufferGeometry,
            THREE.LineBasicMaterial
          >;
          assert.equal(boundary.material.opacity, 0.72 * opacity, paint);
        }
      } finally {
        disposeObject(rendered);
      }
    }
  });
}

test('translucent group paint overrides descendants without compounding source opacity', () => {
  const part = box(2, 4, 6).paint('#ff0000');
  const assembly = group([part, group([part])]).paint(
    'rgba(17, 170, 34, 0.25)',
  );
  const rendered = createRenderedModel(createModelSnapshotter()(assembly));
  try {
    for (const [emphasis, opacity] of [
      ['primary', 0.25],
      ['secondary', 0.25],
      ['context', 0.18],
    ] as const) {
      applySourceEmphasis(rendered, emphasis);
      const materials: THREE.MeshStandardMaterial[] = [];
      rendered.traverse(object => {
        if (
          object instanceof THREE.Mesh &&
          object.material instanceof THREE.MeshStandardMaterial
        )
          materials.push(object.material);
      });
      assert.equal(materials.length, 2);
      for (const material of materials) {
        if (emphasis !== 'context')
          assert.equal(material.color.getHexString(), '11aa22');
        assert.equal(material.opacity, opacity);
      }
    }
  } finally {
    disposeObject(rendered);
    disposeModelObjects([part, assembly]);
  }
});

test('invalid paint colors report the authored value instead of rendering a fallback', () => {
  for (const color of ['#zzzz', 'rgba(1, 2, 3, invalid)'])
    assert.throws(() => createRenderedModelNode(snapshot('solid', color)), {
      message: `Invalid paint color: ${JSON.stringify(color)}`,
    });
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

test('rendered point coordinates match direct construction and origin rebasing', () => {
  const direct = point([10, 2, -3]);
  const rebased = point().originOffset(-10, -2, 3);
  const assembly = group([direct, rebased]);
  const rendered = createRenderedModel(createModelSnapshotter()(assembly));
  try {
    const positions: number[][] = [];
    rendered.updateWorldMatrix(true, true);
    rendered.traverse(object => {
      if (!(object instanceof THREE.Points)) return;
      positions.push(
        new THREE.Vector3()
          .fromBufferAttribute(object.geometry.getAttribute('position'), 0)
          .applyMatrix4(object.matrixWorld)
          .toArray(),
      );
    });
    assert.deepEqual(positions, [
      [10, 2, -3],
      [10, 2, -3],
    ]);
  } finally {
    disposeObject(rendered);
    disposeModelObjects([direct, rebased, assembly]);
  }
});
