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
import {
  createSketchDragSession,
  solveSketchDragPlan,
} from '../bld/library/sketch-drag-rules.js';
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

const connectedArc: readonly SketchEntry[] = [
  ['point', 2, [-20, -10]],
  ['point', 3, [20, -10]],
  ['point', 4, [20, 10]],
  ['point', 5, [-20, 10]],
  ['line', 6, [2, 3]],
  ['line', 7, [3, 4]],
  ['line', 9, [5, 2]],
  ['point', 10, [0, 10]],
  ['arc', 11, [10, 10, 13, 15, 'cw']],
  ['line', 12, [4, 15]],
  ['point', 13, [-10, 10]],
  ['line', 14, [13, 5]],
  ['point', 15, [10, 10]],
  ['circle', 16, [10, 2.5]],
];
const connectedConstraints: readonly SketchConstraint[] = [
  ['horizontal', 6],
  ['vertical', 7],
  ['horizontal', 12],
  ['vertical', 9],
  ['horizontal', 14],
];

test('ordered stages retain achieved soft compromises and hard locks without mutating subsequent frames', () => {
  const problem: SketchSolveProblem = {
    points: [
      {position: [0, 0], locked: [true, false]},
      {position: [10, 0], locked: [false, false]},
      {position: [-20, 0], locked: [false, false]},
    ],
    lines: [[0, 1]],
    circles: [{center: 0, radius: 3, locked: false}],
    arcs: [],
    constraints: [{kind: 'horizontal', points: [0, 1]}],
  };
  const original = structuredClone(problem);
  for (const y of [5, -3, 0]) {
    const solved = solveSketchDragPlan({
      problem,
      stages: [
        () => [{kind: 'point', point: 0, position: [50, y], weight: 1}],
        () => [],
        reached => {
          close(reached.points[0].position, [0, y]);
          return [
            {
              kind: 'point',
              point: 1,
              position: [reached.points[0].position[0] + 10, y],
              weight: 1,
            },
            {kind: 'radius', curve: 'circle', index: 0, value: 6, weight: 1},
            {kind: 'radius', curve: 'circle', index: 0, value: 10, weight: 1},
          ];
        },
        reached => {
          close([reached.circles[0].radius], [8]);
          return [
            {kind: 'point', point: 0, position: [99, 99], weight: 1},
            {kind: 'point', point: 1, position: [99, 99], weight: 1},
            {kind: 'radius', curve: 'circle', index: 0, value: 99, weight: 1},
            {kind: 'point', point: 2, position: [4, 6], weight: 1},
          ];
        },
      ],
    });
    close(solved.positions[0], [0, y]);
    close(solved.positions[1], [10, y]);
    close(solved.positions[2], [4, 6]);
    close(solved.radii, [8]);
    assert.deepEqual(problem, original);
  }
});

test('a connected arc center translates its own geometry while exterior constraints move only the top corners', () => {
  const before = snapshot(connectedArc, connectedConstraints);
  let current = before;
  for (const target of [
    [0, 15],
    [0, 7],
    [3, 12],
    [0, 10],
  ] as const) {
    current = solveSketchSnapshot([current], {
      id: 10,
      position: target,
      reference: before,
    });
    close(point(current, 10), target);
    close(point(current, 13), [target[0] - 10, target[1]]);
    close(point(current, 15), [target[0] + 10, target[1]]);
    close(point(current, 4), [20, target[1]]);
    close(point(current, 5), [-20, target[1]]);
    close(point(current, 2), [-20, -10]);
    close(point(current, 3), [20, -10]);
    assert.equal(current.entities.find(e => e.kind === 'arc')!.radius, 10);
    assert.equal(current.entities.find(e => e.kind === 'circle')!.radius, 2.5);
    assert.deepEqual(current.constraints, before.constraints);
    assert.equal(current.degreesOfFreedom, before.degreesOfFreedom);
    assert.deepEqual(solveSketchSnapshot([current]).entities, current.entities);
  }
  assert.deepEqual(current.entities, before.entities);
});

test('center translation uses the reachable mouse position and yields to fixed endpoints', () => {
  const before = snapshot(connectedArc, connectedConstraints);
  const locked = solveSketchSnapshot([before], {
    id: 10,
    position: [8, 15],
    reference: before,
    locks: [{id: 10, parameter: 0, value: 0}],
  });
  close(point(locked, 10), [0, 15]);
  close(point(locked, 13), [-10, 15]);
  close(point(locked, 15), [10, 15]);
  const fixed = snapshot(connectedArc, [
    ...connectedConstraints,
    ['fixed', 15],
  ]);
  const moved = solveSketchSnapshot([fixed], {
    id: 10,
    position: [0, 15],
    reference: fixed,
  });
  close(point(moved, 10), [0, 15]);
  close(point(moved, 15), [10, 10]);
  close(
    [moved.entities.find(e => e.kind === 'arc')!.radius],
    [Math.hypot(10, 5)],
  );
  assert.deepEqual(moved.constraints, fixed.constraints);
});

