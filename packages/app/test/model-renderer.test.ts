import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as THREE from 'three';
import {box, group, point, line} from '@code3d/core';
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

test('renders a group override on nested parts with and without authored materials', () => {
  const first = box(2, 4, 6).material('#ff0000');
  const second = box(1, 2, 3);
  const assembly = group([first, group([second])]).material('#345678');
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
  const defaultMaterial = createRenderedModelNode(snapshot('edge'));
  const colored = createRenderedModelNode(snapshot('edge', '#ff4d81'));

  assert.equal(defaultMaterial.children.length, 1);
  assert.ok(defaultMaterial.children[0] instanceof THREE.LineSegments);
  assert.equal(
    defaultMaterial.children[0].material.color.getHexString(),
    'dde0dc',
  );
  assert.equal(defaultMaterial.children[0].material.opacity, 1);
  assert.equal(defaultMaterial.children[0].material.transparent, false);
  assert.equal(defaultMaterial.children[0].material.toneMapped, false);
  assert.ok(colored.children[0] instanceof THREE.LineSegments);
  assert.equal(colored.children[0].material.color.getHexString(), 'ff4d81');
});

for (const kind of ['solid', 'face', 'edge', 'vertex'] as const) {
  test(`${kind} color keeps RGB and alpha for hex and functional colors`, () => {
    for (const [color, rgb, opacity] of [
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
      const rendered = createRenderedModelNode(snapshot(kind, color));
      try {
        const material = (
          rendered.children[0] as THREE.Mesh<
            THREE.BufferGeometry,
            THREE.MeshStandardMaterial
          >
        ).material;
        assert.equal(material.color.getHexString(), rgb, color);
        assert.equal(material.opacity, opacity, color);
        assert.equal(material.transparent, opacity < 1, color);
        assert.equal(material.depthWrite, opacity === 1, color);
        if (kind === 'solid' || kind === 'face') {
          const boundary = rendered.children[1] as THREE.LineSegments<
            THREE.BufferGeometry,
            THREE.LineBasicMaterial
          >;
          assert.equal(boundary.material.opacity, 0.72 * opacity, color);
        }
      } finally {
        disposeObject(rendered);
      }
    }
  });
}

test('translucent group color overrides descendants without compounding source opacity', () => {
  const part = box(2, 4, 6).material('#ff0000');
  const assembly = group([part, group([part])]).material(
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

test('invalid material colors report the authored value instead of rendering a fallback', () => {
  for (const color of ['#zzzz', 'rgba(1, 2, 3, invalid)'])
    assert.throws(() => createRenderedModelNode(snapshot('solid', color)), {
      message: `Invalid material color: ${JSON.stringify(color)}`,
    });
});

function snapshot(kind: ModelKind, color?: string): ModelSnapshotObject {
  return {
    ...createModelSnapshotter()(group([])),
    kind,
    name: kind,
    material: color,
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

test('native material classes and authored flags survive snapshot restoration', () => {
  const authored = new THREE.MeshPhysicalMaterial({
    color: '#6699cc',
    roughness: 0.17,
    metalness: 0.8,
    transmission: 0.4,
    clearcoat: 0.7,
    ior: 1.4,
    thickness: 2,
    opacity: 0.65,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const model = box(3, 4, 5).material(authored);
  const snapshot = createModelSnapshotter()(model);
  const first = createRenderedModel(snapshot);
  const second = createRenderedModel(snapshot);
  try {
    const mesh = first.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshPhysicalMaterial
    >;
    const other = second.children[0] as typeof mesh;
    assert.ok(mesh.material instanceof THREE.MeshPhysicalMaterial);
    assert.notEqual(mesh.material, authored);
    assert.notEqual(mesh.material, other.material);
    assert.equal(mesh.material.roughness, 0.17);
    assert.equal(mesh.material.transmission, 0.4);
    assert.equal(mesh.material.clearcoat, 0.7);
    assert.ok(Math.abs(mesh.material.ior - 1.4) < 1e-12);
    assert.equal(mesh.material.thickness, 2);
    assert.equal(mesh.material.depthWrite, true);
    assert.equal(mesh.material.toneMapped, false);
    applySourceEmphasis(first, 'context');
    assert.equal(mesh.material.opacity, 0.18);
    assert.equal(other.material.opacity, 0.65);
    assert.equal(authored.opacity, 0.65);
    assert.equal(authored.color.getHexString(), '6699cc');
  } finally {
    disposeObject(first);
    disposeObject(second);
    disposeModelObjects([model]);
    authored.dispose();
  }
});

test('mesh, line and point native materials retain their respective rendering behavior', () => {
  const values = [
    box(2, 3, 4).material(
      new THREE.MeshBasicMaterial({color: '#f80', wireframe: true}),
    ),
    line([0, 0, 0], [3, 4, 5]).material(
      new THREE.LineDashedMaterial({
        color: '#0f0',
        dashSize: 0.7,
        gapSize: 0.2,
      }),
    ),
    point().material(
      new THREE.PointsMaterial({
        color: '#f00',
        size: 12,
        sizeAttenuation: false,
      }),
    ),
  ];
  const objects = values.map(value =>
    createRenderedModel(createModelSnapshotter()(value)),
  );
  try {
    const mesh = objects[0].children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    const curve = objects[1].children[0] as THREE.LineSegments<
      THREE.BufferGeometry,
      THREE.LineDashedMaterial
    >;
    const vertex = objects[2].children[0] as THREE.Points<
      THREE.BufferGeometry,
      THREE.PointsMaterial
    >;
    assert.ok(mesh.material instanceof THREE.MeshBasicMaterial);
    assert.equal(mesh.material.wireframe, true);
    assert.ok(curve.material instanceof THREE.LineDashedMaterial);
    assert.equal(curve.material.dashSize, 0.7);
    assert.ok(curve.geometry.getAttribute('lineDistance'));
    assert.equal(vertex.material.size, 12);
    assert.equal(vertex.material.sizeAttenuation, false);
    applySourceEmphasis(objects[0], 'context');
    assert.equal(mesh.material.color.getHexString(), '788078');
  } finally {
    objects.forEach(disposeObject);
    disposeModelObjects(values);
  }
});

test('texture restoration owns its pixels and releases each rendered texture once', () => {
  const input = new THREE.DataTexture(
    new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
    2,
    1,
  );
  input.colorSpace = THREE.SRGBColorSpace;
  input.repeat.set(2, 3);
  const model = box(2, 3, 4).material(
    new THREE.MeshStandardMaterial({map: input}),
  );
  const snapshot = createModelSnapshotter()(model);
  const first = createRenderedModel(snapshot);
  const second = createRenderedModel(snapshot);
  const firstMap = (
    first.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >
  ).material.map!;
  const secondMap = (
    second.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >
  ).material.map!;
  let inputDisposals = 0,
    firstDisposals = 0,
    secondDisposals = 0;
  input.addEventListener('dispose', () => inputDisposals++);
  firstMap.addEventListener('dispose', () => firstDisposals++);
  secondMap.addEventListener('dispose', () => secondDisposals++);
  try {
    assert.ok(firstMap instanceof THREE.DataTexture);
    assert.notEqual(firstMap, input);
    assert.notEqual(firstMap, secondMap);
    assert.deepEqual(firstMap.repeat.toArray(), [2, 3]);
    assert.equal(firstMap.colorSpace, THREE.SRGBColorSpace);
    assert.deepEqual(
      firstMap.image.data,
      new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
    );
    firstMap.image.data[0] = 0;
    assert.equal((secondMap as THREE.DataTexture).image.data![0], 255);
    assert.ok((first.children[0] as THREE.Mesh).geometry.getAttribute('uv'));
  } finally {
    disposeObject(first);
    disposeObject(second);
    disposeModelObjects([model]);
  }
  assert.deepEqual(
    [inputDisposals, firstDisposals, secondDisposals],
    [0, 1, 1],
  );
});
