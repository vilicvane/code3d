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
  sketchDragRequiresSolver,
  type SketchSnapshot,
} from '../bld/tooling/index.js';
import {
  lineParameter,
  pointLineDistance,
  sketchIncidences,
} from '../bld/library/sketch-incidence.js';

const make = (
  entries: readonly SketchEntry[],
  constraints: readonly SketchConstraint[] = [],
) => snapshotSketch(sketch(entries, {constraints}), () => 's');
const point = (snapshot: SketchSnapshot, id: number) => {
  const e = snapshot.entities.find(e => e.id === id)!;
  assert.equal(e.kind, 'point');
  return e.position;
};
const base: readonly SketchEntry[] = [
  ['point', 1, [0, 0]],
  ['point', 2, [20, 0]],
  ['line', 3, [1, 2]],
  ['point', 4, [10, 0]],
];
const online = (s: SketchSnapshot, p = 4, a = 1, b = 2) => {
  assert.ok(pointLineDistance(point(s, p), point(s, a), point(s, b)) < 1e-7);
  const t = lineParameter(point(s, p), point(s, a), point(s, b));
  assert.ok(t >= -1e-8 && t <= 1 + 1e-8, String(t));
};

test('a point on a fixed finite line slides without leaving it or changing IDs/constraints', () => {
  const initial = make(base, [
    ['fixed', 1],
    ['fixed', 2],
  ]);
  for (const [x, expected] of [
    [7, 7],
    [30, 20],
    [-10, 0],
  ]) {
    const moved = solveSketchSnapshot([initial], {id: 4, position: [x, 8]});
    online(moved);
    assert.deepEqual(point(moved, 4), [expected, 0]);
    assert.deepEqual(point(moved, 1), [0, 0]);
    assert.deepEqual(point(moved, 2), [20, 0]);
    assert.deepEqual(moved.constraints, initial.constraints);
    assert.equal(moved.degreesOfFreedom, initial.degreesOfFreedom);
  }
});

test('moving a line endpoint retains interior points, while an interior point can move its free line', () => {
  const initial = make(base);
  assert.equal(sketchDragRequiresSolver([initial]), true);
  for (const id of [2, 4]) {
    const moved = solveSketchSnapshot([initial], {id, position: [15, 8]});
    online(moved);
    assert.deepEqual(point(moved, id), [15, 8]);
    assert.equal(moved.entities.filter(e => e.kind === 'line').length, 1);
  }
});

test('T-junction motion retains the line incidence together with the connected line constraints', () => {
  const initial = make(
    [...base, ['point', 5, [10, 10]], ['line', 6, [4, 5]]],
    [
      ['horizontal', 3],
      ['vertical', 6],
      ['length', 6, 10],
    ],
  );
  let previous = initial;
  for (let frame = 1; frame <= 10; frame++) {
    previous = solveSketchSnapshot([previous], {
      id: 5,
      position: [10 + frame, 10 + frame],
      reference: initial,
    });
    online(previous);
    assert.ok(Math.abs(point(previous, 4)[0] - point(previous, 5)[0]) < 1e-7);
    assert.ok(
      Math.abs(point(previous, 5)[1] - point(previous, 4)[1] - 10) < 1e-7,
    );
  }
});

test('local points and aliases can slide on a read-only upstream line', () => {
  const parent = sketch(base.slice(0, 3));
  const child = parent.derive([
    ['point', 1, [10, 0]],
    ['point', 2, 1],
  ]);
  const layers = [parent, child].map(value =>
    snapshotSketch(value, v => (v === parent ? 'base' : 'local')),
  );
  const moved = solveSketchSnapshot(layers, {id: 2, position: [7, 9]});
  assert.deepEqual(point(moved, 1), [7, 0]);
  assert.deepEqual(point(moved, 2), [7, 0]);
  assert.deepEqual(point(layers[0], 1), [0, 0]);
});

test('incidence detection ignores extensions and near misses, deduplicates reverse lines and is scale independent', () => {
  for (const scale of [1e-8, 1, 1e8]) {
    const p = [
      [0, 0],
      [20, 0],
      [10, 0],
      [30, 0],
      [10, 0.001],
    ].map(v => v.map(n => n * scale) as [number, number]);
    assert.deepEqual(
      sketchIncidences({
        points: p,
        circles: [],
        arcs: [],
        lines: [
          [0, 1],
          [1, 0],
        ],
      }),
      [{point: 2, kind: 'line', index: 0}],
    );
    const initial = make(
      [
        ['point', 1, p[0]],
        ['point', 2, p[1]],
        ['line', 3, [1, 2]],
        ['point', 4, p[2]],
      ],
      [
        ['fixed', 1],
        ['fixed', 2],
      ],
    );
    const moved = solveSketchSnapshot([initial], {
      id: 4,
      position: [7 * scale, 3 * scale],
    });
    assert.deepEqual(point(moved, 4), [7 * scale, 0]);
  }
});

test('incidence uses gesture-start geometry and preserves real coordinate locks', () => {
  const initial = make(base);
  const moved = solveSketchSnapshot([initial], {
    id: 4,
    position: [12, 8],
    locks: [{id: 4, parameter: 1, value: 0}],
  });
  online(moved);
  assert.deepEqual(point(moved, 4), [12, 0]);
  const away = make([...base.slice(0, 3), ['point', 4, [10, 5]]]);
  const crossing = solveSketchSnapshot([away], {
    id: 4,
    position: [10, 0],
    reference: away,
  });
  const end = solveSketchSnapshot([crossing], {
    id: 4,
    position: [10, -5],
    reference: away,
  });
  assert.deepEqual(point(end, 4), [10, -5]);
});

test('finite endpoint bounds release on the next frame and multiple coincident line relations remain consistent', () => {
  const initial = make(
    [
      ...base,
      ['line', 5, [2, 1]],
      ['point', 6, [10, -10]],
      ['point', 7, [10, 10]],
      ['line', 8, [6, 7]],
    ],
    [
      ['fixed', 1],
      ['fixed', 2],
      ['fixed', 6],
      ['fixed', 7],
    ],
  );
  // P lies at the intersection of two fixed lines; a reverse duplicate adds
  // neither a different branch nor an artificial solver conflict.
  const stationary = solveSketchSnapshot([initial], {id: 4, position: [15, 8]});
  assert.deepEqual(point(stationary, 4), [10, 0]);
  const slider = make(base, [
    ['fixed', 1],
    ['fixed', 2],
  ]);
  const end = solveSketchSnapshot([slider], {id: 4, position: [30, 8]});
  assert.deepEqual(point(end, 4), [20, 0]);
  const back = solveSketchSnapshot([end], {
    id: 4,
    position: [7, 8],
    reference: slider,
  });
  assert.deepEqual(point(back, 4), [7, 0]);
});

test('AST locks cannot erase a displayed incidence before the drag rule sees it', () => {
  const initial = make(base, [
    ['fixed', 1],
    ['fixed', 2],
  ]);
  const original = structuredClone(initial);
  assert.throws(
    () =>
      solveSketchSnapshot([initial], {
        id: 4,
        position: [12, 5],
        locks: [{id: 4, parameter: 1, value: 5}],
      }),
    /constraint/i,
  );
  assert.deepEqual(initial, original);
});
