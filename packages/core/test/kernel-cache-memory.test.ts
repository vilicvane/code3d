import {kernelOperationKey} from '../bld/library/kernel-cache.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type {OpenCascadeInstance, TopoDS_Shape} from '@code3d/opencascade';
import {getOC} from 'replicad';
import '../bld/node/index.js';
import {createComputationCache} from '../bld/library/kernel-cache.js';

test('a native memory budget releases historical geometry while returned shapes remain usable', () => {
  const oc = getOC() as OpenCascadeInstance;
  const initial = oc.Code3dMemory.AllocatedBytes();
  const maximumBytes = initial + 1024 * 1024;
  const cache = createComputationCache({
    maximumBytes,
    nativeAllocatedBytes: () => oc.Code3dMemory.AllocatedBytes(),
  });
  const lifecycle = {
    estimateBytes: () => 64,
    retain: (shape: TopoDS_Shape) => shape.clone(),
    instantiate: (shape: TopoDS_Shape) => shape.clone(),
    release: (shape: TopoDS_Shape) => shape.delete(),
  };
  try {
    for (let index = 0; index < 500; index++) {
      const {value} = cache.evaluateCachedArtifact(
        kernelOperationKey('box', [index], []),
        lifecycle,
        () => {
          const builder = new oc.BRepPrimAPI_MakeBox(index + 1, 2, 3);
          try {
            return builder.Shape();
          } finally {
            builder.delete();
          }
        },
      );
      try {
        assert.equal(value.IsNull(), false);
      } finally {
        value.delete();
      }
    }
    const retained = cache.kernelOperationCacheStats();
    assert.ok(retained.entries > 0 && retained.entries < 500);
    assert.ok(
      retained.nativeAllocatedBytes + retained.estimatedJavaScriptBytes <=
        maximumBytes,
    );
    cache.clearKernelOperationCache();
    assert.ok(
      oc.Code3dMemory.AllocatedBytes() <
        retained.nativeAllocatedBytes - 128 * 1024,
    );
    assert.equal(cache.kernelOperationCacheStats().estimatedJavaScriptBytes, 0);
  } finally {
    cache.clearKernelOperationCache();
  }
});
