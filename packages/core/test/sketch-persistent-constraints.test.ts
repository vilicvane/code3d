import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  sketch,
  type SketchConstraint,
  type SketchEntry,
} from '../bld/node/index.js';
import {
  snapshotSketch,
  solveSketchSnapshot,
  sketchCurveTangencyPoint,
  type SketchSnapshot,
} from '../bld/tooling/index.js';

const snapshot = (
  entries: readonly SketchEntry[],
  constraints: readonly SketchConstraint[],
) => snapshotSketch(sketch(entries, {constraints}), () => 'local');
const point = (s: SketchSnapshot, id: number) => {
  const entity = s.entities.find(e => e.id === id)!;
  assert.equal(entity.kind, 'point');
  return entity.position;
};
const radius = (s: SketchSnapshot, id: number) => {
  const entity = s.entities.find(e => e.id === id)!;
  assert.ok(entity.kind === 'circle' || entity.kind === 'arc');
  return entity.radius;
};
const close = (a: number, b: number, scale = 1) =>
  assert.ok(Math.abs(a - b) <= scale * 1e-7, `${a} != ${b}`);
const distance = (s: SketchSnapshot, a: number, b: number) =>
  Math.hypot(point(s, a)[0] - point(s, b)[0], point(s, a)[1] - point(s, b)[1]);
const replay = (
  s: SketchSnapshot,
  entries: readonly SketchEntry[],
  constraints: readonly SketchConstraint[],
) =>
  snapshot(
    entries.map(e =>
      e[0] === 'point' && Array.isArray(e[2])
        ? ['point', e[1], point(s, e[1])]
        : e[0] === 'circle' || e[0] === 'aux:circle'
          ? [e[0], e[1], [e[2][0], radius(s, e[1])]]
          : e[0] === 'arc' || e[0] === 'aux:arc'
            ? [
                e[0],
                e[1],
                [e[2][0], radius(s, e[1]), e[2][2], e[2][3], e[2][4]],
              ]
            : e,
    ),
    constraints,
  );

test('equal lengths survive dimension changes, dragging, and source replay', () => {
  const entries: readonly SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['point', 2, [10, 0]],
    ['point', 3, [0, 5]],
    ['point', 4, [7, 5]],
    ['line', 10, [1, 2]],
    ['aux:line', 11, [3, 4]],
  ];
  for (const length of [10, 25]) {
    const constraints: readonly SketchConstraint[] = [
      ['fixed', 1],
      ['fixed', 3],
      ['horizontal', 10],
      ['horizontal', 11],
      ['length', 10, length],
      ['equalLength', [10, 11]],
    ];
    const solved = snapshot(entries, constraints);
    close(distance(solved, 1, 2), length);
    close(distance(solved, 3, 4), length);
    assert.equal(solved.degreesOfFreedom, 0);
    const dragged = solveSketchSnapshot([solved], {id: 4, position: [99, 99]});
    close(distance(dragged, 3, 4), length);
    assert.deepEqual(
      replay(dragged, entries, constraints).entities,
      dragged.entities,
    );
  }
});

test('equal radii connect circles and directed arcs without fixing their common radius', () => {
  const entries: readonly SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['circle', 10, [1, 5]],
    ['point', 2, [20, 0]],
    ['point', 3, [24, 0]],
    ['point', 4, [20, 4]],
    ['arc', 11, [2, 4, 3, 4, 'ccw']],
  ];
  const constraints: readonly SketchConstraint[] = [
    ['fixed', 1],
    ['fixed', 2],
    ['equalRadius', [10, 11]],
  ];
  const solved = snapshot(entries, constraints);
  close(radius(solved, 10), radius(solved, 11));
  assert.equal(solved.degreesOfFreedom, 3);
  const dragged = solveSketchSnapshot([solved], {id: 10, position: [9, 0]});
  close(radius(dragged, 10), 9);
  close(radius(dragged, 11), 9);
  const again = replay(dragged, entries, constraints);
  close(radius(again, 11), 9);
});

