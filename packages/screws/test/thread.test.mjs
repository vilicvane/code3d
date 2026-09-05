import assert from 'node:assert/strict';
import test from 'node:test';
import {replicad} from '@code3d/core/replicad';
import {disposeModelObjects} from '@code3d/core/tooling';
import {helicalThread} from '../bld/library/thread.js';
import {clearKernelOperationCache} from '../../core/bld/library/kernel-cache.js';

test('the private thread cache keys every normalized geometric input', () => {
  const options = {
    pitch: 1,
    y: 1.5,
    majorDiameter: 6,
    minorDiameter: 5,
    rootWidth: 0.75,
    crestWidth: 0.125,
  };
  const first = helicalThread(options);
  const repeat = helicalThread({...options, leftHanded: false});
  const variants = [
    {pitch: 1.1},
    {y: 1.6},
    {majorDiameter: 6.1},
    {minorDiameter: 4.9},
    {rootWidth: 0.7},
    {crestWidth: 0.15},
    {leftHanded: true},
  ].map(variant => helicalThread({...options, ...variant}));
  try {
    assert.equal(first.geometry.id, repeat.geometry.id);
    assert.equal(
      new Set([first, ...variants].map(model => model.geometry.id)).size,
      8,
    );
    for (const model of [first, repeat, ...variants]) {
      assert.ok(replicad.measureVolume(model.geometry.value.shape) > 0);
    }
    // Validation runs even if a related valid shape is already cached.
    assert.throws(
      () => helicalThread({...options, pitch: -1}),
      /positive finite number/,
    );
  } finally {
    disposeModelObjects([first, repeat, ...variants]);
    clearKernelOperationCache();
  }
});
