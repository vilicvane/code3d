import assert from 'node:assert/strict';
import test from 'node:test';
import {estimateRetainedBytes} from '../bld/library/retained-memory.js';

test('mesh weights include backing storage once for shared views', () => {
  const positions = new Float32Array(30_000);
  const shared = {positions, other: positions.subarray(0, 3)};
  const copied = {positions, other: positions.slice(0, 3)};
  assert.ok(estimateRetainedBytes(shared) >= positions.byteLength);
  assert.ok(estimateRetainedBytes(shared) < positions.byteLength + 1024);
  assert.ok(estimateRetainedBytes(copied) > estimateRetainedBytes(shared));
});

test('weights include topology paths and signatures without serializing geometry', () => {
  assert.ok(
    estimateRetainedBytes([
      [1, 2, 3],
      [1, 2, 4],
    ]) > estimateRetainedBytes([1, 2]),
  );
  assert.ok(estimateRetainedBytes('x'.repeat(1000)) >= 2000);
});