test('pointOn is a persistent finite segment relation, including aliases and boundary clamping', () => {
  const entries: readonly SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['point', 2, [10, 0]],
    ['line', 10, [1, 2]],
    ['point', 3, [5, 3]],
    ['point', 4, 3],
  ];
  const constraints: readonly SketchConstraint[] = [
    ['fixed', 1],
    ['fixed', 2],
    ['pointOn', [4, 10]],
  ];
  const solved = snapshot(entries, constraints);
  close(point(solved, 3)[1], 0);
  assert.equal(solved.degreesOfFreedom, 1);
  const moved = solveSketchSnapshot([solved], {id: 3, position: [20, 5]});
  close(point(moved, 3)[0], 10);
  close(point(moved, 3)[1], 0);
  assert.deepEqual(point(moved, 4), point(moved, 3));
  assert.deepEqual(moved.constraints, solved.constraints);
  assert.deepEqual(
    replay(moved, entries, constraints).entities,
    moved.entities,
  );
  assert.throws(
    () => snapshot(entries, [...constraints, ['x', 3, 20]]),
    /constraint/i,
  );
});

test('pointOn restricts circular incidence to the directed finite arc', () => {
  const entries: readonly SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['point', 2, [10, 0]],
    ['point', 3, [0, 10]],
    ['arc', 10, [1, 10, 2, 3, 'ccw']],
    ['point', 4, [6, 6]],
  ];
  const constraints: readonly SketchConstraint[] = [
    ['fixed', 1],
    ['fixed', 2],
    ['fixed', 3],
    ['pointOn', [4, 10]],
  ];
  const solved = snapshot(entries, constraints);
  close(distance(solved, 1, 4), 10);
  const moved = solveSketchSnapshot([solved], {id: 4, position: [-10, 0]});
  close(point(moved, 4)[0], 0);
  close(point(moved, 4)[1], 10);
  assert.throws(
    () =>
      snapshot(
        [...entries.slice(0, -1), ['point', 4, [-10, 0]]],
        [...constraints, ['fixed', 4]],
      ),
    /constraint/i,
  );
});

test('line-circle tangency solves a finite contact and persists while changing radius', () => {
  for (const value of [2, 5]) {
    const entries: readonly SketchEntry[] = [
      ['point', 1, [-10, 0]],
      ['point', 2, [10, 0]],
      ['line', 10, [1, 2]],
      ['point', 3, [0, 3]],
      ['circle', 11, [3, 3]],
    ];
    const constraints: readonly SketchConstraint[] = [
      ['fixed', 1],
      ['fixed', 2],
      ['radius', 11, value],
      ['x', 3, 0],
      ['tangent', [10, 11]],
    ];
    const solved = snapshot(entries, constraints);
    close(Math.abs(point(solved, 3)[1]), value);
    assert.equal(solved.entities.length, entries.length);
    assert.equal(solved.degreesOfFreedom, 0);
    assert.deepEqual(solved.constraints.at(-1), ['tangent', [10, 11]]);
    const dragged = solveSketchSnapshot([solved], {id: 3, position: [20, 20]});
    close(Math.abs(point(dragged, 3)[1]), value);
    assert.deepEqual(
      replay(dragged, entries, constraints).entities,
      dragged.entities,
    );
  }
});

test('circular tangent modes retain their external and internal branches', () => {
  for (const mode of ['external', 'internal'] as const)
    for (const reverse of [false, true]) {
      const entries: readonly SketchEntry[] = [
        ['point', 1, [0, 0]],
        ['point', 2, [mode === 'external' ? 8 : 4, 0]],
        ['circle', 10, [1, 5]],
        ['circle', 11, [2, 2]],
      ];
      const constraints: readonly SketchConstraint[] = [
        ['fixed', 1],
        ['y', 2, 0],
        ['radius', 10, 5],
        ['radius', 11, 2],
        ['tangent', reverse ? [11, 10] : [10, 11], mode],
      ];
      const solved = snapshot(entries, constraints);
      close(distance(solved, 1, 2), mode === 'external' ? 7 : 3);
      assert.equal(solved.degreesOfFreedom, 0);
      assert.equal(solved.entities.length, entries.length);
      const moved = solveSketchSnapshot([solved], {id: 2, position: [20, 20]});
      close(distance(moved, 1, 2), mode === 'external' ? 7 : 3);
      assert.deepEqual(
        replay(moved, entries, constraints).entities,
        moved.entities,
      );
    }
});

