import {defined} from '../../../test/assert.ts';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';
import type {Shape3D, AnyShape} from 'replicad';
import type {Model} from '@code3d/core';
import * as primitives from '@code3d/core';
import {getOC} from 'replicad';
import {ellipsoidShape} from '../src/library/ellipsoid.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {definePrimitive, replicad} from '@code3d/core/replicad';

import {
  clearKernelOperationCache,
  kernelOperationCacheStats,
} from '../bld/library/kernel-cache.js';

for (const [name, defaults] of [
  ['circle', [5]],
  ['ellipse', [5, 3]],
  ['rectangle', [10, 10]],
  ['regularPolygon', [5, 6, 0]],
  ['box', [10, 10, 10]],
  ['cylinder', [5, 10]],
  ['tube', [5, 3, 10]],
  ['coil', [5, 1, 3, 3]],
  ['sphere', [5]],
  ['ellipsoid', [5, 3, 4]],
  ['frustum', [5, 3, 10]],
  ['regularPrism', [5, 10, 6, 0]],
] as const) {
  test(`${name} supplies runtime dimensions without replacing explicit values`, () => {
    // Exercise incomplete JavaScript calls while public TypeScript signatures
    // continue to require dimensions (checked in public-api.ts).
    const create = (args: readonly unknown[]): Model =>
      Reflect.apply(primitives[name], undefined, args);
    for (let count = 0; count <= defaults.length; count++) {
      const args: number[] = defaults.slice(0, count);
      if (args.length) args[0] *= 2;
      const actual = create(args);
      const explicit = create([...args, ...defaults.slice(count)]);
      try {
        assert.equal(modelGeometry(actual).id, modelGeometry(explicit).id);
        assert.ok(
          defined(createModelSnapshotter()(actual).mesh).triangles.length > 0,
        );
      } finally {
        disposeModelObjects([actual, explicit]);
      }
    }
    const omitted = create([]);
    const undefinedArgument = create([undefined]);
    try {
      assert.equal(
        modelGeometry(omitted).id,
        modelGeometry(undefinedArgument).id,
      );
    } finally {
      disposeModelObjects([omitted, undefinedArgument]);
    }
    for (const invalid of [null, 0, -1, NaN, Infinity, '5']) {
      assert.throws(() => create([invalid]), /positive finite number/);
    }
  });
}

test('ellipsoid radii control the local bounds, volume and oriented surface', () => {
  const oval = primitives.ellipsoid(7, 4, 5);
  const turned = oval.rotate(0, 0, 90);
  try {
    for (const [actual, expected] of [
      [oval.bounds().minimum, [-7, -4, -5]],
      [oval.bounds().maximum, [7, 4, 5]],
      [turned.bounds().size, [8, 14, 10]],
    ])
      actual.forEach((value, i) =>
        assert.ok(Math.abs(value - expected[i]) < 1e-5),
      );
    assert.ok(Math.abs(oval.volume - (4 / 3) * Math.PI * 7 * 4 * 5) < 0.001);
    const snapshot = createModelSnapshotter()(oval);
    assert.equal(snapshot.operation.kind, 'ellipsoid');
    const face = modelGeometry(oval).value.shape.faces[0];
    const center = face.center;
    const normal = face.normalAt(center);
    try {
      assert.ok(normal.dot(center) > 0, 'surface normals point outward');
    } finally {
      normal.delete();
      center.delete();
      face.delete();
    }
    for (const radii of [
      [7, 0, 5],
      [7, 4, NaN],
      [Infinity, 4, 5],
    ])
      assert.throws(
        () => primitives.ellipsoid(...(radii as [number, number, number])),
        /positive finite/,
      );
  } finally {
    disposeModelObjects([oval, turned]);
    clearKernelOperationCache();
  }
});

test('ellipsoid construction releases its native surface and builder handles', () => {
  const oc = getOC() as import('@code3d/opencascade').OpenCascadeInstance;
  const batch = () => {
    for (let i = 0; i < 12; i++) ellipsoidShape(7, 4, 5).delete();
    return oc.Code3dMemory.AllocatedBytes();
  };
  const warm = batch();
  assert.ok(batch() - warm < 4096);
});

test('repeated primitive arguments skip the builder and reuse geometry and meshes', () => {
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
    assert.equal(outputs.length, 1);
    assert.equal(modelGeometry(repeat).id, firstId);
    assert.deepEqual(createModelSnapshotter()(repeat).mesh, firstMesh);
    assert.equal(kernelOperationCacheStats().misses, before.misses);
    assert.ok(kernelOperationCacheStats().hits > before.hits);
    // The disposed first output is released; the cache owns its own handle.
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

test('explicit changing parameters invalidate geometry and keep prior models independent', () => {
  let calls = 0;
  const cylinder = definePrimitive((radius: number, height: number) => {
    calls += 1;
    if (height <= 0) throw new Error('Height must be positive.');
    return replicad.makeCylinder(radius, height);
  });
  const first = cylinder(2, 4);
  const firstScaled = first.scaled(2);
  const second = cylinder(2, 8);
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
    assert.throws(() => cylinder(2, -1), /Height must be positive/);
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
