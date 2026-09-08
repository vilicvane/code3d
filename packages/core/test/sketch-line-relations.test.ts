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
  type SketchSnapshot,
} from '../bld/tooling/index.js';

const entries: readonly SketchEntry[] = [
  ['point', 1, [0, 0]],
  ['point', 2, [20, 0]],
  ['line', 5, [1, 2]],
  ['point', 3, [0, 10]],
  ['point', 4, [8, 16]],
  ['line', 6, [3, 4]],
];
const snapshot = (
  data: readonly SketchEntry[],
  constraints: readonly SketchConstraint[],
) => snapshotSketch(sketch(data, {constraints}), () => 'local');
const point = (s: SketchSnapshot, id: number) => {
  const p = s.entities.find(e => e.id === id)!;
  assert.equal(p.kind, 'point');
  return p.position;
};
const direction = (s: SketchSnapshot, a: number, b: number) =>
  Math.atan2(point(s, b)[1] - point(s, a)[1], point(s, b)[0] - point(s, a)[0]);
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const angleClose = (a: number, b: number) =>
  close(Math.atan2(Math.sin(a - b), Math.cos(a - b)), 0);

test('parallel and perpendicular solve relative line directions without adding an axis lock', () => {
  for (const kind of ['parallel', 'perpendicular'] as const) {
    const source: readonly SketchConstraint[] = [
      [kind, [5, 6]],
      ['length', 5, 20],
      ['length', 6, 10],
    ];
    const s = snapshot(entries, source);
    const delta = direction(s, 3, 4) - direction(s, 1, 2);
    close(kind === 'parallel' ? Math.sin(delta) : Math.cos(delta), 0);
    assert.equal(s.degreesOfFreedom, 5);
    const moved = solveSketchSnapshot([s], {id: 2, position: [12, 20]});
    const next = direction(moved, 3, 4) - direction(moved, 1, 2);
    close(kind === 'parallel' ? Math.sin(next) : Math.cos(next), 0);
    assert.deepEqual(moved.constraints, s.constraints);
    const replay = snapshot(
      entries.map(e =>
        e[0] === 'point' ? ['point', e[1], point(moved, e[1])] : e,
      ),
      source,
    );
    for (const id of [1, 2, 3, 4])
      point(replay, id).forEach((v, i) => close(v, point(moved, id)[i]));
  }
});

test('line angle retains signed and supplementary branches for disjoint lines and reversed targets', () => {
  for (const degrees of [-135, -60, 0, 60, 120, 180, 450]) {
    const theta = (degrees * Math.PI) / 180;
    const data = entries.map(e =>
      e[0] === 'point' && e[1] === 4
        ? ([
            'point',
            4,
            [10 * Math.cos(theta + 0.02), 10 + 10 * Math.sin(theta + 0.02)],
          ] as const)
        : e,
    );
    for (const reverse of [false, true]) {
      const targets = reverse ? ([6, 5] as const) : ([5, 6] as const);
      const s = snapshot(data, [
        ['fixed', 1],
        ['fixed', 2],
        ['fixed', 3],
        ['length', 6, 10],
        ['angle', targets, reverse ? -degrees : degrees],
      ]);
      angleClose(direction(s, 3, 4), theta);
      close(point(s, 4)[0], 10 * Math.cos(theta));
      close(point(s, 4)[1], 10 + 10 * Math.sin(theta));
      assert.equal(s.degreesOfFreedom, 0);
    }
  }
});

test('line relations retain upstream point locks and detect fixed conflicts', () => {
  const base = sketch([
    ['point', 1, [0, 0]],
    ['point', 2, [20, 0]],
  ]);
  const child = base.derive(
    [
      ['line', 5, [base.point(1), base.point(2)]],
      ['point', 3, [0, 10]],
      ['point', 4, [8, 16]],
      ['line', 6, [3, 4]],
    ],
    {constraints: [['angle', [5, 6], 60]]},
  );
  const identity = (s: unknown) => (s === base ? 'base' : 'local');
  const upstream = snapshotSketch(base, identity),
    local = snapshotSketch(child, identity);
  angleClose(direction(local, 3, 4), Math.PI / 3);
  const moved = solveSketchSnapshot([upstream, local], {
    id: 4,
    position: [14, 30],
  });
  angleClose(direction(moved, 3, 4), Math.PI / 3);
  assert.deepEqual(point(upstream, 2), [20, 0]);
  assert.throws(
    () =>
      snapshot(entries, [
        ['fixed', 1],
        ['fixed', 2],
        ['fixed', 3],
        ['fixed', 4],
        ['parallel', [5, 6]],
      ]),
    /locked geometry|constraints/,
  );
});

test('line relation validation rejects wrong arity, missing, repeated and non-line references', () => {
  for (const c of [
    ['parallel', [5]],
    ['parallel', [5, 6, 5]],
    ['parallel', [5, 5]],
    ['perpendicular', [5, 4]],
    ['perpendicular', [5, 999]],
    ['angle', [5, 6], NaN],
    ['angle', [5, 5], 30],
  ])
    assert.throws(
      () => sketch(entries, {constraints: [c as unknown as SketchConstraint]}),
      /Sketch.*constraint/,
    );
  const constraints = [['parallel', [5, 6]]] as const;
  const before = structuredClone({entries, constraints});
  snapshot(entries, constraints);
  assert.deepEqual({entries, constraints}, before);
});

test('relations copied to both lines surviving a trim remain valid even when redundant', () => {
  const data: readonly SketchEntry[] = [
    ['point', 1, [0, 0]],
    ['point', 2, [40, 0]],
    ['point', 3, [0, 10]],
    ['point', 4, [40, 10]],
    ['point', 7, [10, 0]],
    ['point', 8, [30, 0]],
    ['point', 9, [10, 10]],
    ['point', 10, [30, 10]],
    ['line', 11, [1, 7]],
    ['line', 12, [8, 2]],
    ['line', 13, [3, 9]],
    ['line', 14, [10, 4]],
  ];
  const constraints = [11, 12].flatMap(a =>
    [13, 14].flatMap((b): SketchConstraint[] => [
      ['parallel', [a, b]],
      ['angle', [a, b], 0],
    ]),
  );
  const s = snapshot(data, constraints);
  assert.ok(s.redundant.length > 0);
  const moved = solveSketchSnapshot([s], {id: 2, position: [38, 5]});
  const directions = [
    [1, 7],
    [8, 2],
    [3, 9],
    [10, 4],
  ].map(([a, b]) => direction(moved, a, b));
  for (const d of directions) angleClose(d, directions[0]);
  const replay = snapshot(
    data.map(e => (e[0] === 'point' ? ['point', e[1], point(moved, e[1])] : e)),
    constraints,
  );
  for (const e of data)
    if (e[0] === 'point')
      point(replay, e[1]).forEach((v, i) => close(v, point(moved, e[1])[i]));
});
