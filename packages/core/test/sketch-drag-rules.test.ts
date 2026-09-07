import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  sketch,
  type SketchEntry,
  type SketchConstraint,
} from '../bld/node/index.js';
import {
  snapshotSketch,
  solveSketchSnapshot,
  type SketchSnapshot,
} from '../bld/tooling/index.js';
import {createSketchDragSession} from '../bld/library/sketch-drag-rules.js';
import {
  solveSketchProblem,
  type SketchSolveProblem,
} from '../bld/library/sketch-solver.js';

const snapshot = (
  entries: readonly SketchEntry[],
  constraints: readonly SketchConstraint[] = [],
) => snapshotSketch(sketch(entries, {constraints}), () => 'local');
const point = (s: SketchSnapshot, id: number) => {
  const entity = s.entities.find(e => e.id === id)!;
  assert.equal(entity.kind, 'point');
  return entity.position;
};
const close = (
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-6,
) =>
  actual.forEach((v, i) =>
    assert.ok(
      Math.abs(v - expected[i]) < tolerance,
      `${actual} != ${expected}`,
    ),
  );
const arcEntries: readonly SketchEntry[] = [
  ['point', 1, [0, 0]],
  ['point', 2, [10, 0]],
  ['point', 3, [0, 10]],
  ['arc', 4, [1, 10, 2, 3, 'ccw']],
];
const rectangle: readonly SketchEntry[] = [
  ['point', 1, [0, 0]],
  ['point', 2, [-10, -5]],
  ['point', 3, [10, -5]],
  ['point', 4, [10, 5]],
  ['point', 5, [-10, 5]],
  ['line', 6, [2, 3]],
  ['line', 7, [3, 4]],
  ['line', 8, [4, 5]],
  ['line', 9, [5, 2]],
];
const rectangleConstraints: readonly SketchConstraint[] = [
  ['horizontal', 6],
  ['vertical', 7],
  ['horizontal', 8],
  ['vertical', 9],
  ['midpoint', [1, 2, 4]],
];

test('rule dispatch passes the whole untouched context and stops at the first match', () => {
  const reference: SketchSolveProblem = {
    points: [
      {position: [0, 0], locked: [false, false]},
      {position: [0, 0], locked: [false, false]},
      {position: [30, 40], locked: [false, false]},
    ],
    lines: [[0, 1]],
    circles: [],
    arcs: [],
    constraints: [],
  };
  const target = {kind: 'point' as const, point: 0, position: [2, 3] as const};
  const context = {reference, target};
  const seen: number[] = [];
  const session = createSketchDragSession(context, [
    input => {
      assert.equal(input, context);
      seen.push(1);
      return undefined;
    },
    input => {
      assert.equal(input, context);
      seen.push(2);
      return (problem, next) => ({problem, objectives: [{...next, weight: 1}]});
    },
    () => {
      assert.fail('later rules must not execute');
    },
  ]);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(session(reference, target).problem, reference);
});

test('unconstrained objectives preserve locks and optimize every reference, not just the first', () => {
  const result = solveSketchProblem(
    {
      points: [
        {position: [0, 0], locked: [false, false]},
        {position: [10, 0], locked: [true, false]},
      ],
      circles: [{center: 0, radius: 5, locked: false}],
      arcs: [],
      lines: [],
      constraints: [],
    },
    [
      {kind: 'point', point: 0, position: [1, 2], weight: 1},
      {kind: 'point', point: 1, position: [20, 5], weight: 1},
      {kind: 'point', point: 1, position: [20, 10], weight: 2},
      {kind: 'radius', curve: 'circle', index: 0, value: 8, weight: 1},
    ],
  );
  assert.deepEqual(result.positions, [
    [1, 2],
    [10, 9],
  ]);
  assert.deepEqual(result.radii, [8]);
});

test('unrestricted arc, circle and rectangle centers translate their complete geometry without fixed constraints', () => {
  for (const before of [
    snapshot(arcEntries),
    snapshot([
      ['point', 1, [0, 0]],
      ['circle', 2, [1, 10]],
    ]),
    snapshot(rectangle, rectangleConstraints),
  ]) {
    let previous = before;
    for (const target of [
      [2, 3],
      [8, -4],
      [0, 0],
    ] as const) {
      const moved = solveSketchSnapshot([previous], {
        id: 1,
        position: target,
        reference: before,
      });
      for (const entity of before.entities)
        if (entity.kind === 'point')
          close(
            point(moved, entity.id),
            entity.position.map((v, axis) => v + target[axis]),
          );
      assert.deepEqual(moved.constraints, before.constraints);
      assert.equal(moved.degreesOfFreedom, before.degreesOfFreedom);
      const replay = solveSketchSnapshot([moved]);
      for (const entity of moved.entities)
        if (entity.kind === 'point')
          close(point(replay, entity.id), entity.position);
      previous = moved;
    }
  }
});

