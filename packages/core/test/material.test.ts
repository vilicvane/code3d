import {
  Color,
  DataTexture,
  MaterialLoader,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
} from '@code3d/core/three';
import {defined} from '../../../test/assert.ts';
import {createModelSnapshotter, disposeModelObjects} from './model-test.ts';
import type {ModelSnapshotObject} from '@code3d/core/tooling';

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {box, circle, group, line, point} from '@code3d/core';
import {
  modelElementReference,
  modelTopologyReference,
} from '@code3d/core/tooling';

const colors = (
  snapshot: ModelSnapshotObject,
): ModelSnapshotObject['material'][] => [
  snapshot.material,
  ...snapshot.children.flatMap(colors),
];

test('group material recursively overrides existing colors on every geometry dimension', () => {
  const solid = box(2, 4, 6).material('#ff0000');
  const face = circle(1);
  const curve = line([0, 0, 0], [1, 0, 0]);
  const vertex = point([0, 0, 0]);
  const inner = group([solid, face]).material('#00ff00');
  const original = group([inner, curve, vertex]);
  const colored = original.material('#0000ff');
  const replaced = colored.material('#ffffff');
  try {
    const snapshot = createModelSnapshotter();
    const before = snapshot(original);
    const originalColors = [
      undefined,
      '#00ff00',
      '#00ff00',
      '#00ff00',
      undefined,
      undefined,
    ];
    assert.deepEqual(colors(before), originalColors);
    assert.deepEqual(colors(snapshot(colored)), Array(6).fill('#0000ff'));
    assert.deepEqual(colors(snapshot(replaced)), Array(6).fill('#ffffff'));
    assert.deepEqual(colors(snapshot(colored)), Array(6).fill('#0000ff'));
    assert.deepEqual(colors(before), originalColors);
    assert.deepEqual(colors(snapshot(original)), originalColors);
    assert.equal(snapshot(solid).material, '#ff0000');
    assert.equal(snapshot(face).material, undefined);
  } finally {
    disposeModelObjects([
      solid,
      face,
      curve,
      vertex,
      inner,
      original,
      colored,
      replaced,
    ]);
  }
});

test('shared children keep independent appearance in differently colored groups', () => {
  const child = box(2, 4, 6).material('#00ff00');
  const red = group([child]).material('#ff0000');
  const blue = group([child]).material('#0000ff');
  const assembly = group([red, blue, child]);
  try {
    const snapshot = createModelSnapshotter();
    const result = snapshot(assembly);
    const copies = [
      result.children[0].children[0],
      result.children[1].children[0],
      result.children[2],
    ];
    assert.deepEqual(
      copies.map(copy => copy.material),
      ['#ff0000', '#0000ff', '#00ff00'],
    );
    for (const copy of copies) {
      assert.equal(copy.nodeId, result.children[2].nodeId);
      assert.equal(copy.mesh, result.children[2].mesh);
    }
    assert.equal(snapshot(child).material, '#00ff00');
  } finally {
    disposeModelObjects([child, red, blue, assembly]);
  }
});

test('setting material on a related assembly preserves member identities and exposed topology', () => {
  const base = box(10, 10, 10);
  const cap = box(4, 2, 4).relate(self => self.on(base.up));
  const assembly = group([base, cap]).expose({part: cap, mount: base.down});
  const colored = assembly.material('#aabbcc');
  try {
    const snapshot = createModelSnapshotter();
    const before = snapshot(assembly);
    const after = snapshot(colored);
    assert.deepEqual(
      after.children,
      before.children.map(child => ({...child, material: '#aabbcc'})),
    );
    const [x, y, z] = after.children[1].transform.position;
    assert.ok(Math.hypot(x, y - 3, z) < 1e-8);
    assert.deepEqual(
      defined(modelElementReference(colored.mount)).transform,
      defined(modelElementReference(assembly.mount)).transform,
    );
    assert.equal(defined(modelTopologyReference(colored.part)).model, colored);
    assert.equal(defined(modelTopologyReference(colored.part)).geometry, cap);
    assert.deepEqual(
      colored.part.edges().map(edge => edge.id),
      cap.edges().map(edge => edge.id),
    );
    assert.equal(snapshot(cap).material, undefined);
  } finally {
    disposeModelObjects([base, cap, assembly, colored]);
  }
});

test('empty groups can be colored without inventing geometry', () => {
  const empty = group([]);
  const colored = empty.material('#ff0000');
  try {
    const snapshot = createModelSnapshotter();
    assert.deepEqual(snapshot(colored).children, []);
    assert.equal(snapshot(colored).mesh, undefined);
    assert.equal(snapshot(colored).material, '#ff0000');
    assert.equal(snapshot(empty).material, undefined);
  } finally {
    disposeModelObjects([empty, colored]);
  }
});

