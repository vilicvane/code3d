import assert from 'node:assert/strict';
import test from 'node:test';
import {box, cut, cylinder, group, rectangle} from '../bld/node/index.js';
import {
  beginModelEvaluation,
  clearKernelOperationCache,
  createModelSnapshotter,
  disposeModelObjects,
  executeSnapshotQueryBatch,
  isModelObject,
  kernelOperationCacheStats,
  planModelSnapshotQueries,
} from '../bld/tooling/index.js';

function models() {
  const blank = box(40, 6, 60).fillet(3, [2, 4, 6, 8]);
  const holes = Array.from({length: 6}, (_, i) =>
    cylinder(1.3, 12).originOffset(i * 5 - 12, 0, 0),
  );
  const machined = cut(blank, holes);
  const profile = rectangle(12, 8)
    .extrude(2)
    .rotate(10, 20, 30)
    .originOffset(0, 12, 0);
  const nested = group([machined, profile]).rotate(0, 20, 0);
  const assembly = group([nested, profile.originOffset(30, 0, 0)]);
  return [blank, ...holes, machined, profile, nested, assembly] as const;
}

function runtime(value: unknown) {
  assert.ok(isModelObject(value));
  return value;
}

function closeNumbers(actual: unknown, expected: unknown, path = ''): void {
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert.ok(
      Math.abs(actual - expected) <=
        32 * Number.EPSILON * Math.max(1, Math.abs(expected)),
      `${path}: ${actual} != ${expected}`,
    );
  } else if (
    actual &&
    expected &&
    typeof actual === 'object' &&
    typeof expected === 'object'
  ) {
    assert.deepEqual(Object.keys(actual), Object.keys(expected), path);
    for (const key of Object.keys(expected))
      closeNumbers(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
  } else assert.deepEqual(actual, expected, path);
}

test('snapshot batches preserve nested origins, transforms and mesh ownership across binary transfer', () => {
  clearKernelOperationCache();
  const finish = beginModelEvaluation();
  const authored = models();
  const objects = authored.map(runtime);
  const batches = planModelSnapshotQueries(objects);
  const inputs = new Map(batches.map(batch => [batch.id, batch.encode()]));
  const expected = objects.map(createModelSnapshotter());
  clearKernelOperationCache();
  try {
    assert.ok(batches.length > 5);
    const keys = batches.flatMap(batch =>
      batch.queries.map(query => query.key.id),
    );
    assert.equal(keys.length, new Set(keys).size);
    for (const batch of batches) {
      const bytes = inputs.get(batch.id)!;
      const transferred = structuredClone(bytes, {transfer: [bytes.buffer]});
      assert.equal(bytes.byteLength, 0);
      executeSnapshotQueryBatch(
        batch.id,
        transferred,
        batch.queries,
        () => {},
        (query, value) => batch.accept(query, value),
      );
    }
    const actual = objects.map(createModelSnapshotter());
    closeNumbers(actual, expected);
    actual.forEach((object, index) =>
      assert.deepEqual(object.mesh, expected[index].mesh),
    );
    assert.deepEqual(planModelSnapshotQueries(objects), []);
    assert.ok(kernelOperationCacheStats().hits > 50);
    // Reusing these inputs in further geometry must not see detached buffers or deleted handles.
    assert.ok(
      createModelSnapshotter()(runtime(authored[0].fillet(0.1))).mesh!.vertices
        .length > 0,
    );
  } finally {
    finish();
    disposeModelObjects(objects);
    clearKernelOperationCache();
  }
});

