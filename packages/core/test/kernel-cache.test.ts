import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  beginKernelOperationEvaluation,
  clearKernelOperationCache,
  evaluateKernelOperation,
  kernelOperationCacheStats,
} from '../bld/library/kernel-cache.js';

type Value = {result: number | string; instance: string};
const released: Value[] = [];
const lifecycle: import('../bld/library/kernel-cache.js').KernelValueLifecycle<Value> =
  {
    retain: value => ({...value, instance: 'retained'}),
    instantiate: value => ({...value, instance: 'use'}),
    release: value => released.push(value),
  };

afterEach(() => {
  clearKernelOperationCache();
  released.length = 0;
});

test('reuses a complete operation through an independent value', () => {
  let computations = 0;
  const compute = () => ({result: ++computations, instance: 'computed'});

  const first = evaluateKernelOperation(
    'box',
    [10, 20, 30],
    [],
    lifecycle,
    compute,
  );
  const second = evaluateKernelOperation(
    'box',
    [10, 20, 30],
    [],
    lifecycle,
    compute,
  );

  assert.equal(computations, 1);
  assert.equal(first.id, second.id);
  assert.deepEqual(first.value, {result: 1, instance: 'computed'});
  assert.deepEqual(second.value, {result: 1, instance: 'use'});
  assert.deepEqual(kernelOperationCacheStats(), {
    entries: 1,
    hits: 1,
    misses: 1,
  });
});

test('keeps an unchanged prefix when a downstream argument changes', () => {
  const prefix = evaluateKernelOperation(
    'box',
    [10, 20, 30],
    [],
    lifecycle,
    () => ({result: 'prefix', instance: 'computed'}),
  );
  const first = evaluateKernelOperation(
    'fillet',
    [1],
    [prefix],
    lifecycle,
    () => ({result: 'first', instance: 'computed'}),
  );
  const repeatedPrefix = evaluateKernelOperation(
    'box',
    [10, 20, 30],
    [],
    lifecycle,
    () => assert.fail('the prefix should be cached'),
  );
  const changed = evaluateKernelOperation(
    'fillet',
    [2],
    [repeatedPrefix],
    lifecycle,
    () => ({result: 'changed', instance: 'computed'}),
  );

  assert.equal(prefix.id, repeatedPrefix.id);
  assert.notEqual(first.id, changed.id);
  assert.deepEqual(kernelOperationCacheStats(), {
    entries: 3,
    hits: 1,
    misses: 3,
  });
});

test('bounds retained values and releases them on eviction and clear', () => {
  for (let index = 0; index < 300; index += 1) {
    evaluateKernelOperation('primitive', [index], [], lifecycle, () => ({
      result: index,
      instance: 'computed',
    }));
  }

  const retained = kernelOperationCacheStats().entries;
  assert.ok(retained < 300);
  assert.equal(released.length, 300 - retained);

  clearKernelOperationCache();
  assert.equal(released.length, 300);
  assert.deepEqual(kernelOperationCacheStats(), {
    entries: 0,
    hits: 0,
    misses: 0,
  });
});

function primitive(index: number) {
  return evaluateKernelOperation('primitive', [index], [], lifecycle, () => ({
    result: index,
    instance: 'computed',
  }));
}

function evaluate(compute: () => void): void {
  const finish = beginKernelOperationEvaluation();
  try {
    compute();
  } finally {
    finish();
  }
}

test('reuses an entire evaluation larger than the historical cache', () => {
  evaluate(() => {
    for (let index = 0; index < 600; index++) primitive(index);
  });
  for (let revision = 0; revision < 3; revision++) {
    evaluate(() => {
      for (let index = 0; index < 600; index++) {
        assert.equal(primitive(index).value.instance, 'use');
      }
    });
  }
  assert.deepEqual(kernelOperationCacheStats(), {
    entries: 600,
    hits: 1800,
    misses: 600,
  });
  assert.equal(released.length, 0);
});

test('a changed prefix preserves later operations from the previous evaluation', () => {
  evaluate(() => {
    for (let index = 0; index < 600; index++) primitive(index);
  });
  evaluate(() => {
    for (let index = 600; index < 1200; index++) primitive(index);
    for (let index = 0; index < 600; index++) {
      assert.equal(primitive(index).value.instance, 'use');
    }
  });
  assert.equal(kernelOperationCacheStats().entries, 1200);
  assert.equal(released.length, 0);
});

test('shrinking evaluations release old working sets and bound unused history', () => {
  let owned: ReturnType<typeof primitive> | undefined;
  evaluate(() => {
    for (let index = 0; index < 600; index++) owned = primitive(index);
  });
  evaluate(() => {
    primitive(0);
  });
  assert.equal(kernelOperationCacheStats().entries, 257);
  assert.equal(released.length, 343);
  assert.equal(owned?.value.result, 599);
  assert.ok(released.every(value => value.instance === 'retained'));

  // Outside operations can churn the history without evicting the last model.
  for (let index = 600; index < 1200; index++) primitive(index);
  assert.equal(kernelOperationCacheStats().entries, 257);
  assert.equal(primitive(0).value.instance, 'use');

  evaluate(() => {});
  assert.equal(kernelOperationCacheStats().entries, 256);
  clearKernelOperationCache();
  assert.equal(released.length, 1200);
});

test('a failed evaluation retains its reusable prefix and closes its scope', () => {
  assert.throws(
    () =>
      evaluate(() => {
        for (let index = 0; index < 400; index++) primitive(index);
        throw new Error('Model failed');
      }),
    /Model failed/,
  );
  for (let index = 400; index < 800; index++) primitive(index);
  assert.equal(kernelOperationCacheStats().entries, 656);
  evaluate(() => {
    for (let index = 0; index < 400; index++) {
      assert.equal(primitive(index).value.instance, 'use');
    }
  });
});

test('clearing a cache also clears its active and previous working sets', () => {
  evaluate(() => {
    primitive(0);
  });
  evaluate(() => {
    primitive(1);
    clearKernelOperationCache();
    primitive(2);
  });
  assert.equal(released.length, 2);
  assert.deepEqual(kernelOperationCacheStats(), {
    entries: 1,
    hits: 0,
    misses: 1,
  });
  clearKernelOperationCache();
  assert.equal(released.length, 3);
});
