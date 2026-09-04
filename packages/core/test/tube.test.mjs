import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {cylinder, tube} from '../bld/node/index.js';
import {replicad} from '../bld/node/replicad.js';
import {
  createModelSnapshotter,
  disposeModelObjects,
} from '../bld/tooling/index.js';
import {clearKernelOperationCache} from '../bld/library/kernel-cache.js';

afterEach(() => clearKernelOperationCache());

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
}

test('tube is a centered Y-axis solid with a through bore and canonical anchors', () => {
  const model = tube(6, 4, 16);
  const reference = cylinder(6, 16);
  const probes = [-8, 0, 8].map(y => replicad.makeVertex([0, y, 0]));
  try {
    const shape = model.geometry.value.shape;
    assert.ok(shape instanceof replicad.Solid);
    closeTo(replicad.measureVolume(shape), Math.PI * (36 - 16) * 16);
    for (const probe of probes) {
      closeTo(replicad.measureDistanceBetween(shape, probe), 4);
    }

    const snapshot = createModelSnapshotter();
    const value = snapshot(model);
    assert.equal(value.operation.kind, 'tube');
    assert.ok(value.mesh.triangles.length > 0);
    assert.equal(model.surfaces().length, 4);
    assert.deepEqual(value.elements, snapshot(reference).elements);
    // Model bounds are captured before tessellation; render meshes approximate circles.
    const bounds = model.geometry.value.localBounds;
    for (let axis = 0; axis < 3; axis += 1) {
      const extent = axis === 1 ? 8 : 6;
      closeTo(bounds[0][axis], -extent);
      closeTo(bounds[1][axis], extent);
    }
  } finally {
    probes.forEach(probe => probe.delete());
    disposeModelObjects([model, reference]);
  }
});

test('tube caches all dimensions independently and retains topology through solid operations', () => {
  const first = tube(6, 4, 12);
  const repeat = tube(6, 4, 12);
  const wider = tube(7, 4, 12);
  const thicker = tube(6, 3, 12);
  const taller = tube(6, 4, 14);
  const scaled = first.scaled(2);
  const chamfered = first.chamfer(0.25);
  const filleted = first.fillet(0.25);
  try {
    const models = [first, repeat, wider, thicker, taller];
    assert.equal(first.geometry.id, repeat.geometry.id);
    assert.equal(new Set(models.map(model => model.geometry.id)).size, 4);
    const snapshot = createModelSnapshotter();
    assert.deepEqual(snapshot(first).mesh, snapshot(repeat).mesh);
    closeTo(
      replicad.measureVolume(scaled.geometry.value.shape),
      8 * Math.PI * 20 * 12,
    );
    for (const model of [scaled, chamfered, filleted]) {
      assert.ok(snapshot(model).mesh.triangles.length > 0);
    }
    assert.deepEqual(
      scaled.surfaces().map(face => face.id),
      first.surfaces().map(face => face.id),
    );
  } finally {
    disposeModelObjects([
      first,
      repeat,
      wider,
      thicker,
      taller,
      scaled,
      chamfered,
      filleted,
    ]);
  }
});

test('a cached tube remains usable after the preceding model is disposed', () => {
  const first = tube(6, 4, 12);
  disposeModelObjects([first]);
  const repeat = tube(6, 4, 12);
  try {
    assert.ok(createModelSnapshotter()(repeat).mesh.triangles.length > 0);
  } finally {
    disposeModelObjects([repeat]);
  }
});

test('tube rejects nonpositive, nonfinite, or inverted dimensions', () => {
  for (const [index, name] of ['outerRadius', 'innerRadius', 'y'].entries()) {
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      const dimensions = [6, 4, 12];
      dimensions[index] = value;
      assert.throws(
        () => tube(...dimensions),
        new RegExp(`${name} must be a positive finite number`),
      );
    }
  }
  for (const innerRadius of [6, 7]) {
    assert.throws(
      () => tube(6, innerRadius, 12),
      /innerRadius must be smaller than outerRadius/,
    );
  }
});
