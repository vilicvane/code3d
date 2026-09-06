import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
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
