import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {getOC} from 'replicad';
import {box} from '../bld/node/index.js';
import {
  describeOpenCascadeException,
  disposeModelObjects,
} from '../bld/tooling/index.js';
import {
  clearKernelOperationCache,
  kernelOperationCacheStats,
} from '../bld/library/kernel-cache.js';

const filletEdges = [2, 3, 4, 6, 7, 8, 11, 12];

afterEach(() => {
  clearKernelOperationCache();
});

test('reports an unbuildable chamfer after reusing its cached prefix', () => {
  assertChamferFailure();
  assert.deepEqual(kernelOperationCacheStats(), {
    entries: 2,
    hits: 0,
    misses: 3,
  });

  assertChamferFailure();
  assert.deepEqual(kernelOperationCacheStats(), {
    entries: 2,
    hits: 2,
    misses: 4,
  });
});

test('decodes a raw OpenCascade WebAssembly exception', () => {
  const base = box(40, 10, 40);
  const rounded = base.fillet(2, filletEdges);
  const shape = rounded.geometry.value.shape;
  const topology = rounded.geometry.value.topology.edges;
  const edges = shape.edges;
  const edge = edges[topology.ids.indexOf(10)];
  const builder = new (getOC().BRepFilletAPI_MakeChamfer)(shape.wrapped);

  try {
    builder.Add(2, edge.wrapped);
    builder.Build();
    assert.equal(builder.IsDone(), false);
    assert.throws(
      () => builder.Shape(),
      error => {
        assert.equal(
          describeOpenCascadeException(error),
          'OpenCascade error (StdFail_NotDone: BRep_API: command not done)',
        );
        return true;
      },
    );
  } finally {
    builder.delete();
    edges.forEach(candidate => candidate.delete());
    disposeModelObjects([base, rounded]);
  }
});

function assertChamferFailure() {
  const base = box(40, 10, 40);
  const rounded = base.fillet(2, filletEdges);
  try {
    assert.throws(
      () => rounded.chamfer(2, [10]),
      error => {
        assert.equal(
          error.message,
          'Could not construct chamfer with distance 2 on E10.\n' +
            'OpenCascade expanded the selection to 1 tangent contour containing 8 edges. The edge/distance combination may create degenerate, self-intersecting, or otherwise unsupported geometry. Try a slightly different distance or edge selection.',
        );
        return true;
      },
    );
  } finally {
    disposeModelObjects([base, rounded]);
  }
}
