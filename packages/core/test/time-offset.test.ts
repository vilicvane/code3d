import assert from 'node:assert/strict';
import {test} from 'node:test';
import {timeOffset, beginTimeOffset} from '../src/library/time-offset.ts';

test('time offset is an ordinary number with a standalone default and a fixed evaluation value', () => {
  assert.equal(timeOffset(), 0);
  assert.equal(timeOffset(5), 5);
  const reads: number[] = [];
  const finish = beginTimeOffset(2, value => reads.push(value));
  try {
    assert.equal(timeOffset(100), 2);
    assert.equal(timeOffset() > 1 ? 3 : 4, 3);
    assert.deepEqual(
      [1, 2].map(() => timeOffset()),
      [2, 2],
    );
  } finally {
    finish();
  }
  assert.deepEqual(reads, [2, 2, 2, 2]);
  assert.equal(timeOffset(5), 5);
});

test('nested time offset scopes restore after failure and invalid values report a model error', () => {
  const finish = beginTimeOffset(3);
  try {
    const end = beginTimeOffset(NaN);
    try {
      assert.throws(() => timeOffset(), /finite number/);
    } finally {
      end();
    }
    assert.equal(timeOffset(), 3);
  } finally {
    finish();
  }
  assert.throws(() => timeOffset(Infinity), /finite number/);
});
