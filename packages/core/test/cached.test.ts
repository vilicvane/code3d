import {box, cached, cut} from '@code3d/core';
import {definePrimitive, replicad} from '@code3d/core/replicad';
import {
  beginModelEvaluation,
  clearKernelOperationCache,
  identifyCachedFunction,
  kernelOperationCacheStats,
  setKernelArtifactStore,
} from '@code3d/core/tooling';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';

const records = new Map<string, Uint8Array>();
const store = {
  get: (id: string) => records.get(id),
  set(id: string, bytes: Uint8Array) {
    records.set(id, bytes);
  },
  touch: (id: string) => records.has(id),
  getMany(ids: readonly string[]) {
    return ids.map(id => this.get(id));
  },
  touchMany: (ids: readonly string[]) => ids.map(id => records.has(id)),
  delete(id: string) {
    records.delete(id);
  },
  flush() {},
};
afterEach(() => {
  setKernelArtifactStore(undefined);
  clearKernelOperationCache();
  records.clear();
});

test('custom codecs run only for disk writes and restores, including historical edits', () => {
  class Answer {
    readonly value: number;
    constructor(value: number) {
      this.value = value;
    }
  }
  let calls = 0,
    encodes = 0,
    decodes = 0;
  const compute = identifyCachedFunction((input: number) => {
    calls++;
    return new Answer(input * 2);
  }, 'test:answer');
  const options = {
    encoder(value: Answer) {
      encodes++;
      return new Uint8Array([value.value]);
    },
    decoder(bytes: Uint8Array) {
      decodes++;
      return new Answer(bytes[0]);
    },
  };
  const twice = cached(compute, options);
  setKernelArtifactStore(store);
  const first = twice(10);
  assert.equal(twice(10), first);
  twice(11);
  assert.equal(twice(10), first);
  assert.deepEqual([calls, encodes, decodes], [2, 2, 0]);
  clearKernelOperationCache();
  const restored = twice(10);
  assert.ok(restored instanceof Answer);
  assert.equal(restored.value, 20);
  assert.equal(twice(10), restored);
  assert.deepEqual([calls, encodes, decodes], [2, 2, 1]);
  assert.equal(kernelOperationCacheStats().persistentHits, 1);
});

test('plain data preserves exact scalar and binary values after restoration', () => {
  setKernelArtifactStore(store);
  const value = {
    values: [undefined, -0, NaN, Infinity, -Infinity, 3n],
    bytes: new Uint8Array([0, 255]),
    shorts: new Int16Array([-10, 20]),
    doubles: new Float64Array([1 / 3, Number.MIN_VALUE]),
    big: new BigUint64Array([2n ** 63n]),
    view: new DataView(new Uint8Array([1, 2]).buffer),
    buffer: new Uint8Array([3, 4]).buffer,
    date: new Date('2026-09-10'),
    map: new Map([['key', new Set([1, 2])]]),
  };
  let calls = 0;
  const data = cached(
    identifyCachedFunction(() => {
      calls++;
      return value;
    }, 'test:data'),
  );
  assert.equal(data(), value);
  clearKernelOperationCache();
  assert.deepEqual(data(), value);
  assert.equal(calls, 1);
});

test('reference graphs, sparse arrays and shared buffer views preserve their semantics', () => {
  setKernelArtifactStore(store);
  const key = {value: 1};
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5]);
  const value: {
    key: typeof key;
    alias: typeof key;
    self?: unknown;
    map: Map<object, unknown>;
    array: unknown[];
    left: Uint8Array;
    right: DataView;
  } = {
    key,
    alias: key,
    map: new Map([[key, key]]),
    array: new Array(3),
    left: bytes.subarray(2, 4),
    right: new DataView(bytes.buffer, 1, 3),
  };
  value.self = value;
  value.array[1] = undefined;
  const data = cached(identifyCachedFunction(() => value, 'test:graph'));
  data();
  clearKernelOperationCache();
  const restored = data();
  assert.equal(restored.self, restored);
  assert.equal(restored.key, restored.alias);
  assert.equal(restored.map.get(restored.key), restored.key);
  assert.equal(0 in restored.array, false);
  assert.equal(1 in restored.array, true);
  assert.equal(restored.left.buffer, restored.right.buffer);
  assert.equal(restored.left.byteOffset, 2);
  assert.equal(restored.left.buffer.byteLength, 6);
  const same = cached((a: object, b: object) => a === b);
  assert.equal(same(key, key), true);
  assert.equal(same({value: 1}, {value: 1}), false);
});

test('distinct closures do not collide outside the engine and share the memory cache', () => {
  setKernelArtifactStore(store);
  const create = (factor: number) => cached((input: number) => input * factor);
  const double = create(2),
    triple = create(3);
  assert.equal(double(4), 8);
  assert.equal(triple(4), 12);
  assert.equal(double(4), 8);
  assert.equal(kernelOperationCacheStats().hits, 1);
  assert.equal(records.size, 0);
});

