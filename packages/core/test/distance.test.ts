import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  box,
  circle,
  cylinder,
  distance,
  group,
  line,
  offset,
  point,
  rectangle,
  rotate,
  sphere,
  tube,
  type Model,
} from '@code3d/core';
import {
  beginModelEvaluation,
  type DistanceSnapshot,
  clearKernelOperationCache,
  kernelOperationCacheStats,
} from '@code3d/core/tooling';
import {disposeModelObjects} from './model-test.ts';

const retained: Model[] = [];
function keep<T extends Model>(model: T): T {
  retained.push(model);
  return model;
}
afterEach(() => {
  disposeModelObjects(retained.splice(0));
  clearKernelOperationCache();
});
function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
}

test('distance measures points in the default common frame and normalizes an optional axis', () => {
  const a = keep(point([1, 2, 3]));
  const b = keep(point([4, 6, 3]));
  near(distance(a, b), 5);
  near(distance(a, b, 'x'), 3);
  near(distance(a, b, 'y'), 4);
  near(distance(a, b, 'z'), 0);
  near(distance(a, b, [6, 8, 0]), 5);
  near(distance(b, a, [-6, -8, 0]), 5);
  near(distance(a.center, b.center), 5);
  const moved = keep(b.originOffset(3, 4, 0));
  near(distance(a, moved), 0);
  near(distance(a, b), 5);
  assert.throws(() => distance(a, b, [0, 0, 0]), /non-zero/);
  assert.throws(() => distance(a, b, [NaN, 0, 0]), /finite/);
});

test('finite edges use trim boundaries and projected intervals, not the projection of closest points', () => {
  const a = keep(line([0, 0, 0], [1, 0, 0]));
  const b = keep(line([4, 3, 0], [5, 3, 0]));
  near(distance(a, b), Math.sqrt(18));
  near(distance(a.edge(1), b.edge(1), 'x'), 3);
  const diagonal = keep(line([10, 10, 0]));
  const target = keep(point([0, 10, 0]));
  near(distance(diagonal, target), Math.sqrt(50));
  near(distance(diagonal, target, 'x'), 0);
  near(distance(diagonal, target, 'y'), 0);
  near(distance(diagonal.end, target), 10);
});

test('finite faces, solids, topology and directional bounds retain their distinct geometry', () => {
  const face = keep(rectangle(2, 2));
  const target = keep(point([3, 4, 0]));
  near(distance(face, target), Math.sqrt(20));
  near(distance(face.surface(1), target), Math.sqrt(20));
  near(distance(face, target, 'x'), 2);
  const ball = keep(sphere(2));
  const center = keep(point());
  near(distance(ball, center), 0);
  near(distance(ball.surface(1), center), 2);
  const block = keep(box(4, 6, 8));
  near(distance(block.left, block.right), 4);
  near(distance(block.up, block.down, 'y'), 6);
  near(distance(block.vertex(1), block.vertex(1)), 0);
  // A bound of a point or edge can degenerate to a point or line.
  near(distance(target.up, target), 0);
  const edge = keep(line([0, 0, 0], [2, 0, 0]));
  near(distance(edge.up, center), 0);
  assert.throws(() => distance(face.plane, target), /finite geometry/);
});

test('curved geometry projections are tight and independent of meshing or old axis-aligned bounds', () => {
  const round = keep(cylinder(2, 8));
  const target = keep(point([10, 0, 10]));
  near(distance(round, target, [1, 0, 1]), Math.sqrt(200) - 2);
  const rim = round
    .edges()
    .find(edge => Math.abs(distance(edge.center, round.center) - 4) < 1e-6)!;
  assert.ok(rim);
  near(distance(rim, target, [1, 0, 1]), Math.sqrt(200) - 2);
  const face = keep(circle(2));
  assert.throws(() => distance(round, target, face.edge(1)), /straight axis/);
});

