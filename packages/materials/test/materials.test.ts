import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  acrylic,
  aluminum,
  brass,
  ceramic,
  copper,
  glass,
  paint,
  plastic,
  rubber,
  steel,
} from '@code3d/materials';
import {
  Color,
  MaterialLoader,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from '@code3d/core/three';
import {captureModelMaterial} from '@code3d/core/tooling';

const factories = {
  plastic,
  rubber,
  aluminum,
  steel,
  brass,
  copper,
  glass,
  acrylic,
  ceramic,
  paint,
};

for (const [name, factory] of Object.entries(factories)) {
  test(`${name} returns a fresh shared Three.js material that crosses the Core snapshot boundary`, () => {
    const material = factory();
    const other = factory();
    assert.ok(material instanceof MeshStandardMaterial);
    assert.notEqual(material, other);
    assert.notEqual(material.color, other.color);
    const captured = captureModelMaterial(material);
    assert.notEqual(typeof captured, 'string');
    assert.ok(typeof captured !== 'string');
    const restored = new MaterialLoader().parse(captured);
    assert.equal(restored.constructor, material.constructor);
    const restoredJson = restored.toJSON();
    for (const [key, expected] of Object.entries(material.toJSON())) {
      const actual = Reflect.get(restoredJson, key);
      // Physical material reflectivity is reconstructed from the IOR.
      if (typeof expected === 'number')
        assert.ok(Math.abs(actual - expected) < 1e-12, key);
      else assert.deepEqual(actual, expected, key);
    }
    material.color.set('#ff0044');
    assert.notEqual(material.color.getHex(), other.color.getHex());
    assert.equal(restored.name, name);
    material.dispose();
    other.dispose();
    restored.dispose();
  });
}

test('color shorthand accepts native strings, numbers and Color without sharing mutable state', () => {
  const color = new Color('#3d8aaf');
  const materials = [
    plastic('#3d8aaf'),
    plastic(0x3d8aaf),
    plastic(color),
    plastic({color}),
  ];
  color.set('#ff0000');
  for (const material of materials) {
    assert.equal(material.color.getHexString(), '3d8aaf');
    material.dispose();
  }
});

test('finish controls roughness while explicit parameters take precedence', () => {
  assert.ok(
    plastic({finish: 'matte'}).roughness >
      plastic({finish: 'glossy'}).roughness,
  );
  assert.ok(
    aluminum({finish: 'satin'}).roughness >
      aluminum({finish: 'polished'}).roughness,
  );
  assert.ok(
    rubber({finish: 'matte'}).roughness > rubber({finish: 'satin'}).roughness,
  );
  assert.equal(plastic({finish: 'matte', roughness: 0.23}).roughness, 0.23);
  assert.equal(aluminum({finish: 'polished', roughness: 0.23}).roughness, 0.23);
  const matte = paint({finish: 'matte'});
  const glossy = paint({finish: 'glossy'});
  assert.ok(matte.clearcoatRoughness > glossy.clearcoatRoughness);
  assert.equal(
    paint({finish: 'matte', clearcoatRoughness: 0.07}).clearcoatRoughness,
    0.07,
  );
  assert.equal(paint({clearcoat: 0}).clearcoat, 0);
});

test('opacity enables blending without changing the chosen surface parameters', () => {
  const opaque = steel();
  const faded = steel({opacity: 0.4});
  assert.equal(opaque.transparent, false);
  assert.equal(faded.transparent, true);
  assert.equal(faded.opacity, 0.4);
  assert.equal(faded.metalness, opaque.metalness);
  assert.equal(faded.roughness, opaque.roughness);
  assert.equal(plastic({opacity: 0}).opacity, 0);
});

test('glass and acrylic use physical transmission with explicit model-unit thickness', () => {
  const clear = glass();
  assert.ok(clear instanceof MeshPhysicalMaterial);
  assert.equal(clear.transmission, 1);
  assert.equal(clear.opacity, 1);
  assert.equal(clear.transparent, false);
  assert.equal(clear.thickness, 0);
  const frosted = glass({
    finish: 'frosted',
    thickness: 2,
    ior: 1.6,
    transmission: 0.8,
    attenuationColor: '#83b9a3',
    attenuationDistance: 30,
  });
  assert.ok(frosted.roughness > clear.roughness);
  assert.equal(frosted.thickness, 2);
  assert.equal(frosted.ior, 1.6);
  assert.equal(frosted.transmission, 0.8);
  assert.equal(frosted.attenuationColor.getHexString(), '83b9a3');
  assert.equal(frosted.attenuationDistance, 30);
  assert.notEqual(acrylic().ior, clear.ior);
});
