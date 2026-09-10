import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formatGridStep, gridStep} from '../src/grid-scale.ts';

test('shared grid steps use 1/2/5 subdivisions at every model scale', () => {
  for (let scale = 1e-9; scale <= 1e12; scale *= 1.03) {
    const step = gridStep(scale);
    assert.ok(step * scale >= 8 - 1e-9 && step * scale <= 20 + 1e-9);
    const normalized = step / 10 ** Math.floor(Math.log10(step));
    assert.ok([1, 2, 5].some(value => Math.abs(value - normalized) < 1e-9));
  }
  assert.equal(gridStep(6), 2);
  assert.equal(gridStep(20), 0.5);
});

test('grid readouts do not expose floating point artifacts or overflow the coordinate control', () => {
  assert.equal(formatGridStep(0.0002), '2e-4');
  assert.equal(formatGridStep(0.002), '0.002');
  assert.equal(formatGridStep(0.20000000000000004), '0.2');
  assert.equal(formatGridStep(500), '500');
  assert.equal(formatGridStep(1e6), '1e6');
});