test('tangent contact outside a fixed segment or arc fails instead of accepting supporting curves', () => {
  const entries: readonly SketchEntry[] = [
    ['point', 1, [2, 0]],
    ['point', 2, [10, 0]],
    ['line', 10, [1, 2]],
    ['point', 3, [0, 2]],
    ['circle', 11, [3, 2]],
  ];
  assert.throws(
    () =>
      snapshot(entries, [
        ['fixed', 1],
        ['fixed', 2],
        ['fixed', 3],
        ['radius', 11, 2],
        ['tangent', [10, 11]],
      ]),
    /constraint/i,
  );
  assert.equal(
    sketchCurveTangencyPoint(
      {
        kind: 'line',
        points: [
          [2, 0],
          [10, 0],
        ],
      },
      {kind: 'circle', center: [0, 2], radius: 2},
    ),
    undefined,
  );
  assert.deepEqual(
    sketchCurveTangencyPoint(
      {
        kind: 'line',
        points: [
          [0, 0],
          [10, 0],
        ],
      },
      {kind: 'circle', center: [0, 2], radius: 2},
    ),
    [0, 0],
  );
  assert.equal(
    sketchCurveTangencyPoint(
      {kind: 'circle', center: [0, 0], radius: 5},
      {kind: 'arc', center: [7, 0], radius: 2, start: 0, sweep: Math.PI / 2},
    ),
    undefined,
  );
});

test('persistent relation validation rejects incompatible, repeated and missing entities', () => {
  const entries: readonly SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['point', 2, [10, 0]],
    ['line', 10, [1, 2]],
    ['circle', 11, [1, 2]],
    ['line', 12, [2, 1]],
  ];
  for (const c of [
    ['equalLength', [10, 11]],
    ['equalRadius', [10, 11]],
    ['equalRadius', [11, 11]],
    ['tangent', [10, 12]],
    ['tangent', [10, 11], 'external'],
    ['tangent', [11, 999]],
    ['pointOn', [99, 10]],
    ['pointOn', [1, 999]],
  ])
    assert.throws(
      () => snapshot(entries, [c as unknown as SketchConstraint]),
      /Sketch/,
    );
});

test('tangent initialization separates free concentric centers and respects explicit radius ordering', () => {
  const entries: readonly SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['point', 2, [0, 0]],
    ['circle', 10, [1, 10]],
    ['circle', 11, [2, 5]],
  ];
  for (const axis of ['x', 'y'] as const) {
    const constraints: readonly SketchConstraint[] = [
      ['fixed', 1],
      [axis, 2, 0],
      ['radius', 10, 4],
      ['radius', 11, 8],
      ['tangent', [10, 11]],
    ];
    const solved = snapshot(entries, constraints);
    close(distance(solved, 1, 2), 12);
    close(point(solved, 2)[axis === 'x' ? 0 : 1], 0);
    assert.equal(solved.degreesOfFreedom, 0);
  }
  const internal = snapshot(entries, [
    ['fixed', 1],
    ['y', 2, 0],
    ['radius', 10, 4],
    ['radius', 11, 8],
    ['tangent', [10, 11], 'internal'],
  ]);
  close(distance(internal, 1, 2), 4);
  close(radius(internal, 10), 4);
  close(radius(internal, 11), 8);
  assert.throws(
    () =>
      snapshot(entries, [
        ['fixed', 1],
        ['fixed', 2],
        ['radius', 10, 4],
        ['radius', 11, 8],
        ['tangent', [10, 11]],
      ]),
    /constraint/i,
  );
  assert.throws(
    () =>
      snapshot(entries, [
        ['radius', 10, 4],
        ['radius', 11, 4],
        ['tangent', [10, 11], 'internal'],
      ]),
    /constraint/i,
  );
});