test('staged compromises clean exact coordinates before retaining them, across scales and forward solves', () => {
  for (const scale of [1e-8, 1, 1e8]) {
    const entries = connectedArc.map<SketchEntry>(([kind, id, data]) => {
      if (kind === 'point' && Array.isArray(data))
        return [
          kind,
          id,
          [data[0] * scale, (data[1] === 10 ? 5 : data[1]) * scale],
        ];
      if (kind === 'arc')
        return [
          kind,
          id,
          [data[0], data[1] * scale, data[2], data[3], data[4]],
        ];
      if (kind === 'circle') return [kind, id, [data[0], data[1] * scale]];
      return [kind, id, data] as SketchEntry;
    });
    const before = snapshot(entries, [...connectedConstraints, ['fixed', 4]]);
    let current = before;
    for (const [x, y] of [
      [0, 15],
      [-2, 7],
      [-5, 8],
      [-7.5, 10],
      [0, 5],
    ]) {
      const target = [x * scale, y * scale] as const;
      current = solveSketchSnapshot([current], {
        id: 10,
        position: target,
        reference: before,
      });
      assert.deepEqual(point(current, 10), target);
      assert.equal(point(current, 5)[1], target[1]);
      assert.equal(point(current, 13)[1], target[1]);
      assert.deepEqual(point(current, 4), [20 * scale, 5 * scale]);
      assert.equal(point(current, 15)[1], 5 * scale);
      assert.deepEqual(
        solveSketchSnapshot([current]).entities,
        current.entities,
      );
    }
  }
});

test('a connected arc center carries an on-arc point before minimizing exterior movement', () => {
  const before = snapshot(
    [
      ...connectedArc,
      ['point', 20, [0, 20]],
      ['point', 30, [0, 35]],
      ['line', 31, [20, 30]],
    ],
    [...connectedConstraints, ['vertical', 31]],
  );
  const moved = solveSketchSnapshot([before], {
    id: 10,
    position: [0, 15],
    reference: before,
  });
  close(point(moved, 20), [0, 25]);
  close(point(moved, 30), [0, 35]);
  assert.deepEqual(moved.constraints, before.constraints);
  assert.deepEqual(solveSketchSnapshot([moved]).entities, moved.entities);
});

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
      return (problem, next) => ({
        problem,
        stages: [() => [{...next, weight: 1}]],
      });
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

test('both arc endpoints prefer their center before the mouse when radius is constrained', () => {
  for (const [id, target, expected] of [
    [2, [24, -18], [8, -6]],
    [3, [-18, 24], [-6, 8]],
  ] as const) {
    for (const expression of [false, true]) {
      const before = snapshot(
        arcEntries,
        expression ? [] : [['radius', 4, 10]],
      );
      const moved = solveSketchSnapshot([before], {
        id,
        position: target,
        reference: before,
        locks: expression ? [{id: 4, parameter: 0, value: 10}] : [],
      });
      close(point(moved, 1), [0, 0]);
      close(point(moved, id), expected);
      assert.equal(moved.entities.find(e => e.kind === 'arc')!.radius, 10);
      assert.deepEqual(moved.constraints, before.constraints);
      assert.equal(moved.degreesOfFreedom, before.degreesOfFreedom);
      assert.deepEqual(solveSketchSnapshot([moved]).entities, moved.entities);
    }
  }
});

test('arc endpoint center preference permits free radius changes and reverses within a gesture', () => {
  for (const id of [2, 3]) {
    const before = snapshot(arcEntries);
    let current = before;
    for (const radius of [15, 25, 10]) {
      const target = id === 2 ? ([radius, 0] as const) : ([0, radius] as const);
      current = solveSketchSnapshot([current], {
        id,
        position: target,
        reference: before,
      });
      close(point(current, 1), [0, 0]);
      close(point(current, 2), [radius, 0]);
      close(point(current, 3), [0, radius]);
      assert.deepEqual(current.constraints, before.constraints);
      assert.equal(current.degreesOfFreedom, before.degreesOfFreedom);
      assert.deepEqual(
        solveSketchSnapshot([current]).entities,
        current.entities,
      );
    }
    assert.deepEqual(current.entities, before.entities);
  }
});

test('an arc endpoint that is another arc center preserves both roles and reachable translation', () => {
  const before = snapshot(
    [
      ...arcEntries,
      ['point', 5, [13, 0]],
      ['point', 6, [10, -3]],
      ['arc', 7, [2, 3, 5, 6, 'cw']],
    ],
    [['radius', 4, 10]],
  );
  let current = before;
  for (const [target, expected] of [
    [
      [24, -18],
      [8, -6],
    ],
    [
      [-30, 0],
      [-10, 0],
    ],
    [
      [30, 0],
      [10, 0],
    ],
  ] as const) {
    current = solveSketchSnapshot([current], {
      id: 2,
      position: target,
      reference: before,
    });
    close(point(current, 1), [0, 0]);
    close(point(current, 2), expected);
    close(point(current, 5), [expected[0] + 3, expected[1]]);
    close(point(current, 6), [expected[0], expected[1] - 3]);
    const attached = current.entities.find(e => e.id === 7)!;
    assert.equal(attached.kind, 'arc');
    assert.equal(attached.radius, 3);
    assert.deepEqual(solveSketchSnapshot([current]).entities, current.entities);
  }
});

test('arc center preference respects an immovable opposite endpoint and temporary coordinate locks', () => {
  const before = snapshot(arcEntries, [['fixed', 3]]);
  const moved = solveSketchSnapshot([before], {
    id: 2,
    position: [24, -18],
    reference: before,
  });
  close(point(moved, 1), [0, 0]);
  close(point(moved, 2), [8, -6]);
  close(point(moved, 3), [0, 10]);
  const locked = solveSketchSnapshot([snapshot(arcEntries)], {
    id: 2,
    position: [24, -18],
    locks: [{id: 1, parameter: 0, value: 2}],
  });
  close([point(locked, 1)[0]], [2]);
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
    ['length', 6, 20],
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