test('a cancelled batch retains completed queries and schedules only its unfinished suffix', () => {
  clearKernelOperationCache();
  const finish = beginModelEvaluation();
  const object = runtime(group([box(13, 17, 23)]).rotate(10, 20, 30));
  const [batch] = planModelSnapshotQueries([object]);
  let completed = 0;
  try {
    assert.throws(
      () =>
        executeSnapshotQueryBatch(
          batch.id,
          batch.encode(),
          batch.queries,
          () => {
            if (completed === 3) throw new Error('Cancelled');
          },
          (query, value) => {
            batch.accept(query, value);
            completed++;
          },
        ),
      /Cancelled/,
    );
    const [remaining] = planModelSnapshotQueries([object]);
    assert.equal(remaining.queries.length, batch.queries.length - 3);
    assert.deepEqual(
      remaining.queries.map(query => query.key.id),
      batch.queries.slice(3).map(query => query.key.id),
    );
    executeSnapshotQueryBatch(
      remaining.id,
      remaining.encode(),
      remaining.queries,
      () => {},
      (query, value) => remaining.accept(query, value),
    );
    assert.deepEqual(planModelSnapshotQueries([object]), []);
  } finally {
    finish();
    disposeModelObjects([object]);
    clearKernelOperationCache();
  }
});

test('releasing restored inputs also releases transformed reference geometry without waiting for GC', () => {
  clearKernelOperationCache();
  const finish = beginModelEvaluation();
  const object = runtime(
    group([box(9, 11, 13).rotate(10, 20, 30).originOffset(4, 5, 6)]).rotate(
      0,
      17,
      0,
    ),
  );
  const [batch] = planModelSnapshotQueries([object]);
  const bytes = batch.encode();
  const queries = batch.queries.filter(query => query.kind === 'bounds');
  try {
    executeSnapshotQueryBatch(
      batch.id,
      bytes,
      queries,
      () => {},
      () => {},
    );
    const before = kernelOperationCacheStats().nativeAllocatedBytes;
    for (let i = 0; i < 30; i++)
      executeSnapshotQueryBatch(
        batch.id,
        bytes,
        queries,
        () => {},
        () => {},
      );
    const retained = kernelOperationCacheStats().nativeAllocatedBytes - before;
    assert.ok(
      retained < 4096,
      `restored input retained ${retained} native bytes`,
    );
  } finally {
    finish();
    disposeModelObjects([object]);
    clearKernelOperationCache();
  }
});

test('scaled topology bounds preserve their borrowed source shape', () => {
  const original = box(9, 11, 13);
  const scaled = original.scaled(2).rotate(10, 20, 30);
  const before = createModelSnapshotter()(runtime(original));
  for (const id of [1, 2, 3, 4]) {
    assert.ok(scaled.surface(id).up);
    assert.ok(scaled.vertex(id).front);
  }
  clearKernelOperationCache();
  assert.deepEqual(createModelSnapshotter()(runtime(original)), before);
  assert.ok(
    createModelSnapshotter()(runtime(scaled.fillet(0.1))).mesh!.vertices
      .length > 0,
  );
});

test('directional bounds reuse geometry bounds for axis permutations and remain tight at arbitrary angles', () => {
  clearKernelOperationCache();
  const finish = beginModelEvaluation();
  const body = cylinder(7, 13).originOffset(3, 4, 5);
  const quarter = group([body]).rotate(90, 0, 0);
  const diagonal = group([body]).rotate(0, 45, 0);
  const objects = [body, quarter, diagonal].map(runtime);
  try {
    const cardinal = planModelSnapshotQueries(objects.slice(0, 2));
    assert.ok(cardinal.length > 0);
    assert.ok(
      cardinal.every(batch =>
        batch.queries.every(query => query.kind === 'mesh'),
      ),
    );
    const rotated = planModelSnapshotQueries([objects[2]]);
    assert.ok(
      rotated.some(batch =>
        batch.queries.some(query => query.kind === 'bounds'),
      ),
    );
    const front = createModelSnapshotter()(objects[2]).elements.find(
      element => element.name === 'front',
    )!;
    // Rotating a cylinder about its own axis preserves its diameter; rotating
    // its old AABB would incorrectly report 14 * sqrt(2).
    assert.ok(Math.abs(front.bound!.size[0] - 14) < 1e-6);
    assert.ok(Math.abs(front.bound!.size[1] - 13) < 1e-6);
  } finally {
    finish();
    disposeModelObjects(objects);
    clearKernelOperationCache();
  }
});