test('identifying one cache definition does not leak its codec identity to other uses of the function', () => {
  setKernelArtifactStore(store);
  let calls = 0;
  const compute = (value: number) => {
    calls++;
    return value * 2;
  };
  const identified = cached(
    identifyCachedFunction(compute, 'test:bound-definition'),
  );
  const ordinary = cached(compute, {
    encoder: () =>
      assert.fail('An uninstrumented definition must stay in memory'),
    decoder: () =>
      assert.fail('An uninstrumented definition must stay in memory'),
  });
  assert.equal(identified(2), 4);
  assert.equal(ordinary(2), 4);
  assert.equal(ordinary(2), 4);
  assert.equal(calls, 2);
  assert.equal(kernelOperationCacheStats().entries, 2);
  assert.equal(records.size, 1);
});

test('definition fingerprints and all input values distinguish cached computations', () => {
  const old = cached(
    identifyCachedFunction((input: number) => input * 2, 'test:old'),
  );
  const changed = cached(
    identifyCachedFunction((input: number) => input * 3, 'test:changed'),
  );
  assert.equal(old(2), 4);
  assert.equal(changed(2), 6);
  let calls = 0;
  const identity = cached((value: unknown) => {
    calls++;
    return value;
  });
  for (const value of [
    undefined,
    null,
    -0,
    0,
    NaN,
    Infinity,
    new Uint8Array([1]),
    new Int8Array([1]),
  ])
    identity(value);
  assert.equal(calls, 8);
  assert.equal(identity(undefined), undefined);
  assert.equal(calls, 8);
});

test('completed public cached work survives cancellation while errors never enter the cache', () => {
  let cancelled = false,
    calls = 0;
  const finish = beginModelEvaluation(() => {
    if (cancelled) throw new Error('Cancelled');
  });
  const compute = cached((value: number) => {
    calls++;
    cancelled = true;
    return value * 2;
  });
  try {
    assert.equal(compute(2), 4);
    assert.throws(() => compute(3), /Cancelled/);
  } finally {
    finish();
  }
  assert.equal(compute(2), 4);
  assert.equal(calls, 1);
  const fail = cached(() => {
    calls++;
    throw new Error('Failure');
  });
  assert.throws(fail, /Failure/);
  assert.throws(fail, /Failure/);
  assert.equal(calls, 3);
});

test('primitive disk restore skips its builder and creates independently owned models', () => {
  setKernelArtifactStore(store);
  let calls = 0;
  const build = identifyCachedFunction((radius: number) => {
    calls++;
    return replicad.makeCylinder(radius, 4);
  }, 'test:primitive');
  const cylinder = definePrimitive(build);
  const first = cylinder(2);
  const id = modelGeometry(first).id;
  const mesh = createModelSnapshotter()(first).mesh;
  clearKernelOperationCache();
  const restored = cylinder(2);
  const repeat = cylinder(2);
  const owned = new Set([first, restored, repeat]);
  try {
    assert.equal(calls, 1);
    assert.notEqual(restored, repeat);
    assert.equal(modelGeometry(restored).id, id);
    assert.notEqual(
      modelGeometry(restored).value.shape,
      modelGeometry(repeat).value.shape,
    );
    assert.deepEqual(createModelSnapshotter()(restored).mesh, mesh);
    disposeModelObjects([restored]);
    owned.delete(restored);
    clearKernelOperationCache();
    assert.deepEqual(createModelSnapshotter()(repeat).mesh, mesh);
    assert.deepEqual(createModelSnapshotter()(first).mesh, mesh);
  } finally {
    disposeModelObjects([...owned]);
  }
});

for (const persistence of [false, true]) {
  for (const first of ['boolean', 'geometry'] as const) {
    for (const operation of ['originOffset', 'rotate'] as const) {
      test(`${operation} and boolean transforms keep distinct cache values: ${first} first, ${persistence ? 'persistent' : 'memory'}`, () => {
        if (persistence) setKernelArtifactStore(store);
        const stock = box(10, 10, 10);
        const cutter = box(2, 2, 2);
        const owned = [stock, cutter];
        const expected = modelGeometry(cutter).value.shape.boundingBox.bounds;
        const geometry = () => {
          const result = cutter[operation](0, 0, 0);
          owned.push(result);
          assert.deepEqual(
            modelGeometry(result).value.shape.boundingBox.bounds,
            expected,
          );
          assert.ok(createModelSnapshotter()(result).mesh!.vertices.length > 0);
        };
        const boolean = () => {
          const result = cut(stock, [cutter]);
          owned.push(result);
          assert.ok(createModelSnapshotter()(result).mesh!.vertices.length > 0);
        };
        try {
          (first === 'boolean' ? boolean : geometry)();
          if (persistence) clearKernelOperationCache();
          (first === 'boolean' ? geometry : boolean)();
          if (persistence) clearKernelOperationCache();
          geometry();
          boolean();
          if (persistence)
            assert.ok(kernelOperationCacheStats().persistentHits > 0);
        } finally {
          disposeModelObjects(owned);
        }
      });
    }
  }
}
