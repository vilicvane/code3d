import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createModelSnapshotter,
  disposeModelObjects,
} from '@code3d/core/tooling';

import * as screws from '../bld/library/index.js';
import {replicad} from '@code3d/core/replicad';
import {
  clearKernelOperationCache,
  kernelOperationCacheStats,
} from '../../core/bld/library/kernel-cache.js';

const {ISO4762} = screws;

test('keeps the thread primitive private to the screws package', () => {
  assert.deepEqual(Object.keys(screws), ['ISO4762']);
  assert.equal('helicalThread' in screws, false);
});

test('ISO 4762 screws build through the package-local thread primitive', () => {
  const screw = ISO4762.screw('M6', 18);

  try {
    const snapshot = createModelSnapshotter()(screw);
    assert.equal(snapshot.kind, 'solid');
    assert.ok(snapshot.mesh.triangles.length > 0);
  } finally {
    disposeModelObjects([screw]);
  }
});

test('identical screw dimensions reuse thread construction, booleans, and meshes after disposal', t => {
  clearKernelOperationCache();
  const loftWith = replicad.Sketch.prototype.loftWith;
  const lofts = t.mock.method(
    replicad.Sketch.prototype,
    'loftWith',
    function (...args) {
      return loftWith.apply(this, args);
    },
  );
  const first = ISO4762.screw('M6', 21);
  const id = first.geometry.id;
  const mesh = createModelSnapshotter()(first).mesh;
  const buildCount = lofts.mock.callCount();
  assert.ok(buildCount > 0);
  disposeModelObjects([first]);

  const before = kernelOperationCacheStats();
  const repeat = ISO4762.screw('M6', 21);
  try {
    assert.equal(repeat.geometry.id, id);
    assert.deepEqual(createModelSnapshotter()(repeat).mesh, mesh);
    assert.equal(lofts.mock.callCount(), buildCount);
    assert.equal(kernelOperationCacheStats().misses, before.misses);
  } finally {
    disposeModelObjects([repeat]);
    clearKernelOperationCache();
  }

  // The package cache retains B-Rep data, not handles owned by core's cache.
  const afterClear = ISO4762.screw('M6', 21);
  try {
    assert.equal(afterClear.geometry.id, id);
    assert.deepEqual(createModelSnapshotter()(afterClear).mesh, mesh);
  } finally {
    disposeModelObjects([afterClear]);
    clearKernelOperationCache();
  }
});
