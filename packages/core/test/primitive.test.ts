import {
  defined,
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';
import type {Shape3D, AnyShape} from 'replicad';
import type {Model} from '@code3d/core';

import assert from 'node:assert/strict';
import test from 'node:test';

import {definePrimitive, replicad} from '@code3d/core/replicad';

import {
  clearKernelOperationCache,
  kernelOperationCacheStats,
} from '../bld/library/kernel-cache.js';

test('identical primitive output reuses geometry and meshes without skipping the builder', () => {
  clearKernelOperationCache();
  const outputs: Shape3D[] = [];
  const cylinder = definePrimitive(() => {
    const shape = replicad.makeCylinder(2, 4);
    outputs.push(shape);
    return shape;
  });
  const first = cylinder();
  const firstId = modelGeometry(first).id;
  const firstMesh = createModelSnapshotter()(first).mesh;
  disposeModelObjects([first]);
  const before = kernelOperationCacheStats();
  const repeat = cylinder();
  try {
    assert.equal(outputs.length, 2);
    assert.equal(modelGeometry(repeat).id, firstId);
    assert.deepEqual(createModelSnapshotter()(repeat).mesh, firstMesh);
    assert.equal(kernelOperationCacheStats().misses, before.misses);
    assert.ok(kernelOperationCacheStats().hits > before.hits);
    // Both the disposed first output and the redundant hit output are released.
    for (const shape of outputs) assert.throws(() => shape.clone(), /deleted/i);
  } finally {
    disposeModelObjects([repeat]);
    clearKernelOperationCache();
  }
});

test('clearing output caches does not dispose a live primitive', () => {
  const cylinder = definePrimitive(() => replicad.makeCylinder(2, 4));
  const first = cylinder();
  clearKernelOperationCache();
  const repeat = cylinder();
  try {
    assert.equal(modelGeometry(first).id, modelGeometry(repeat).id);
    assert.equal(kernelOperationCacheStats().misses, 1);
    const snapshot = createModelSnapshotter();
    assert.deepEqual(snapshot(first).mesh, snapshot(repeat).mesh);
  } finally {
    disposeModelObjects([first, repeat]);
    clearKernelOperationCache();
  }
});

test('an output that fails serialization is released', () => {
  let shape: Shape3D;
  const cylinder = definePrimitive(() => {
    shape = replicad.makeCylinder(2, 4);
    shape.serialize = () => {
      throw new Error('Cannot serialize this output.');
    };
    return shape;
  });
  assert.throws(() => cylinder(), /Cannot serialize this output/);
  assert.throws(() => shape.clone(), /deleted/i);
});

test('a primitive owns its returned solid and supplies normal model capabilities', () => {
  let shape: Shape3D;
  const cylinder = definePrimitive((radius: number, height = 4) => {
    shape = replicad.makeCylinder(radius, height);
    return shape;
  });
  const model = cylinder(2);
  try {
    const snapshot = createModelSnapshotter()(model);
    assert.equal(snapshot.kind, 'solid');
    assert.equal(snapshot.operation.kind, 'primitive');
    assert.ok(defined(snapshot.mesh).triangles.length > 0);
    assert.ok(model.up);
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
  const cylinder = definePrimitive((radius: number) => {
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
    const maximumZ = (model: Model) =>
      Math.max(
        ...defined(snapshot(model).mesh).vertices.filter(
          (_, index) => index % 3 === 2,
        ),
      );
    assert.equal(calls, 2);
    assert.notEqual(modelGeometry(first).id, modelGeometry(second).id);
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
    assert.ok(
      defined(createModelSnapshotter()(model).mesh).triangles.length > 0,
    );
  } finally {
    disposeModelObjects([model]);
    clearKernelOperationCache();
  }
});

test('multiple-solid output is rejected and released by code3d', () => {
  let aggregate: AnyShape;
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
  let aggregate: AnyShape;
  // @ts-expect-error A mixed-dimensional compound must also be rejected at runtime.
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
