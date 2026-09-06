import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from '../../core/test/model-test.ts';
import assert from 'node:assert/strict';
import test from 'node:test';

import * as screws from '@code3d/screws';
import {replicad} from '@code3d/core/replicad';
import {
  clearKernelOperationCache,
  kernelOperationCacheStats,
} from '../../core/bld/library/kernel-cache.js';

const {ISO4762} = screws;

test('keeps the thread primitive private to the screws package', async () => {
  assert.deepEqual(Object.keys(screws), ['ISO4762']);
  assert.equal('helicalThread' in screws, false);
  await assert.rejects(
    // @ts-expect-error Private package paths must also fail at runtime.
    import('@code3d/screws/bld/library/thread.js'),
    {
      code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    },
  );
});

test('ISO 4762 screws build through the package-local thread primitive', () => {
  const screw = ISO4762.screw('M6', 18);

  try {
    const snapshot = createModelSnapshotter()(screw);
    assert.equal(snapshot.kind, 'solid');
    assert.ok(snapshot.mesh);
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
    function (
      this: InstanceType<typeof replicad.Sketch>,
      ...args: Parameters<typeof loftWith>
    ) {
      return loftWith.apply(this, args);
    },
  );
  const first = ISO4762.screw('M6', 21);
  const id = modelGeometry(first).id;
  const mesh = createModelSnapshotter()(first).mesh;
  const buildCount = lofts.mock.callCount();
  assert.ok(buildCount > 0);
  disposeModelObjects([first]);

  const before = kernelOperationCacheStats();
  const repeat = ISO4762.screw('M6', 21);
  try {
    assert.equal(modelGeometry(repeat).id, id);
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
    assert.equal(modelGeometry(afterClear).id, id);
    assert.deepEqual(createModelSnapshotter()(afterClear).mesh, mesh);
  } finally {
    disposeModelObjects([afterClear]);
    clearKernelOperationCache();
  }
});