test('finite line-arc and arc-arc tangency accepts fully locked contact and rejects opposite arc branches', () => {
  for (const direction of ['cw', 'ccw'] as const) {
    const entries: readonly SketchEntry[] = [
      ['point', 1, [-10, 0]],
      ['point', 2, [10, 0]],
      ['line', 10, [1, 2]],
      ['point', 3, [0, 2]],
      ['point', 4, [2, 2]],
      ['point', 5, [-2, 2]],
      [
        'arc',
        11,
        [
          3,
          2,
          direction === 'cw' ? 4 : 5,
          direction === 'cw' ? 5 : 4,
          direction,
        ],
      ],
    ];
    const constraints: readonly SketchConstraint[] = [
      ...[1, 2, 3, 4, 5].map((id): SketchConstraint => ['fixed', id]),
      ['tangent', [10, 11]],
    ];
    const solved = snapshot(entries, constraints);
    assert.equal(solved.degreesOfFreedom, 0);
    assert.equal(solved.entities.length, entries.length);
    const moved = solveSketchSnapshot([solved], {id: 4, position: [20, 20]});
    assert.deepEqual(moved.entities, solved.entities);
    const opposite = entries.map(e =>
      e[0] === 'arc'
        ? ([
            e[0],
            e[1],
            [
              e[2][0],
              e[2][1],
              e[2][2],
              e[2][3],
              direction === 'cw' ? 'ccw' : 'cw',
            ],
          ] as SketchEntry)
        : e,
    );
    assert.throws(
      () => snapshot(opposite, constraints),
      (error: unknown) => {
        assert.ok(error instanceof Error && 'constraints' in error);
        const indices = error.constraints as number[];
        assert.ok(indices.length > 0);
        assert.ok(
          indices.every(index => index >= 0 && index < constraints.length),
        );
        assert.ok(indices.includes(5));
        return true;
      },
    );
  }
  const arcs: readonly SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['point', 2, [0, -5]],
    ['point', 3, [0, 5]],
    ['arc', 10, [1, 5, 2, 3, 'ccw']],
    ['point', 4, [7, 0]],
    ['point', 5, [7, 2]],
    ['point', 6, [7, -2]],
    ['arc', 11, [4, 2, 5, 6, 'ccw']],
  ];
  const constraints: readonly SketchConstraint[] = [
    ...[1, 2, 3, 4, 5, 6].map((id): SketchConstraint => ['fixed', id]),
    ['tangent', [10, 11]],
  ];
  const solved = snapshot(arcs, constraints);
  assert.equal(solved.degreesOfFreedom, 0);
  const dragged = solveSketchSnapshot([solved], {id: 11, position: [20, 20]});
  close(radius(dragged, 11), 2);
  assert.deepEqual(dragged.entities, solved.entities);
});

test('pointOn preserves upstream point identity and equal-radius geometry across feature scales', () => {
  const base = sketch([['point', 1, [3, 4]]]);
  const child = base.derive(
    [
      ['point', 1, [0, 0]],
      ['circle', 2, [1, 4]],
    ],
    {
      constraints: [
        ['fixed', 1],
        ['pointOn', [base.point(1), 2]],
      ],
    },
  );
  const identity = (s: unknown) => (s === base ? 'base' : 'local');
  const upstream = snapshotSketch(base, identity),
    local = snapshotSketch(child, identity);
  close(radius(local, 2), 5);
  assert.deepEqual(local.constraints[1], [
    'pointOn',
    [{layer: 'base', id: 1}, 2],
  ]);
  const dragged = solveSketchSnapshot([upstream, local], {
    id: 2,
    position: [10, 10],
  });
  close(radius(dragged, 2), 5);
  assert.deepEqual(point(upstream, 1), [3, 4]);
  for (const scale of [1e-5, 1, 1e5]) {
    const entries: readonly SketchEntry[] = [
      ['point', 1, [0, 0]],
      ['point', 2, [scale * 8, 0]],
      ['circle', 10, [1, scale * 4]],
      ['circle', 11, [2, scale * 3]],
    ];
    const solved = snapshot(entries, [
      ['fixed', 1],
      ['y', 2, 0],
      ['radius', 10, scale * 5],
      ['equalRadius', [10, 11]],
      ['tangent', [10, 11]],
    ]);
    close(radius(solved, 11), scale * 5, scale);
    close(distance(solved, 1, 2), scale * 10, scale);
  }
});