test('native material assignment captures a reusable atom and replacement resets omitted properties', () => {
  const input = new MeshPhysicalMaterial({
    color: '#234567',
    roughness: 0.21,
    metalness: 1,
    clearcoat: 0.6,
  });
  input.userData = {settings: {tag: 'original'}};
  const base = box(2, 3, 4);
  const first = base.material(input);
  input.color.set('#ff0000');
  input.roughness = 0.9;
  input.userData.settings.tag = 'changed';
  const second = base.material(input);
  const replaced = first.material(new MeshStandardMaterial({roughness: 0.7}));
  try {
    const snapshot = createModelSnapshotter();
    const firstMaterial = snapshot(first).material;
    assert.ok(firstMaterial && typeof firstMaterial !== 'string');
    assert.equal(firstMaterial.type, 'MeshPhysicalMaterial');
    assert.equal(firstMaterial.color, 0x234567);
    assert.equal(firstMaterial.roughness, 0.21);
    assert.equal(firstMaterial.clearcoat, 0.6);
    assert.deepEqual(firstMaterial.userData, {settings: {tag: 'original'}});
    const secondMaterial = snapshot(second).material;
    assert.ok(secondMaterial && typeof secondMaterial !== 'string');
    assert.equal(secondMaterial.uuid, firstMaterial.uuid);
    assert.equal(secondMaterial.color, 0xff0000);
    const replacement = snapshot(replaced).material;
    assert.ok(replacement && typeof replacement !== 'string');
    assert.equal(replacement.type, 'MeshStandardMaterial');
    assert.equal(replacement.color, 0xffffff);
    assert.equal(replacement.metalness, 0);
    assert.equal(replacement.roughness, 0.7);
    assert.equal(replacement.clearcoat, undefined);
    assert.equal(snapshot(base).material, undefined);
    assert.deepEqual(structuredClone(snapshot(first)), snapshot(first));
  } finally {
    disposeModelObjects([base, first, second, replaced]);
  }
});

test('native group material replaces every descendant without mutating shared parts', () => {
  const child = box(2, 3, 4).material(
    new MeshPhysicalMaterial({color: '#336699', clearcoat: 1}),
  );
  const base = group([child, group([child])]);
  const changed = base.material(
    new MeshBasicMaterial({color: '#dd8844', wireframe: true}),
  );
  try {
    const snapshot = createModelSnapshotter();
    const result = snapshot(changed);
    assert.ok(result.material && typeof result.material !== 'string');
    for (const material of colors(result))
      assert.deepEqual(material, result.material);
    const original = snapshot(child).material;
    assert.ok(original && typeof original !== 'string');
    assert.equal(original.type, 'MeshPhysicalMaterial');
    assert.equal(original.color, 0x336699);
  } finally {
    disposeModelObjects([child, base, changed]);
  }
});

test('texture pixels and transforms are captured by value and survive structured cloning', () => {
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
  const texture = new DataTexture(pixels, 2, 1, RGBAFormat);
  texture.repeat.set(3, 2);
  const input = new MeshStandardMaterial({map: texture});
  const model = box(3, 4, 5).material(input);
  pixels.fill(0);
  texture.repeat.set(1, 1);
  try {
    const snapshot = createModelSnapshotter()(model);
    const material = snapshot.material;
    assert.ok(material && typeof material !== 'string');
    assert.deepEqual(material.textures?.[0].repeat, [3, 2]);
    assert.deepEqual(material.images?.[0].url, {
      data: [255, 0, 0, 255, 0, 0, 255, 255],
      width: 2,
      height: 1,
      type: 'Uint8Array',
    });
    assert.deepEqual(structuredClone(snapshot), snapshot);
    const uv = defined(snapshot.mesh).uvs;
    assert.ok(
      uv && uv.length === (defined(snapshot.mesh).vertices.length / 3) * 2,
    );
    assert.ok(uv.every(value => value >= 0 && value <= 1));
    assert.ok(uv.some(value => value === 1));
  } finally {
    disposeModelObjects([model]);
    texture.dispose();
    input.dispose();
  }
});

test('custom callbacks and unloaded textures fail at the material call instead of silently disappearing', () => {
  const model = box(2, 3, 4);
  const custom = new MeshStandardMaterial();
  custom.onBeforeCompile = () => {};
  try {
    assert.throws(
      () => model.material(custom),
      /cannot transfer custom material callbacks/,
    );
    assert.throws(
      () => model.material(new MeshStandardMaterial({precision: 'mediump'})),
      /cannot capture precision/,
    );
    class CustomMaterial extends MeshStandardMaterial {}
    assert.throws(
      () => model.material(new CustomMaterial()),
      /cannot restore the Three.js material type/,
    );
    const unready = new MeshStandardMaterial({map: new DataTexture()});
    assert.throws(
      () => model.material(unready),
      /requires textures|requires a loaded texture/,
    );
  } finally {
    disposeModelObjects([model]);
  }
});

test('shader values round-trip while unsupported nested native uniforms fail explicitly', () => {
  const weights = new Float32Array([0.25, 0.75]);
  const shader = new ShaderMaterial({
    uniforms: {
      tint: {value: new Color('#ff8800')},
      direction: {value: new Vector3(1, 2, 3)},
      weights: {value: weights},
    },
  });
  const model = box(2, 3, 4).material(shader);
  weights.fill(0);
  shader.uniforms.direction.value.x = 9;
  try {
    const snapshot = createModelSnapshotter()(model).material;
    assert.ok(snapshot && typeof snapshot !== 'string');
    const restored = new MaterialLoader().parse(snapshot);
    assert.ok(restored instanceof ShaderMaterial);
    assert.equal(restored.uniforms.tint.value.getHexString(), 'ff8800');
    assert.deepEqual(restored.uniforms.direction.value.toArray(), [1, 2, 3]);
    assert.deepEqual(restored.uniforms.weights.value, [0.25, 0.75]);
    restored.dispose();
    shader.uniforms.palette = {value: [new Color('#ff8800')]};
    assert.throws(
      () => model.material(shader),
      /cannot restore nested native objects/,
    );
    delete shader.uniforms.palette;
    shader.defaultAttributeValues.uv = [0.5, 0.5];
    assert.throws(
      () => model.material(shader),
      /custom defaultAttributeValues/,
    );
  } finally {
    disposeModelObjects([model]);
    shader.dispose();
  }
});