test('holes in solids and trimmed faces remain empty space for distance queries', () => {
  const ring = keep(tube(4, 2, 6));
  const center = keep(point());
  const topCenter = keep(point([0, 3, 0]));
  near(distance(ring, center), 2);
  const top = ring
    .surfaces()
    .find(face => distance(face.center, topCenter) < 1e-6)!;
  assert.ok(top);
  near(distance(top, topCenter), 2);
  near(distance(top, center), Math.sqrt(13));
  near(distance(ring, center, 'x'), 0);
});

test('measurement solves existing relations before any group and returns an ordinary snapshot number', () => {
  const a = keep(box(10, 10, 10));
  const b = keep(
    box(10, 10, 10).relate(self => [self.on(a.right), offset(7, 0, 0)]),
  );
  near(distance(a, b), 7);
  near(distance(a.center, b.center), 17);
  const captured = distance(a.right, b.left, 'x');
  const c = keep(b.relate(() => offset(5, 0, 0)));
  near(captured, 7);
  near(distance(a.right, c.left, 'x'), 12);
  near(distance(a, b), 7);
  const beam = keep(box(captured, 2, 2).relate(self => self.on(a.right)));
  near(distance(beam.right, b.left, 'x'), 0);
  const assembly = keep(group([a, b, beam]).expose({a, b, beam}));
  near(distance(assembly.a, assembly.b), 7);
  near(distance(assembly.beam.right, assembly.b.left), 0);
});

test('straight axis references use solved direction, ignoring position and reversal', () => {
  const a = keep(point());
  const b = keep(point([3, 4, 0]));
  const axis = keep(
    line([1, 0, 0]).relate(() => [rotate(0, 0, 90), offset(100, 200, 300)]),
  );
  near(distance(a, b, axis), 4);
  near(distance(a, b, axis.reverse()), 4);
  const body = keep(cylinder(2, 4).relate(() => rotate(0, 0, 90)));
  near(distance(a, b, body.axis), 3);
  const exposed = keep(
    group([body]).expose({axis: body.axis}).rotate(0, 0, 90),
  );
  near(distance(a, b, exposed.axis), 3);
});

test('nested groups measure actual members, while axis projection spans the whole interval', () => {
  const left = keep(box(2, 2, 2).originOffset(10, 0, 0));
  const right = keep(box(2, 2, 2).originOffset(-10, 0, 0));
  const assembly = keep(group([group([left]), right]));
  const center = keep(point());
  near(distance(assembly, center), 9);
  near(distance(assembly, center, 'x'), 0);
  const exposed = keep(
    group([assembly])
      .expose({cluster: assembly})
      .rotate(0, 0, 90)
      .originOffset(0, 4, 0),
  );
  near(distance(exposed.cluster, center), 5);
  near(distance(exposed.cluster, center, 'y'), 0);
  near(distance(exposed.cluster.up, center, 'y'), 7);
  const empty = keep(group([]));
  assert.throws(() => distance(empty, center), /empty group/);
  assert.throws(() => distance(empty, center, 'x'), /empty group/);
});

test('exposed references identify occurrences and carry scaling, rotation and origin changes', () => {
  const source = keep(box(2, 4, 6));
  const a = keep(source.relate(() => offset(-10, 0, 0)));
  const b = keep(source.relate(() => offset(10, 0, 0)));
  const assembly = keep(group([a, b]).expose({a, b}));
  near(distance(assembly.a, assembly.b), 18);
  near(distance(assembly.a.center, assembly.b.center), 20);
  const transformed = keep(assembly.rotate(0, 0, 90).originOffset(3, 7, 9));
  near(distance(transformed.a, transformed.b, 'y'), 18);
  near(distance(transformed.a.center, transformed.b.center), 20);
  const face = keep(rectangle(4, 6));
  const expanded = keep(
    face
      .expose({rim: face.edge(1)})
      .scaled(2)
      .rotate(0, 30, 0),
  );
  near(distance(expanded.rim, expanded), 0);
  near(distance(source.left, source.right), 2);
});

