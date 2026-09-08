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

const point = (s: SketchSnapshot, id: number) =>
  s.entities.find(e => e.kind === 'point' && e.id === id)! as Extract<
    SketchSnapshot['entities'][number],
    {kind: 'point'}
  >;
const close = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((v, axis) =>
    assert.ok(Math.abs(v - expected[axis]) < 1e-6, `${actual} != ${expected}`),
  );
const entries: SketchEntry[] = [
  ['point', 1, [0, 0]],
  ['point', 2, [40, 0]],
  ['line', 3, [1, 2]],
];
const snapshot = (
  entries: SketchEntry[],
  constraints: SketchConstraint[] = [],
) => snapshotSketch(sketch(entries, {constraints}), () => 'local');

test('unrelated points and crossings do not steal the anchor, and a contacting point stays stable', () => {
  for (const extra of [
    [['point', 9, [-20, 0]]],
    [['point', 9, [0, 0]]],
    [
      ['point', 9, [20, -20]],
      ['point', 10, [20, 20]],
      ['line', 11, [9, 10]],
    ],
  ] satisfies SketchEntry[][]) {
    const initial = snapshot([...extra, ...entries], [['length', 3, 40]]);
    const moved = solveSketchSnapshot([initial], {id: 2, position: [0, 40]});
    close(point(moved, 1).position, [0, 0]);
    close(point(moved, 2).position, [0, 40]);
    close(point(moved, 9).position, point(initial, 9).position);
    assert.equal(moved.degreesOfFreedom, initial.degreesOfFreedom);
    assert.deepEqual(moved.constraints, initial.constraints);
  }
});

test('unrelated fixed points and complete coordinate locks do not suppress a related anchor', () => {
  for (const mode of ['fixed', 'coordinates', 'locks', 'mixed'] as const) {
    const initial = snapshot(
      [['point', 9, [-20, 0]], ...entries],
      [
        ['length', 3, 40],
        ...(mode === 'fixed'
          ? ([['fixed', 9]] as const)
          : mode === 'coordinates'
            ? ([
                ['x', 9, -20],
                ['y', 9, 0],
              ] as const)
            : mode === 'mixed'
              ? ([['y', 9, 0]] as const)
              : []),
      ],
    );
    const moved = solveSketchSnapshot([initial], {
      id: 2,
      position: [0, 40],
      locks:
        mode === 'locks' || mode === 'mixed'
          ? [
              {id: 9, parameter: 0, value: -20},
              ...(mode === 'locks' ? [{id: 9, parameter: 1, value: 0}] : []),
            ]
          : [],
    });
    close(point(moved, 1).position, [0, 0]);
    close(point(moved, 2).position, [0, 40]);
    close(point(moved, 9).position, [-20, 0]);
    assert.deepEqual(moved.constraints, initial.constraints);
    assert.equal(moved.degreesOfFreedom, initial.degreesOfFreedom);
  }
});

test('only referenced upstream points count as anchors, even with matching local IDs', () => {
  const base = sketch([['point', 1, [-20, 0]]]);
  for (const connected of [false, true]) {
    const child = base.derive(
      [
        ...entries,
        ...(connected
          ? ([['line', 4, [base.point(1), 2]]] satisfies SketchEntry[])
          : []),
      ],
      {constraints: [['length', 3, 40]]},
    );
    const identity = (s: object) => (s === base ? 'base' : 'local');
    const upstream = snapshotSketch(base, identity),
      local = snapshotSketch(child, identity);
    const moved = solveSketchSnapshot([upstream, local], {
      id: 2,
      position: [60, 20],
    });
    close(point(moved, 2).position, [60, 20]);
    assert.notDeepEqual(point(moved, 1).position, point(local, 1).position);
    close(
      [
        Math.hypot(
          ...point(moved, 2).position.map(
            (v, axis) => v - point(moved, 1).position[axis],
          ),
        ),
      ],
      [40],
    );
    close(point(upstream, 1).position, [-20, 0]);
  }
});

test('shared endpoints and constraint-only connections preserve constraints while references yield', () => {
  for (const connection of ['lines', 'coincident', 'midpoint'] as const) {
    const initial = snapshot(
      [
        ['point', 99, [-10, 20]],
        ['point', 8, [0, 0]],
        ...entries,
        ...(connection === 'lines'
          ? ([
              ['point', 4, [0, -10]],
              ['line', 5, [8, 4]],
              ['line', 6, [4, 1]],
            ] satisfies SketchEntry[])
          : []),
      ],
      [
        ['horizontal', 3],
        ...(connection === 'coincident'
          ? ([['coincident', [8, 1]]] as const)
          : connection === 'midpoint'
            ? ([['midpoint', [8, 1, 2]]] as const)
            : []),
      ],
    );
    const moved = solveSketchSnapshot([initial], {id: 2, position: [60, 20]});
    close(point(moved, 99).position, point(initial, 99).position);
    close(point(moved, 2).position, [60, 20]);
    close([point(moved, 1).position[1]], [20]);
    if (connection === 'lines')
      // Point 8 also lies on line 3: its contact now follows the horizontal
      // line instead of treating its coincident starting position as unrelated.
      close([point(moved, 8).position[1]], [20]);
    else if (connection === 'coincident')
      close(point(moved, 8).position, point(moved, 1).position);
    else
      close(
        point(moved, 8).position,
        point(moved, 1).position.map(
          (v, axis) => (v + point(moved, 2).position[axis]) / 2,
        ),
      );
    assert.equal(moved.degreesOfFreedom, initial.degreesOfFreedom);
  }
});

test('arc endpoints and circle/arc radius gestures anchor within their shared geometry', () => {
  const initial = snapshot([
    ['point', 9, [-20, -20]],
    ['point', 1, [0, 0]],
    ['point', 2, [10, 0]],
    ['point', 3, [0, 10]],
    ['arc', 4, [1, 10, 2, 3, 'ccw']],
    ['circle', 5, [2, 3]],
  ]);
  for (const [id, target] of [
    [2, [8, -6]],
    [4, [20, 0]],
    [5, [15, 0]],
  ] as const) {
    const moved = solveSketchSnapshot([initial], {id, position: target});
    close(point(moved, 1).position, [0, 0]);
    close(point(moved, 9).position, [-20, -20]);
    if (id === 2) close(point(moved, 2).position, target);
    else {
      const curve = moved.entities.find(e => e.id === id)!;
      assert.ok(curve.kind === 'arc' || curve.kind === 'circle');
      close([curve.radius], [id === 4 ? 20 : 5]);
    }
    assert.equal(moved.degreesOfFreedom, initial.degreesOfFreedom);
    assert.deepEqual(moved.constraints, initial.constraints);
  }
});
