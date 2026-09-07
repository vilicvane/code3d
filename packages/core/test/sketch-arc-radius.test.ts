import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sketch} from '../bld/node/index.js';
import {
  snapshotSketch,
  sketchDefinition,
  solveSketchSnapshot,
  SketchConstraintError,
} from '../bld/tooling/index.js';
import type {SketchEntry, SketchSnapshot} from '../bld/tooling/index.js';

const data = (radius = 15): SketchEntry[] => [
  ['point', 1, [0, 0]],
  ['point', 2, [10, 0]],
  ['point', 3, [0, 10]],
  ['arc', 4, [1, radius, 2, 3, 'cw']],
];
const snapshot = (entries: readonly SketchEntry[] = data()) =>
  snapshotSketch(sketch(entries), () => 'local');
const point = (view: SketchSnapshot, id: number) =>
  view.entities.filter(e => e.kind === 'point').find(e => e.id === id)!;
const arc = (view: SketchSnapshot, id = 4) =>
  view.entities.filter(e => e.kind === 'arc').find(e => e.id === id)!;
const near = (a: number, b: number, tolerance = 1e-7) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const geometry = (view: SketchSnapshot) => {
  for (const a of view.entities.filter(e => e.kind === 'arc')) {
    const c = point(view, a.center.id).position;
    for (const ref of a.points) {
      const p = point(view, ref.id).position;
      near(Math.hypot(p[0] - c[0], p[1] - c[1]), a.radius);
    }
  }
};

test('explicit arc radius seeds radial endpoints without changing authored data, IDs, direction or DOF', () => {
  const input = data(),
    original = structuredClone(input);
  const value = sketch(input),
    view = snapshotSketch(value, () => 'local');
  assert.deepEqual(point(view, 1).position, [0, 0]);
  assert.deepEqual(point(view, 2).position, [15, 0]);
  assert.deepEqual(point(view, 3).position, [0, 15]);
  assert.equal(arc(view).radius, 15);
  assert.equal(arc(view).direction, 'cw');
  assert.equal(view.degreesOfFreedom, 5);
  assert.deepEqual(view.constraints, []);
  assert.deepEqual(sketchDefinition(value).entries, original);
  assert.deepEqual(input, original);
  geometry(view);
  const reordered = snapshot([...input].reverse());
  for (const id of [1, 2, 3])
    point(view, id).position.forEach((v, axis) =>
      near(v, point(reordered, id).position[axis]),
    );
});

test('fixed endpoints and explicit dimensions override radius initial data without creating a radius constraint', () => {
  const fixed = snapshotSketch(
    sketch(data(), {
      constraints: [
        ['fixed', 1],
        ['fixed', 2],
        ['fixed', 3],
      ],
    }),
    () => 'local',
  );
  near(arc(fixed).radius, 10);
  assert.equal(fixed.degreesOfFreedom, 0);
  assert.equal(fixed.constraints.length, 3);
  geometry(fixed);
  // No unattainable mouse equation should make a known radius conflict.
  const unchanged = solveSketchSnapshot([fixed], {id: 4, position: [0, 40]});
  near(arc(unchanged).radius, 10);
  const dimensioned = snapshotSketch(
    sketch(data(), {
      constraints: [
        ['fixed', 1],
        ['radius', [4, 20]],
      ],
    }),
    () => 'local',
  );
  near(arc(dimensioned).radius, 20);
  assert.equal(dimensioned.degreesOfFreedom, 2);
  geometry(dimensioned);
  assert.throws(
    () =>
      sketch(data(), {
        constraints: [
          ['fixed', 1],
          ['fixed', 2],
          ['fixed', 3],
          ['radius', [4, 20]],
        ],
      }),
    SketchConstraintError,
  );
});

test('explicit radius seeds do not translate an unanchored arc away from already satisfied endpoint geometry', () => {
  for (const scale of [1e-6, 1, 1e6])
    for (const direction of ['cw', 'ccw'] as const) {
      const input = [
        ['point', 1, [3 * scale, -2 * scale]],
        ['point', 2, [3 * scale, 8 * scale]],
        ['point', 3, [3 * scale, -12 * scale]],
        ['arc', 4, [1, 15 * scale, 3, 2, direction]],
      ] as const satisfies readonly SketchEntry[];
      const value = sketch(input, {constraints: [['radius', [4, 10 * scale]]]});
      const view = snapshotSketch(value, () => 'local');
      for (const entry of input)
        if (entry[0] === 'point')
          point(view, entry[1]).position.forEach((v, axis) =>
            near(v / scale, entry[2][axis] / scale),
          );
      near(arc(view).radius / scale, 10);
      assert.equal(view.degreesOfFreedom, 4);
      assert.deepEqual(sketchDefinition(value).entries, input);
      assert.throws(
        () =>
          sketch(input, {
            constraints: [
              ['radius', [4, 10 * scale]],
              ['radius', [4, 12 * scale]],
            ],
          }),
        SketchConstraintError,
      );
      assert.throws(
        () =>
          solveSketchSnapshot([view], {
            id: 4,
            position: [20 * scale, 0],
            locks: [{id: 4, parameter: 0, value: 15 * scale}],
          }),
        SketchConstraintError,
      );
    }
});

