import assert from 'node:assert/strict';
import test from 'node:test';

import {definePrimitive, replicad} from '../bld/node/replicad.js';
import {
  createModelSnapshotter,
  disposeModelObjects,
} from '../bld/tooling/index.js';
import {clearKernelOperationCache} from '../bld/library/kernel-cache.js';

test('a primitive owns its returned solid and supplies normal model capabilities', () => {
  let shape;
  const cylinder = definePrimitive((radius, height = 4) => {
    shape = replicad.makeCylinder(radius, height);
    return shape;
  });
  const model = cylinder(2);
  try {
    const snapshot = createModelSnapshotter()(model);
    assert.equal(snapshot.kind, 'solid');
    assert.equal(snapshot.operation.kind, 'primitive');
    assert.ok(snapshot.mesh.triangles.length > 0);
    assert.ok(model.top);
    assert.ok(model.axis);
  } finally {
    disposeModelObjects([model]);
    clearKernelOperationCache();
  }
  assert.throws(() => shape.clone(), /deleted/i);
});

test('repeated arguments still observe closure changes and keep prior models independent', () => {
  let height = 4;
  let calls = 0;
  const cylinder = definePrimitive(radius => {
    calls += 1;
    if (height <= 0) throw new Error('Height must be positive.');
    return replicad.makeCylinder(radius, height);
  });
  const first = cylinder(2);
  const firstScaled = first.scaled(2);
  height = 8;
  const second = cylinder(2);
  const secondScaled = second.scaled(2);
  try {
    const snapshot = createModelSnapshotter();
    const maximumZ = model =>
      Math.max(
        ...snapshot(model).mesh.vertices.filter((_, index) => index % 3 === 2),
      );
    assert.equal(calls, 2);
    assert.equal(maximumZ(first), 4);
    assert.equal(maximumZ(second), 8);
    assert.equal(maximumZ(firstScaled), 8);
    assert.equal(maximumZ(secondScaled), 16);
    height = -1;
    assert.throws(() => cylinder(2), /Height must be positive/);
    assert.equal(calls, 3);
  } finally {
    disposeModelObjects([first, firstScaled, second, secondScaled]);
    clearKernelOperationCache();
  }
});

test('a single-solid Replicad boolean result is normalized and rendered', () => {
  const fusedCylinder = definePrimitive(() => {
    const left = replicad.makeCylinder(2, 4);
    const right = replicad.makeCylinder(2, 4).translate([1, 0, 0]);
    try {
      return left.fuse(right);
    } finally {
      left.delete();
      right.delete();
    }
  });
  const model = fusedCylinder();
  try {
    assert.ok(createModelSnapshotter()(model).mesh.triangles.length > 0);
  } finally {
    disposeModelObjects([model]);
    clearKernelOperationCache();
  }
});

test('multiple-solid output is rejected and released by code3d', () => {
  let aggregate;
  const disjointCylinders = definePrimitive(() => {
    const left = replicad.makeCylinder(1, 2);
    const right = replicad.makeCylinder(1, 2).translate([4, 0, 0]);
    try {
      aggregate = left.fuse(right);
      return aggregate;
    } finally {
      left.delete();
      right.delete();
    }
  });
  assert.throws(
    () => disjointCylinders(),
    /must return exactly one OpenCascade solid/,
  );
  assert.throws(() => aggregate.clone(), /deleted/i);
});

test('an aggregate with a solid and stray lower-dimensional geometry is rejected', () => {
  let aggregate;
  const mixedGeometry = definePrimitive(() => {
    const solid = replicad.makeCylinder(1, 2);
    const edge = replicad.makeLine([4, 0, 0], [5, 0, 0]);
    // compoundShapes consumes its inputs.
    aggregate = replicad.compoundShapes([solid, edge]);
    return aggregate;
  });
  assert.throws(
    () => mixedGeometry(),
    /must return exactly one OpenCascade solid/,
  );
  assert.throws(() => aggregate.clone(), /deleted/i);
});