test('line-circle tangency resolves a center initially on the supporting line without introducing locks', () => {
  for (const vertical of [false, true]) {
    const entries: readonly SketchEntry[] = [
      ['point', 1, vertical ? [0, -10] : [-10, 0]],
      ['point', 2, vertical ? [0, 10] : [10, 0]],
      ['line', 10, [1, 2]],
      ['point', 3, [0, 0]],
      ['circle', 11, [3, 2]],
    ];
    for (const reverse of [false, true]) {
      const constraints: readonly SketchConstraint[] = [
        ['fixed', 1],
        ['fixed', 2],
        ['radius', 11, 2],
        [vertical ? 'y' : 'x', 3, 0],
        ['tangent', reverse ? [11, 10] : [10, 11]],
      ];
      const solved = snapshot(entries, constraints);
      close(Math.abs(point(solved, 3)[vertical ? 0 : 1]), 2);
      close(point(solved, 3)[vertical ? 1 : 0], 0);
      assert.equal(solved.degreesOfFreedom, 0);
      assert.deepEqual(
        replay(solved, entries, constraints).entities,
        solved.entities,
      );
    }
    const movableLine = snapshot(entries, [
      ['fixed', 3],
      ['radius', 11, 2],
      [vertical ? 'vertical' : 'horizontal', 10],
      ['length', 10, 20],
      ['tangent', [10, 11]],
    ]);
    close(Math.abs(point(movableLine, 1)[vertical ? 0 : 1]), 2);
    close(Math.abs(point(movableLine, 2)[vertical ? 0 : 1]), 2);
    assert.equal(movableLine.degreesOfFreedom, 1);
    const rotatingLine = snapshot(entries, [
      ['fixed', 1],
      ['fixed', 3],
      ['radius', 11, 2],
      ['length', 10, 20],
      ['tangent', [10, 11]],
    ]);
    assert.equal(rotatingLine.degreesOfFreedom, 0);
    assert.ok(
      sketchCurveTangencyPoint(
        {
          kind: 'line',
          points: [point(rotatingLine, 1), point(rotatingLine, 2)],
        },
        {
          kind: 'circle',
          center: point(rotatingLine, 3),
          radius: radius(rotatingLine, 11),
        },
      ),
    );
    assert.throws(
      () =>
        snapshot(entries, [
          ['fixed', 1],
          ['fixed', 2],
          ['fixed', 3],
          ['radius', 11, 2],
          ['tangent', [10, 11]],
        ]),
      /constraint/i,
    );
  }
});

test('tangency is an authored relation during motion and releases when removed', () => {
  const entries: readonly SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['point', 2, [7, 0]],
    ['circle', 10, [1, 5]],
    ['circle', 11, [2, 2]],
  ];
  const dimensions: readonly SketchConstraint[] = [
    ['fixed', 1],
    ['radius', 10, 5],
    ['radius', 11, 2],
  ];
  const initial = snapshot(entries, dimensions);
  const free = solveSketchSnapshot([initial], {id: 2, position: [0, 10]});
  assert.deepEqual(point(free, 2), [0, 10]);
  assert.deepEqual(free.constraints, initial.constraints);

  const constrained = snapshot(entries, [...dimensions, ['tangent', [10, 11]]]);
  const moved = solveSketchSnapshot([constrained], {id: 2, position: [0, 10]});
  close(distance(moved, 1, 2), 7);
  close(point(moved, 2)[0], 0);
  close(point(moved, 2)[1], 7);
  assert.deepEqual(moved.constraints, constrained.constraints);

  const removed: SketchSnapshot = {
    ...constrained,
    constraints: constrained.constraints.filter(([kind]) => kind !== 'tangent'),
  };
  const released = solveSketchSnapshot([removed], {
    id: 2,
    position: [0, 10],
    reference: removed,
  });
  assert.deepEqual(point(released, 2), [0, 10]);
  assert.deepEqual(released.constraints, removed.constraints);
});

test('line tangency reuses an authored point-on endpoint through radius recalculation at every scale', () => {
  for (const scale of [1e-8, 1, 1e8])
    for (const reverse of [false, true]) {
      const entries: readonly SketchEntry[] = [
        ['point', 1, [0, 0]],
        ['circle', 2, [1, 10 * scale]],
        ['point', 3, [20 * scale, 0]],
        ['point', 4, [5 * scale, Math.sqrt(75) * scale]],
        ['point', 6, 4],
        ['line', 5, [3, 6]],
      ];
      const constraints: readonly SketchConstraint[] = [
        ['fixed', 1],
        ['fixed', 3],
        ['radius', 2, 12 * scale],
        ['pointOn', [4, 2]],
        ['tangent', reverse ? [2, 5] : [5, 2]],
      ];
      const solved = snapshot(entries, constraints);
      close(point(solved, 4)[0], 7.2 * scale, scale);
      close(point(solved, 4)[1], 9.6 * scale, scale);
      close(distance(solved, 1, 4), 12 * scale, scale);
      assert.equal(solved.degreesOfFreedom, 0);
      assert.equal(solved.entities.length, entries.length);
      assert.deepEqual(point(solved, 6), point(solved, 4));
      assert.deepEqual(
        replay(solved, entries, constraints).entities,
        solved.entities,
      );
    }
});