test('distance caches complete geometry queries without retaining temporary native handles', () => {
  const a = keep(sphere(3));
  const b = keep(sphere(2).originOffset(-10, 0, 0));
  near(distance(a, b), 5);
  near(distance(a, b, 'x'), 5);
  const before = kernelOperationCacheStats();
  for (let i = 0; i < 20; i++) {
    near(distance(a, b), 5);
    near(distance(a, b, 'x'), 5);
  }
  const after = kernelOperationCacheStats();
  assert.ok(after.hits >= before.hits + 60);
  assert.ok(after.nativeAllocatedBytes - before.nativeAllocatedBytes < 4096);
});

test('uncached measurements release their native solvers and transformed inputs', () => {
  const a = keep(sphere(3).rotate(10, 20, 30));
  const b = keep(sphere(2).originOffset(-10, 0, 0));
  for (let i = 0; i < 3; i++) {
    near(distance(a, b), 5);
    clearKernelOperationCache();
  }
  const before = kernelOperationCacheStats().nativeAllocatedBytes;
  for (let i = 0; i < 30; i++) {
    near(distance(a, b), 5);
    clearKernelOperationCache();
  }
  assert.ok(
    kernelOperationCacheStats().nativeAllocatedBytes - before < 16 * 1024,
  );
  near(distance(a.center, b.center), 10);
});

test('measurement traces preserve exact witnesses on cache hits and stop with evaluation lifetime', () => {
  const a = keep(line([0, 0, 0], [1, 0, 0])),
    b = keep(point([4, 3, 0]));
  const snapshots: DistanceSnapshot[] = [];
  const finish = beginModelEvaluation(undefined, snapshot =>
    snapshots.push(snapshot),
  );
  try {
    near(distance(a, b), Math.sqrt(18));
    near(distance(a, b), Math.sqrt(18));
    near(distance(a, b, 'x'), 3);
    near(distance(a, b, 'z'), 0);
  } finally {
    finish();
  }
  assert.equal(snapshots.length, 4);
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(snapshots[0].start, [1, 0, 0]);
  assert.deepEqual(snapshots[0].end, [4, 3, 0]);
  for (const snapshot of snapshots)
    near(
      Math.hypot(...snapshot.start.map((v, i) => v - snapshot.end[i])),
      snapshot.value,
    );
  assert.deepEqual(snapshots[2].axis, [1, 0, 0]);
  distance(a, b);
  assert.equal(snapshots.length, 4);
});

test('contained and touching geometry produce zero-length witness segments', () => {
  const solid = keep(sphere(2)),
    inside = keep(point()),
    touching = keep(point([2, 0, 0]));
  const snapshots: DistanceSnapshot[] = [];
  const finish = beginModelEvaluation(undefined, snapshot =>
    snapshots.push(snapshot),
  );
  try {
    distance(solid, inside);
    distance(solid, touching);
  } finally {
    finish();
  }
  for (const snapshot of snapshots) {
    near(snapshot.value, 0);
    near(
      Math.hypot(...snapshot.start.map((value, i) => value - snapshot.end[i])),
      0,
    );
  }
});

test('axial point-to-bound dimensions start at the point inside the shared projection', () => {
  const body = keep(box(8, 30, 32));
  const corner = keep(point([-4, -15, -16]));
  const snapshots: DistanceSnapshot[] = [];
  const finish = beginModelEvaluation(undefined, snapshot =>
    snapshots.push(snapshot),
  );
  try {
    distance(corner, body.right, 'x');
    distance(corner, body.up, 'y');
    distance(corner, body.front, 'z');
    distance(body.front, corner, 'z');
    distance(corner, body.front, [0, 0, -5]);
    distance(corner, body.front);
  } finally {
    finish();
  }
  const ends = [
    [4, -15, -16],
    [-4, 15, -16],
    [-4, -15, 16],
  ];
  for (const [index, snapshot] of snapshots.entries()) {
    const reversed = index === 3;
    const start = reversed ? snapshot.end : snapshot.start;
    const end = reversed ? snapshot.start : snapshot.end;
    start.forEach((value, i) => near(value, [-4, -15, -16][i]));
    end.forEach((value, i) => near(value, ends[Math.min(index, 2)][i]));
    near(snapshot.value, [8, 30, 32][Math.min(index, 2)]);
  }
});
