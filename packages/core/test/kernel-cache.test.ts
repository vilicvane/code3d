import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {createKernelOperationCache} from '../bld/library/kernel-cache.js';

let cache: ReturnType<typeof createKernelOperationCache>;
beforeEach(() => {
  cache = createKernelOperationCache({
    maximumBytes: 4096,
    nativeAllocatedBytes: () => 0,
  });
});

type Value = {result: number | string; instance: string};
const released: Value[] = [];
const lifecycle: import('../bld/library/kernel-cache.js').KernelValueLifecycle<Value> =
  {
    estimateBytes: () => 64,
    retain: value => ({...value, instance: 'retained'}),
    instantiate: value => ({...value, instance: 'use'}),
    release: value => released.push(value),
  };

afterEach(() => {
  cache.clearKernelOperationCache();
  released.length = 0;
});

test('reuses a complete operation through an independent value', () => {
  let computations = 0;
  const compute = () => ({result: ++computations, instance: 'computed'});

  const first = cache.evaluateKernelOperation(
    'box',
    [10, 20, 30],
    [],
    lifecycle,
    compute,
  );
  const second = cache.evaluateKernelOperation(
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
  assert.partialDeepStrictEqual(cache.kernelOperationCacheStats(), {
    entries: 1,
    hits: 1,
    misses: 1,
  });
});

test('keeps an unchanged prefix when a downstream argument changes', () => {
  const prefix = cache.evaluateKernelOperation(
    'box',
    [10, 20, 30],
    [],
    lifecycle,
    () => ({result: 'prefix', instance: 'computed'}),
  );
  const first = cache.evaluateKernelOperation(
    'fillet',
    [1],
    [prefix],
    lifecycle,
    () => ({result: 'first', instance: 'computed'}),
  );
  const repeatedPrefix = cache.evaluateKernelOperation(
    'box',
    [10, 20, 30],
    [],
    lifecycle,
    () => assert.fail('the prefix should be cached'),
  );
  const changed = cache.evaluateKernelOperation(
    'fillet',
    [2],
    [repeatedPrefix],
    lifecycle,
    () => ({result: 'changed', instance: 'computed'}),
  );

  assert.equal(prefix.id, repeatedPrefix.id);
  assert.notEqual(first.id, changed.id);
  assert.partialDeepStrictEqual(cache.kernelOperationCacheStats(), {
    entries: 3,
    hits: 1,
    misses: 3,
  });
});

test('bounds retained values and releases them on eviction and clear', () => {
  for (let index = 0; index < 300; index += 1) {
    cache.evaluateKernelOperation('primitive', [index], [], lifecycle, () => ({
      result: index,
      instance: 'computed',
    }));
  }

  const retained = cache.kernelOperationCacheStats().entries;
  assert.ok(retained < 300);
  assert.equal(released.length, 300 - retained);

  cache.clearKernelOperationCache();
  assert.equal(released.length, 300);
  assert.partialDeepStrictEqual(cache.kernelOperationCacheStats(), {
    entries: 0,
    hits: 0,
    misses: 0,
  });
});

function primitive(index: number) {
  return cache.evaluateKernelOperation(
    'primitive',
    [index],
    [],
    lifecycle,
    () => ({
      result: index,
      instance: 'computed',
    }),
  );
}

function evaluate(compute: () => void): void {
  const finish = cache.beginKernelOperationEvaluation();
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
  assert.partialDeepStrictEqual(cache.kernelOperationCacheStats(), {
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
  assert.equal(cache.kernelOperationCacheStats().entries, 1200);
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
  const retained = cache.kernelOperationCacheStats();
  assert.ok(retained.entries < 600);
  assert.equal(retained.entries, retained.historicalEntries + 1);
  assert.ok(retained.estimatedJavaScriptBytes <= retained.maximumBytes);
  assert.equal(released.length, 600 - retained.entries);
  assert.equal(owned?.value.result, 599);
  assert.ok(released.every(value => value.instance === 'retained'));

  // Outside operations can churn the history without evicting the last model.
  for (let index = 600; index < 1200; index++) primitive(index);
  assert.ok(cache.kernelOperationCacheStats().estimatedJavaScriptBytes <= 4096);
  assert.equal(primitive(0).value.instance, 'use');

  evaluate(() => {});
  assert.equal(
    cache.kernelOperationCacheStats().historicalEntries,
    cache.kernelOperationCacheStats().entries,
  );
  cache.clearKernelOperationCache();
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
  assert.equal(cache.kernelOperationCacheStats().entries, 400);
  assert.equal(cache.kernelOperationCacheStats().historicalEntries, 0);
  evaluate(() => {
    for (let index = 0; index < 400; index++) {
      assert.equal(primitive(index).value.instance, 'use');
    }
  });
});

test('cancellation retains completed operations and releases the check before the next evaluation', () => {
  let cancelled = false;
  const stopped = new Error('Cancelled');
  const finish = cache.beginKernelOperationEvaluation(() => {
    if (cancelled) throw stopped;
  });
  try {
    for (let index = 0; index < 400; index++) primitive(index);
    cache.evaluateKernelOperation('last complete', [], [], lifecycle, () => {
      cancelled = true;
      return {result: 'completed during cancellation', instance: 'computed'};
    });
    assert.throws(
      () => primitive(400),
      error => error === stopped,
    );
    assert.throws(
      () => primitive(0),
      error => error === stopped,
    );
    assert.partialDeepStrictEqual(cache.kernelOperationCacheStats(), {
      entries: 401,
      hits: 0,
      misses: 401,
    });
  } finally {
    finish();
  }
  evaluate(() => {
    for (let index = 0; index < 400; index++) primitive(index);
    cache.evaluateKernelOperation('last complete', [], [], lifecycle, () =>
      assert.fail('completed result must survive'),
    );
  });
  assert.partialDeepStrictEqual(cache.kernelOperationCacheStats(), {
    entries: 401,
    hits: 401,
    misses: 401,
  });
});

test('clearing a cache also clears its active and previous working sets', () => {
  evaluate(() => {
    primitive(0);
  });
  evaluate(() => {
    primitive(1);
    cache.clearKernelOperationCache();
    primitive(2);
  });
  assert.equal(released.length, 2);
  assert.partialDeepStrictEqual(cache.kernelOperationCacheStats(), {
    entries: 1,
    hits: 0,
    misses: 1,
  });
  cache.clearKernelOperationCache();
  assert.equal(released.length, 3);
});

test('the default budget retains thousands of small historical results for edits and undo', () => {
  cache = createKernelOperationCache({nativeAllocatedBytes: () => 0});
  evaluate(() => {
    for (let index = 0; index < 3000; index++) primitive(index);
  });
  evaluate(() => primitive(3000));
  assert.equal(cache.kernelOperationCacheStats().historicalEntries, 3000);
  assert.equal(cache.kernelOperationCacheStats().maximumBytes, 2 * 1024 ** 3);
  evaluate(() => {
    for (let index = 0; index < 3000; index++) {
      assert.equal(primitive(index).value.instance, 'use');
    }
  });
  assert.equal(cache.kernelOperationCacheStats().misses, 3001);
});

test('LRU evicts the least recently used history according to native memory pressure', () => {
  let nativeBytes = 0;
  cache = createKernelOperationCache({
    maximumBytes: 10_000,
    nativeAllocatedBytes: () => nativeBytes,
  });
  const nativeLifecycle = {
    ...lifecycle,
    release(value: Value) {
      nativeBytes -= 2000;
      lifecycle.release(value);
    },
  };
  const operation = (index: number) =>
    cache.evaluateKernelOperation(
      'native',
      [index],
      [],
      nativeLifecycle,
      () => {
        nativeBytes += 2000;
        return {result: index, instance: 'computed'};
      },
    );
  for (let index = 0; index < 4; index++) operation(index);
  operation(0);
  operation(4);
  assert.deepEqual(
    released.map(value => value.result),
    [1],
  );
  const stats = cache.kernelOperationCacheStats();
  assert.ok(
    stats.nativeAllocatedBytes + stats.estimatedJavaScriptBytes <=
      stats.maximumBytes,
  );
  assert.equal(stats.nativeAllocatedBytes, 8000);
  assert.equal(operation(0).value.instance, 'use');
});

test('a cache hit acquires its disposable value before memory pressure evicts the retained handle', () => {
  let nativeBytes = 0;
  let disposed = false;
  cache = createKernelOperationCache({
    maximumBytes: 4096,
    nativeAllocatedBytes: () => nativeBytes,
  });
  const handles = {
    ...lifecycle,
    instantiate(value: Value) {
      assert.equal(disposed, false);
      return lifecycle.instantiate(value);
    },
    release(value: Value) {
      disposed = true;
      lifecycle.release(value);
    },
  };
  const operation = () =>
    cache.evaluateKernelOperation('handle', [], [], handles, () => ({
      result: 1,
      instance: 'computed',
    }));
  operation();
  nativeBytes = 5000;
  assert.equal(operation().value.instance, 'use');
  assert.equal(disposed, true);
  assert.equal(cache.kernelOperationCacheStats().entries, 0);
});

test('a large mesh consumes the byte budget even with very few cache entries', () => {
  const meshLifecycle = {
    estimateBytes: (value: Float32Array) => value.byteLength,
    retain: (value: Float32Array) => value,
    instantiate: (value: Float32Array) => value,
    release: () => {},
  };
  const mesh = (index: number) =>
    cache.evaluateKernelOperation(
      'mesh',
      [index],
      [],
      meshLifecycle,
      () => new Float32Array(800),
    );
  mesh(0);
  mesh(1);
  assert.equal(cache.kernelOperationCacheStats().entries, 1);
  const before = cache.kernelOperationCacheStats().misses;
  mesh(1);
  assert.equal(cache.kernelOperationCacheStats().misses, before);
  mesh(0);
  assert.equal(cache.kernelOperationCacheStats().misses, before + 1);
});

test('memory pressure during evaluation evicts only unused history', () => {
  let nativeBytes = 0;
  cache = createKernelOperationCache({
    maximumBytes: 4096,
    nativeAllocatedBytes: () => nativeBytes,
  });
  evaluate(() => primitive(0));
  evaluate(() => primitive(1));
  assert.equal(cache.kernelOperationCacheStats().historicalEntries, 1);
  evaluate(() => {
    nativeBytes = 5000;
    primitive(2);
    assert.equal(cache.kernelOperationCacheStats().historicalEntries, 0);
    assert.deepEqual(
      released.map(value => value.result),
      [0],
    );
    assert.equal(primitive(1).value.instance, 'use');
    assert.equal(primitive(2).value.instance, 'use');
  });
  assert.equal(cache.kernelOperationCacheStats().entries, 2);
});