test('shared endpoints use simultaneous initial proposals and remain one point across connected arcs and lines', () => {
  const points: SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['point', 2, [20, 0]],
    ['point', 3, [10, 0]],
    ['point', 4, [0, 10]],
    ['point', 5, [20, 10]],
    ['point', 6, [10, -20]],
  ];
  const arcs: SketchEntry[] = [
    ['arc', 7, [1, 15, 3, 4, 'ccw']],
    ['arc', 8, [2, 10, 5, 3, 'ccw']],
    ['line', 9, [3, 6]],
  ];
  const views = [arcs, [...arcs].reverse()].map(a =>
    snapshotSketch(
      sketch([...points, ...a], {
        constraints: [
          ['fixed', 1],
          ['fixed', 2],
        ],
      }),
      () => 'local',
    ),
  );
  for (const view of views) {
    geometry(view);
    assert.equal(view.entities.length, 9);
    assert.deepEqual(arc(view, 7).points[0], arc(view, 8).points[1]);
    assert.equal(view.constraints.length, 2);
  }
  for (const id of [1, 2, 3, 4, 5, 6])
    point(views[0], id).position.forEach((v, axis) =>
      near(v, point(views[1], id).position[axis]),
    );
});

test('free arc radius and endpoint drags update the same radius parameter and replay their solution', () => {
  const before = snapshot(data(10));
  for (const id of [3, 4]) {
    const moved = solveSketchSnapshot([before], {id, position: [0, 16]});
    near(arc(moved).radius, 16);
    point(moved, 1).position.forEach(v => near(v, 0));
    assert.equal(moved.degreesOfFreedom, 5);
    geometry(moved);
    const replay = solveSketchSnapshot([moved]);
    near(arc(replay).radius, 16);
    for (const id of [1, 2, 3])
      point(moved, id).position.forEach((v, axis) =>
        near(v, point(replay, id).position[axis]),
      );
  }
});

test('arc radius gesture locks preserve expression values and still allow endpoint rotation', () => {
  const before = snapshot();
  const moved = solveSketchSnapshot([before], {
    id: 3,
    position: [-9, 12],
    locks: [{id: 4, parameter: 0, value: 15}],
  });
  near(arc(moved).radius, 15);
  near(point(moved, 3).position[0], -9);
  near(point(moved, 3).position[1], 12);
  const resizedLock = solveSketchSnapshot([before], {
    id: 4,
    position: [0, 30],
    locks: [{id: 4, parameter: 0, value: 12}],
  });
  near(arc(resizedLock).radius, 12);
  point(resizedLock, 1).position.forEach(v => near(v, 0));
  geometry(resizedLock);
  const dimensioned = snapshotSketch(
    sketch(data(), {
      constraints: [
        ['fixed', 1],
        ['radius', [4, 15]],
      ],
    }),
    () => 'local',
  );
  const matching = solveSketchSnapshot([dimensioned], {
    id: 3,
    position: [-9, 12],
    locks: [{id: 4, parameter: 0, value: 15}],
  });
  near(arc(matching).radius, 15);
  geometry(matching);
  assert.throws(
    () =>
      solveSketchSnapshot([dimensioned], {
        id: 3,
        position: [-9, 12],
        locks: [{id: 4, parameter: 0, value: 12}],
      }),
    SketchConstraintError,
  );
});

test('arc initialization retains upstream points and fixed coordinate axes over model scales', () => {
  for (const scale of [1e-6, 1, 1e6]) {
    const base = sketch([['point', 1, [100 * scale, -20 * scale]]]);
    const local = base.derive([
      ['point', 1, [110 * scale, -20 * scale]],
      ['point', 2, [100 * scale, -10 * scale]],
      ['arc', 3, [base.point(1), 15 * scale, 1, 2, 'cw']],
    ]);
    const identity = (value: typeof base) =>
      value === base ? 'base' : 'local';
    const upstream = snapshotSketch(base, identity),
      view = snapshotSketch(local, identity);
    near(arc(view, 3).radius / scale, 15);
    near(point(view, 1).position[0] / scale, 115);
    near(point(view, 2).position[1] / scale, -5);
    const moved = solveSketchSnapshot([upstream, view], {
      id: 2,
      position: [91 * scale, -8 * scale],
      locks: [
        {id: 3, parameter: 0, value: 15 * scale},
        {id: 1, parameter: 1, value: -20 * scale},
      ],
    });
    near(arc(moved, 3).radius / scale, 15);
    near(point(moved, 1).position[1] / scale, -20);
    near(point(moved, 2).position[0] / scale, 91);
    assert.deepEqual(point(upstream, 1).position, [100 * scale, -20 * scale]);
  }
});

test('arc radius data must be positive and finite, and the old four-field shape is rejected', () => {
  for (const radius of [0, -1, NaN, Infinity])
    assert.throws(() => sketch(data(radius)), /positive finite radius/);
  const old = ['arc', 4, [1, 2, 3, 'cw']] as unknown as SketchEntry;
  assert.throws(
    () => sketch([...data().slice(0, 3), old]),
    /center, radius, start, end/,
  );
});
