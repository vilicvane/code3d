import assert from 'node:assert/strict';
import test from 'node:test';
import {makeBox, makeCylinder} from 'replicad';
import {
  decodeKernelArtifact,
  encodeKernelArtifact,
} from '../bld/library/kernel-artifact-codec.js';
import {
  createComputationCache,
  kernelOperationKey,
  type KernelArtifactStore,
} from '../bld/library/kernel-cache.js';
import '../bld/node/index.js';

test('binary artifacts preserve geometry, metadata, scalar precision and independent mesh buffers', () => {
  const blank = makeBox([0, 0, 0], [10, 20, 30]);
  const bore = makeCylinder(2, 30);
  const shape = blank.cut(bore);
  blank.delete();
  bore.delete();
  const value = {
    shape,
    bounds: shape.boundingBox.bounds,
    topology: {ids: [[1, 2], [3]]},
    numbers: [-0, NaN, Infinity, -Infinity, undefined, 12.369999999999997],
    vertices: new Float32Array([1, 2, 3]),
    triangles: new Uint32Array([0, 1, 2]),
  };
  const bytes = encodeKernelArtifact('shape', value);
  const restored = decodeKernelArtifact<typeof value>(bytes, 'shape');
  try {
    assert.deepEqual(restored.bounds, value.bounds);
    assert.deepEqual(restored.shape.boundingBox.bounds, value.bounds);
    assert.deepEqual(restored.numbers, value.numbers);
    assert.deepEqual(restored.topology, value.topology);
    assert.deepEqual(restored.vertices, value.vertices);
    assert.equal(
      restored.vertices.buffer.byteLength,
      value.vertices.byteLength,
    );
    assert.notEqual(restored.vertices.buffer, restored.triangles.buffer);
    assert.throws(
      () => decodeKernelArtifact(bytes, 'different'),
      /signature mismatch/,
    );
    const tool = makeCylinder(1, 30, [5, 5, 0]);
    const modified = restored.shape.asShape3D().cut(tool);
    const modifiedFaces = modified.faces;
    const restoredFaces = restored.shape.faces;
    try {
      assert.ok(modifiedFaces.length > restoredFaces.length);
    } finally {
      modifiedFaces.forEach(face => face.delete());
      restoredFaces.forEach(face => face.delete());
    }
    modified.delete();
    tool.delete();
  } finally {
    restored.shape.delete();
    shape.delete();
  }
});

test('completed artifacts survive error/cancellation cleanup and storage failures preserve computation', () => {
  const records = new Map<string, Uint8Array>();
  let flushes = 0;
  const store: KernelArtifactStore = {
    get: id => records.get(id),
    set: (id, bytes) => {
      records.set(id, bytes);
    },
    touch: id => records.has(id),
    getMany(ids: readonly string[]) {
      return ids.map(id => this.get(id));
    },
    touchMany: (ids: readonly string[]) => ids.map(id => records.has(id)),
    delete: id => {
      records.delete(id);
    },
    flush: () => {
      flushes++;
    },
  };
  const lifecycle = {
    estimateBytes: () => 8,
    retain: (value: number) => value,
    instantiate: (value: number) => value,
    release: () => {},
  };
  let cache = createComputationCache({nativeAllocatedBytes: () => 0});
  cache.setKernelArtifactStore(store);
  let cancelled = false;
  const end = cache.beginKernelOperationEvaluation(() => {
    if (cancelled) throw new Error('Cancelled');
  });
  const run = (id: number, compute = () => id) =>
    cache.evaluateCachedArtifact(
      kernelOperationKey('number', [id], []),
      lifecycle,
      compute,
    );
  try {
    run(1);
    cancelled = true;
    assert.throws(() => run(2), /Cancelled/);
  } finally {
    end();
  }
  assert.equal(flushes, 1);
  cache.clearKernelOperationCache();
  cache = createComputationCache({nativeAllocatedBytes: () => 0});
  cache.setKernelArtifactStore(store);
  assert.equal(run(1, () => assert.fail('must restore')).value, 1);
  assert.equal(cache.kernelOperationCacheStats().persistentHits, 1);
  cache.setKernelArtifactStore({
    ...store,
    set: () => {
      throw new Error('Quota');
    },
  });
  assert.equal(run(2).value, 2);
  assert.equal(cache.kernelOperationCacheStats().persistenceErrors, 1);
  assert.equal(run(2, () => assert.fail('memory cache must survive')).value, 2);
  cache.clearKernelOperationCache();
});
