import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {cached} from '../bld/library/cached.js';
import {googleFontSources} from '../bld/library/google-font.js';
import {
  clearKernelOperationCache,
  createComputationCache,
  kernelOperationCacheStats,
  kernelOperationKey,
} from '../bld/library/kernel-cache.js';

let cache: ReturnType<typeof createComputationCache>;
beforeEach(() => {
  cache = createComputationCache({
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

test('pure computation and Google Font CSS caches work without an installed kernel', () => {
  let computes = 0;
  const twice = cached((value: number) => {
    computes++;
    return value * 2;
  });
  const css = new TextEncoder().encode(
    '@font-face {src: url(https://fonts.gstatic.com/example.ttf); unicode-range: U+0000-00FF;}',
  );
  try {
    assert.equal(twice(4), 8);
    assert.equal(twice(4), 8);
    assert.equal(computes, 1);
    const sources = googleFontSources(css);
    assert.deepEqual(sources, [
      {url: 'https://fonts.gstatic.com/example.ttf', ranges: [[0, 255]]},
    ]);
    assert.equal(googleFontSources(css), sources);
    assert.equal(kernelOperationCacheStats().nativeAllocatedBytes, 0);
  } finally {
    clearKernelOperationCache();
  }
});

test('reuses a complete operation through an independent value', () => {
  let computations = 0;
  const compute = () => ({result: ++computations, instance: 'computed'});

  const first = cache.evaluateCachedArtifact(
    kernelOperationKey('box', [10, 20, 30], []),
    lifecycle,
    compute,
  );
  const second = cache.evaluateCachedArtifact(
    kernelOperationKey('box', [10, 20, 30], []),
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
  const prefix = cache.evaluateCachedArtifact(
    kernelOperationKey('box', [10, 20, 30], []),
    lifecycle,
    () => ({result: 'prefix', instance: 'computed'}),
  );
  const first = cache.evaluateCachedArtifact(
    kernelOperationKey('fillet', [1], [prefix]),
    lifecycle,
    () => ({result: 'first', instance: 'computed'}),
  );
  const repeatedPrefix = cache.evaluateCachedArtifact(
    kernelOperationKey('box', [10, 20, 30], []),
    lifecycle,
    () => assert.fail('the prefix should be cached'),
  );
  const changed = cache.evaluateCachedArtifact(
    kernelOperationKey('fillet', [2], [repeatedPrefix]),
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
    cache.evaluateCachedArtifact(
      kernelOperationKey('primitive', [index], []),
      lifecycle,
      () => ({
        result: index,
        instance: 'computed',
      }),
    );
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
  return cache.evaluateCachedArtifact(
    kernelOperationKey('primitive', [index], []),
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
    cache.evaluateCachedArtifact(
      kernelOperationKey('last complete', [], []),
      lifecycle,
      () => {
        cancelled = true;
        return {result: 'completed during cancellation', instance: 'computed'};
      },
    );
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
    cache.evaluateCachedArtifact(
      kernelOperationKey('last complete', [], []),
      lifecycle,
      () => assert.fail('completed result must survive'),
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
  cache = createComputationCache({nativeAllocatedBytes: () => 0});
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
  cache = createComputationCache({
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
    cache.evaluateCachedArtifact(
      kernelOperationKey('native', [index], []),
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
  cache = createComputationCache({
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
    cache.evaluateCachedArtifact(
      kernelOperationKey('handle', [], []),
      handles,
      () => ({
        result: 1,
        instance: 'computed',
      }),
    );
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
    cache.evaluateCachedArtifact(
      kernelOperationKey('mesh', [index], []),
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
  cache = createComputationCache({
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

test('auxiliary worker memory trims shared history while preserving both active working sets', () => {
  evaluate(() => primitive(0));
  evaluate(() => primitive(1));
  const end = cache.beginKernelOperationEvaluation();
  try {
    primitive(2);
    cache.setKernelExternalBytes(5000);
    assert.equal(cache.kernelOperationCacheStats().historicalEntries, 0);
    assert.equal(cache.kernelOperationCacheStats().externalBytes, 5000);
    assert.equal(primitive(1).value.instance, 'use');
    assert.equal(primitive(2).value.instance, 'use');
  } finally {
    end();
  }
  cache.setKernelExternalBytes(0);
  assert.equal(cache.kernelOperationCacheStats().externalBytes, 0);
  assert.equal(cache.kernelOperationCacheStats().maximumBytes, 4096);
});

test('memory-only resources share LRU eviction without disabling geometry persistence', () => {
  const records = new Map<string, Uint8Array>();
  const reads: string[] = [];
  cache.setKernelArtifactStore({
    get(id) {
      reads.push(id);
      return records.get(id);
    },
    set(id, bytes) {
      records.set(id, bytes);
    },
    touch: id => records.has(id),
    getMany(ids: readonly string[]) {
      return ids.map(id => this.get(id));
    },
    touchMany: (ids: readonly string[]) => ids.map(id => records.has(id)),
    delete(id) {
      records.delete(id);
    },
    flush() {},
  });
  class Parsed {
    value = 1;
  }
  let released = 0;
  const resourceLifecycle = {
    estimateBytes: () => 2000,
    retain: (value: Parsed) => value,
    instantiate: (value: Parsed) => value,
    release() {
      released++;
    },
  };
  const first = cache.evaluateCachedArtifact(
    kernelOperationKey('resource', [1], []),
    resourceLifecycle,
    () => new Parsed(),
    false,
  );
  cache.evaluateCachedArtifact(
    kernelOperationKey('resource', [1], []),
    resourceLifecycle,
    () => assert.fail('Expected memory reuse'),
    false,
  );
  cache.evaluateCachedArtifact(
    kernelOperationKey('resource', [2], []),
    resourceLifecycle,
    () => new Parsed(),
    false,
  );
  assert.ok(released > 0);
  assert.equal(records.size, 0);
  assert.equal(reads.length, 0);
  const geometry = cache.evaluateCachedArtifact(
    kernelOperationKey('geometry', [], [first]),
    lifecycle,
    () => ({result: 42, instance: 'computed'}),
  );
  assert.ok(records.has(geometry.id));
  assert.equal(cache.kernelOperationCacheStats().persistenceErrors, 0);
});

test('warm evaluations batch only used disk entries and repair peer eviction on cancellation', () => {
  const records = new Map<string, Uint8Array>();
  const touches: string[][] = [];
  let writes = 0;
  const store = {
    get: (id: string) => records.get(id),
    set: (id: string, bytes: Uint8Array) => {
      records.set(id, bytes);
      writes++;
    },
    touch: (id: string) => {
      touches.push([id]);
      return records.has(id);
    },
    getMany(ids: readonly string[]) {
      return ids.map(id => this.get(id));
    },
    touchMany: (ids: readonly string[]) => {
      touches.push([...ids]);
      return ids.map(id => records.has(id));
    },
    delete: (id: string) => {
      records.delete(id);
    },
    flush() {},
  };
  const keys = [1, 2, 3].map(id => kernelOperationKey('warm', [id], []));
  const run = (index: number) =>
    cache.evaluateCachedArtifact(keys[index], lifecycle, () => ({
      result: index,
      instance: 'computed',
    }));
  cache.setKernelArtifactStore(store);
  const cold = cache.beginKernelOperationEvaluation();
  keys.forEach((_, index) => run(index));
  cold();
  assert.equal(writes, 3);
  touches.length = 0;
  cache.setKernelArtifactStore(store);
  let cancelled = false;
  const warm = cache.beginKernelOperationEvaluation(() => {
    if (cancelled) throw new Error('Cancelled');
  });
  try {
    run(2);
    run(0);
    run(2);
    assert.equal(touches.length, 0);
    // A peer can evict a durable record while the native value stays in memory.
    records.delete(keys[0].id);
    cancelled = true;
    assert.throws(() => run(1), /Cancelled/);
  } finally {
    warm();
  }
  assert.deepEqual(touches, [[keys[2].id, keys[0].id]]);
  assert.equal(writes, 4);
  assert.equal(records.size, 3);
  assert.equal(cache.kernelOperationCacheStats().misses, 3);
  assert.equal(cache.kernelOperationCacheStats().persistenceErrors, 0);
});

test('batch restoration reads only missing values and preserves misses, ownership and corrupt-record recovery', () => {
  const records = new Map<string, Uint8Array>();
  const batches: string[][] = [];
  const store = {
    get: (id: string) => records.get(id),
    getMany(ids: readonly string[]) {
      batches.push([...ids]);
      return ids.map(id => records.get(id));
    },
    set(id: string, bytes: Uint8Array) {
      records.set(id, bytes);
    },
    touch: (id: string) => records.has(id),
    touchMany: (ids: readonly string[]) => ids.map(id => records.has(id)),
    delete(id: string) {
      records.delete(id);
    },
    flush() {},
  };
  cache.setKernelArtifactStore(store);
  const keys = [0, 1, 2, 3].map(index =>
    kernelOperationKey('batch', [index], []),
  );
  keys.forEach((key, index) =>
    cache.evaluateCachedArtifact(key, lifecycle, () => ({
      result: index,
      instance: 'computed',
    })),
  );
  cache.clearKernelOperationCache();
  const finish = cache.beginKernelOperationEvaluation();
  try {
    cache.findKernelOperation(keys[0], lifecycle);
    records.delete(keys[2].id);
    records.set(keys[3].id, new Uint8Array([1, 2, 3]));
    const result = cache.findKernelOperations(keys, lifecycle);
    assert.deepEqual(batches, [[keys[1].id, keys[2].id, keys[3].id]]);
    assert.deepEqual(
      result.map(value => value?.value),
      [
        {result: 0, instance: 'use'},
        {result: 1, instance: 'use'},
        undefined,
        undefined,
      ],
    );
    assert.equal(records.has(keys[3].id), false);
    assert.equal(cache.kernelOperationCacheStats().persistentHits, 2);
    assert.equal(cache.kernelOperationCacheStats().persistenceErrors, 1);
    cache.evaluateCachedArtifact(keys[3], lifecycle, () => ({
      result: 3,
      instance: 'repaired',
    }));
    assert.ok(records.has(keys[3].id));
  } finally {
    finish();
  }
});

test('pending encoded writes count toward memory pressure without limiting the current version', () => {
  const records = new Map<string, Uint8Array>();
  let pendingWriteBytes = 0;
  cache.setKernelArtifactStore({
    get pendingWriteBytes() {
      return pendingWriteBytes;
    },
    get: id => records.get(id),
    getMany: ids => ids.map(id => records.get(id)),
    set: (id, bytes) => {
      records.set(id, bytes);
    },
    touch: id => records.has(id),
    touchMany: ids => ids.map(id => records.has(id)),
    delete: id => {
      records.delete(id);
    },
    flush() {},
  });
  evaluate(() => primitive(0));
  evaluate(() => primitive(1));
  const end = cache.beginKernelOperationEvaluation();
  try {
    pendingWriteBytes = 2 * 1024 ** 3;
    primitive(2);
    assert.equal(
      cache.kernelOperationCacheStats().pendingPersistenceBytes,
      pendingWriteBytes,
    );
    assert.equal(cache.kernelOperationCacheStats().historicalEntries, 0);
    assert.equal(primitive(1).value.instance, 'use');
    assert.equal(primitive(2).value.instance, 'use');
  } finally {
    end();
  }
  assert.equal(cache.kernelOperationCacheStats().entries, 2);
  pendingWriteBytes = 0;
  assert.equal(cache.kernelOperationCacheStats().pendingPersistenceBytes, 0);
});