test('center translation does not override an additional fixed endpoint or coordinate lock', () => {
  const before = snapshot(arcEntries, [['fixed', 2]]);
  const moved = solveSketchSnapshot([before], {
    id: 1,
    position: [2, 3],
    reference: before,
  });
  close(point(moved, 2), [10, 0]);
  close(point(moved, 1), [2, 3]);
  const locked = solveSketchSnapshot([snapshot(arcEntries)], {
    id: 1,
    position: [2, 3],
    locks: [{id: 2, parameter: 0, value: 10}],
  });
  close([point(locked, 2)[0]], [10]);
});

test('point 13 can move in both axes while the far connected reference remains stable', () => {
  const before = snapshot(
    [
      ['point', 12, [-7.5, -7]],
      ['point', 13, [8, -7]],
      ['point', 14, [8, 0]],
      ['point', 15, [-7.5, 0]],
      ['point', 21, [-5, 0]],
      ['line', 16, [12, 13]],
      ['line', 17, [13, 14]],
      ['line', 19, [15, 12]],
      ['line', 22, [21, 15]],
    ],
    [
      ['horizontal', 16],
      ['vertical', 17],
      ['vertical', 19],
      ['horizontal', 22],
    ],
  );
  const moved = solveSketchSnapshot([before], {id: 13, position: [10, -10]});
  close(point(moved, 13), [10, -10]);
  close(point(moved, 12), [-7.5, -10]);
  close(point(moved, 14), [10, 0]);
  close(point(moved, 21), [-5, 0]);
  assert.deepEqual(moved.constraints, before.constraints);
});

test('a single soft stay and redundant horizontal constraints yield without a false model conflict or grid offset', () => {
  for (const count of [1, 2, 3]) {
    const before = snapshot(
      [
        ['point', 1, [0, 0]],
        ['point', 2, [40, 0]],
        ['line', 3, [1, 2]],
      ],
      Array.from({length: count}, () => ['horizontal', 3] as const),
    );
    const moved = solveSketchSnapshot([before], {id: 2, position: [40, 10]});
    close(point(moved, 2), [40, 10], 1e-9);
    close(point(moved, 1), [0, 10], 1e-9);
    assert.deepEqual(moved.redundant, before.redundant);
  }
});

test('dragging an arc endpoint preserves the untouched endpoint angle and uses its center as a soft reference', () => {
  const before = snapshot(arcEntries);
  const moved = solveSketchSnapshot([before], {
    id: 2,
    position: [8, -6],
    reference: before,
  });
  close(point(moved, 1), [0, 0]);
  close(point(moved, 2), [8, -6]);
  close(point(moved, 3), [0, 10]);
});

test('an unconstrained sole junction applies both arcs own center references', () => {
  const before = snapshot([
    ...arcEntries,
    ['point', 5, [20, 0]],
    ['point', 6, [20, 10]],
    ['arc', 7, [5, 10, 2, 6, 'cw']],
  ]);
  const moved = solveSketchSnapshot([before], {
    id: 2,
    position: [10, 2],
    reference: before,
  });
  close(point(moved, 1), [0, 0]);
  close(point(moved, 5), [20, 0]);
  close(point(moved, 2), [10, 2]);
  assert.equal(moved.entities.filter(e => e.id === 2).length, 1);
  for (const curve of moved.entities)
    if (curve.kind === 'arc') close([curve.radius], [Math.hypot(10, 2)]);
});

test('a shared point can translate its arc while acting as a line endpoint in another branch', () => {
  const before = snapshot([
    ...arcEntries,
    ['point', 5, [-20, 0]],
    ['line', 6, [1, 5]],
  ]);
  const moved = solveSketchSnapshot([before], {
    id: 1,
    position: [2, 3],
    reference: before,
  });
  close(point(moved, 1), [2, 3]);
  close(point(moved, 2), [12, 3]);
  close(point(moved, 3), [2, 13]);
  close(point(moved, 5), [-20, 0]);
});

test('a constrained rectangle corner prefers its center while real dimensions remain in force', () => {
  const before = snapshot(rectangle, [
    ...rectangleConstraints,
    ['length', [6, 20]],
  ]);
  const moved = solveSketchSnapshot([before], {
    id: 4,
    position: [15, 8],
    reference: before,
  });
  close(point(moved, 4), [15, 8]);
  close(point(moved, 1), [5, 0]);
  close(point(moved, 3), [15, -8]);
  assert.deepEqual(moved.constraints, before.constraints);
});
