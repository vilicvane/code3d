import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {coil} from '../bld/node/index.js';
import {replicad} from '../bld/node/replicad.js';
import {
  createModelSnapshotter,
  disposeModelObjects,
} from '../bld/tooling/index.js';
import {clearKernelOperationCache} from '../bld/library/kernel-cache.js';

afterEach(() => clearKernelOperationCache());

test('coil builds a circular swept solid with integer or fractional turns', () => {
  for (const turns of [0.25, 1, 2.5]) {
    const model = coil(5, 0.75, 4, turns);
    try {
      const shape = model.geometry.value.shape;
      assert.ok(shape instanceof replicad.Solid);
      const volume = replicad.measureVolume(shape);
      const expected =
        Math.PI * 0.75 ** 2 * turns * Math.hypot(2 * Math.PI * 5, 4);
      assert.ok(Math.abs(volume / expected - 1) < 1e-4);
      assert.equal(model.surfaces().length, 3);
      const snapshot = createModelSnapshotter()(model);
      assert.equal(snapshot.operation.kind, 'coil');
      assert.ok(snapshot.mesh.triangles.length > 0);
      assert.deepEqual(
        snapshot.elements.find(element => element.name === 'center').transform
          .position,
        model.geometry.value.localBounds[0].map(
          (minimum, axis) =>
            (minimum + model.geometry.value.localBounds[1][axis]) / 2,
        ),
      );
      assert.deepEqual(
        snapshot.elements.find(element => element.name === 'axis').transform
          .position,
        [0, 0, 0],
      );
      const top = snapshot.elements.find(element => element.name === 'up')
        .transform.position;
      const bottom = snapshot.elements.find(element => element.name === 'down')
        .transform.position;
      const center = snapshot.elements.find(
        element => element.name === 'center',
      ).transform.position;
      assert.ok(Math.abs(top[0] - center[0]) < 1e-6);
      assert.ok(Math.abs(top[2] - center[2]) < 1e-6);
      assert.ok(top[1] > (turns * 4) / 2);
      assert.ok(Math.abs(bottom[1] + top[1]) < 1e-6);
    } finally {
      disposeModelObjects([model]);
    }
  }
});

test('coil caches each input dimension and supports ordinary solid derivation', () => {
  const first = coil(5, 0.75, 4, 1.25);
  const repeat = coil(5, 0.75, 4, 1.25);
  const variants = [
    coil(6, 0.75, 4, 1.25),
    coil(5, 1, 4, 1.25),
    coil(5, 0.75, 5, 1.25),
    coil(5, 0.75, 4, 1.5),
  ];
  const scaled = first.scaled(2);
  const filleted = first.fillet(0.1);
  const chamfered = first.chamfer(0.1);
  try {
    assert.equal(first.geometry.id, repeat.geometry.id);
    assert.equal(
      new Set([first, ...variants].map(model => model.geometry.id)).size,
      5,
    );
    const snapshot = createModelSnapshotter();
    assert.deepEqual(snapshot(first).mesh, snapshot(repeat).mesh);
    assert.deepEqual(
      first.surfaces().map(face => face.id),
      scaled.surfaces().map(face => face.id),
    );
    for (const model of [scaled, filleted, chamfered]) {
      assert.ok(snapshot(model).mesh.triangles.length > 0);
    }
  } finally {
    disposeModelObjects([
      first,
      repeat,
      ...variants,
      scaled,
      filleted,
      chamfered,
    ]);
  }
});

test('a cached coil outlives disposal of its preceding model', () => {
  const first = coil(5, 0.75, 4, 1);
  disposeModelObjects([first]);
  const next = coil(5, 0.75, 4, 1);
  try {
    assert.ok(createModelSnapshotter()(next).mesh.triangles.length > 0);
  } finally {
    disposeModelObjects([next]);
  }
});

test('coil rejects invalid dimensions and touching or overlapping turns', () => {
  for (const [index, name] of [
    'coilRadius',
    'wireRadius',
    'pitch',
    'turns',
  ].entries()) {
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      const dimensions = [5, 0.75, 4, 1];
      dimensions[index] = value;
      assert.throws(
        () => coil(...dimensions),
        new RegExp(`${name} must be a positive finite number`),
      );
    }
  }
  assert.throws(
    () => coil(5, 5, 12, 1),
    /wireRadius must be smaller than coilRadius/,
  );
  assert.throws(
    () => coil(5, 1, 2, 1),
    /pitch must be greater than the wire diameter/,
  );
  // Axial pitch exceeds the diameter, but oblique neighboring turns still overlap.
  assert.throws(
    () => coil(5, 1, 2.001, 2),
    /Coil turns must not touch or overlap/,
  );
  assert.throws(
    () => coil(5, 1, 1e308, 2),
    /pitch \* turns must be a positive finite number/,
  );
  // The same narrow pitch is safe when no neighboring turn is present.
  const partial = coil(5, 1, 2.001, 0.25);
  const separated = coil(5, 1, 2.1, 2);
  try {
    const snapshot = createModelSnapshotter();
    assert.ok(snapshot(partial).mesh.triangles.length > 0);
    assert.ok(snapshot(separated).mesh.triangles.length > 0);
  } finally {
    disposeModelObjects([partial, separated]);
  }
});