test('line-arc tangency reuses the structural endpoint without an extra pointOn constraint', () => {
  for (const reverse of [false, true]) {
    const entries: readonly SketchEntry[] = [
      ['point', 1, [0, 0]],
      ['arc', 2, [1, 10, 4, 6, 'ccw']],
      ['point', 3, [20, 0]],
      ['point', 4, [5, Math.sqrt(75)]],
      ['line', 5, [3, 4]],
      ['point', 6, [-10, 0]],
    ];
    const constraints: readonly SketchConstraint[] = [
      ['fixed', 1],
      ['fixed', 3],
      ['radius', 2, 12],
      ['y', 6, 0],
      ['tangent', reverse ? [2, 5] : [5, 2]],
    ];
    const solved = snapshot(entries, constraints);
    close(point(solved, 4)[0], 7.2);
    close(point(solved, 4)[1], 9.6);
    close(point(solved, 6)[0], -12);
    assert.equal(solved.degreesOfFreedom, 0);
    assert.deepEqual(
      replay(solved, entries, constraints).entities,
      solved.entities,
    );
  }
});

test('a fixed shared tangent contact rejects a nonperpendicular radius with author diagnostics', () => {
  for (const arc of [false, true]) {
    const entries: readonly SketchEntry[] = [
      ['point', 1, [0, 0]],
      arc ? ['arc', 2, [1, 10, 4, 6, 'ccw']] : ['circle', 2, [1, 10]],
      ['point', 3, [20, 0]],
      ['point', 4, [0, 10]],
      ['line', 5, [3, 4]],
      ['point', 6, [-10, 0]],
    ];
    const constraints: readonly SketchConstraint[] = [
      ['fixed', 1],
      ['fixed', 3],
      ['fixed', 4],
      ['radius', 2, 10],
      ...(arc ? [] : ([['pointOn', [4, 2]]] as const)),
      ['tangent', [5, 2]],
    ];
    assert.throws(
      () => snapshot(entries, constraints),
      (error: unknown) => {
        assert.ok(error instanceof Error && 'constraints' in error);
        const indices = error.constraints as number[];
        assert.ok(indices.length > 0);
        assert.ok(
          indices.every(index => index >= 0 && index < constraints.length),
        );
        assert.ok(indices.includes(constraints.length - 1));
        return true;
      },
    );
  }
});

test('finite contacts release an earlier endpoint when a coupled segment needs its interior', () => {
  for (const reverse of [false, true])
    for (const initial of [-1, 1, 12]) {
      const entries: readonly SketchEntry[] = [
        ['point', 1, [0, 0]],
        ['point', 2, [10, 0]],
        ['point', 3, [1, 1]],
        ['point', 4, [9, 1]],
        ['point', 5, [initial, 0]],
        ['point', 6, [initial, 1]],
        ['line', 10, [1, 2]],
        ['line', 11, [3, 4]],
        ['line', 12, [5, 6]],
      ];
      const contacts: SketchConstraint[] = [
        ['pointOn', [5, 10]],
        ['pointOn', [6, 11]],
      ];
      const constraints: SketchConstraint[] = [
        ...[1, 2, 3, 4].map((id): SketchConstraint => ['fixed', id]),
        ['vertical', 12],
        ...(reverse ? contacts.reverse() : contacts),
      ];
      const solved = snapshot(entries, constraints);
      const x = initial < 1 ? 1 : initial > 9 ? 9 : initial;
      close(point(solved, 5)[0], x);
      close(point(solved, 6)[0], x);
      assert.equal(solved.degreesOfFreedom, 1);
      assert.deepEqual(solved.redundant, []);
      const moved = solveSketchSnapshot([solved], {id: 5, position: [5, 0]});
      close(point(moved, 5)[0], 5);
      close(point(moved, 6)[0], 5);
      assert.deepEqual(
        replay(moved, entries, constraints).entities,
        moved.entities,
      );
    }
});

test('explicit coincident endpoints share the tangent contact without becoming point aliases', () => {
  const entries: readonly SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['circle', 2, [1, 10]],
    ['point', 3, [20, 0]],
    ['point', 4, [5, Math.sqrt(75)]],
    ['point', 6, [5, Math.sqrt(75)]],
    ['line', 5, [3, 6]],
  ];
  const constraints: SketchConstraint[] = [
    ['fixed', 1],
    ['fixed', 3],
    ['radius', 2, 12],
    ['pointOn', [4, 2]],
    ['coincident', [4, 6]],
    ['tangent', [5, 2]],
  ];
  const solved = snapshot(entries, constraints);
  for (const id of [4, 6]) {
    assert.ok(Math.abs(point(solved, id)[0] - 7.2) < 1e-9);
    assert.ok(Math.abs(point(solved, id)[1] - 9.6) < 1e-9);
  }
  assert.deepEqual(
    solved.constraints,
    constraints.map(c =>
      c[0] === 'fixed'
        ? [c[0], {layer: 'local', id: c[1]}]
        : c[0] === 'pointOn'
          ? [c[0], [{layer: 'local', id: c[1][0]}, c[1][1]]]
          : c[0] === 'coincident'
            ? [c[0], c[1].map(id => ({layer: 'local', id}))]
            : c,
    ),
  );
  assert.equal(solved.entities.length, entries.length);
});

test('two arcs reuse their shared endpoint as the external tangent contact after a radius edit', () => {
  const entries: readonly SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['point', 2, [8, 0]],
    ['point', 3, [5, 0]],
    ['point', 4, [0, 5]],
    ['point', 5, [8, -3]],
    ['arc', 10, [1, 5, 3, 4, 'ccw']],
    ['arc', 11, [2, 3, 5, 3, 'cw']],
  ];
  const constraints: SketchConstraint[] = [
    ['fixed', 1],
    ['y', 2, 0],
    ['x', 4, 0],
    ['radius', 10, 6],
    ['radius', 11, 3],
    ['tangent', [10, 11]],
  ];
  const solved = snapshot(entries, constraints);
  assert.ok(Math.abs(point(solved, 3)[0] - 6) < 1e-9);
  assert.ok(Math.abs(point(solved, 3)[1]) < 1e-9);
  close(point(solved, 2)[0], 9);
  assert.equal(solved.entities.length, entries.length);
  assert.deepEqual(
    replay(solved, entries, constraints).entities,
    solved.entities,
  );
});

test('finite arcs choose the other endpoint when the nearest one contradicts an authored coordinate', () => {
  for (const clockwise of [false, true])
    for (const reverse of [false, true]) {
      const sign = clockwise ? -1 : 1;
      const entries: readonly SketchEntry[] = [
        ['point', 1, [0, 0]],
        ['point', 2, [1, 0]],
        ['point', 3, [0, sign]],
        ['point', 4, [0, -sign]],
        [
          'arc',
          10,
          [
            1,
            1,
            reverse ? 3 : 2,
            reverse ? 2 : 3,
            clockwise !== reverse ? 'cw' : 'ccw',
          ],
        ],
      ];
      const constraints: SketchConstraint[] = [
        ['fixed', 1],
        ['fixed', 2],
        ['fixed', 3],
        ['x', 4, 0],
        ['pointOn', [4, 10]],
      ];
      const solved = snapshot(entries, constraints);
      assert.deepEqual(point(solved, 4), [0, sign]);
      assert.equal(solved.degreesOfFreedom, 0);
      assert.deepEqual(
        replay(solved, entries, constraints).entities,
        solved.entities,
      );
    }
});

test('circular authored contacts retain internal and external tangency in either curve order', () => {
  for (const mode of ['internal', 'external'] as const)
    for (const reverse of [false, true]) {
      const entries: readonly SketchEntry[] = [
        ['point', 1, [0, 0]],
        ['circle', 10, [1, 10]],
        ['point', 2, [mode === 'internal' ? 6 : 14, 0]],
        ['circle', 11, [2, 4]],
        ['point', 3, [10, 0]],
      ];
      const constraints: SketchConstraint[] = [
        ['fixed', 1],
        ['y', 2, 0],
        ['radius', 10, 12],
        ['radius', 11, 3],
        ['pointOn', [3, 10]],
        ['pointOn', [3, 11]],
        ['tangent', reverse ? [11, 10] : [10, 11], mode],
      ];
      const solved = snapshot(entries, constraints);
      assert.ok(Math.abs(point(solved, 3)[0] - 12) < 1e-9);
      assert.ok(Math.abs(point(solved, 3)[1]) < 1e-9);
      close(point(solved, 2)[0], mode === 'internal' ? 9 : 15);
      assert.equal(solved.degreesOfFreedom, 0);
      assert.deepEqual(
        replay(solved, entries, constraints).entities,
        solved.entities,
      );
    }
});
