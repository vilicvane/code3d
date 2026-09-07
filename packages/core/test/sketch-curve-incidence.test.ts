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
  sketchCurveGeometry,
  sketchCurvePosition,
} from '../bld/library/sketch-curves.js';
import {isPointOnSketchCurve} from '../bld/library/sketch-incidence.js';

const make = (
  entries: readonly SketchEntry[],
  constraints: readonly SketchConstraint[] = [],
) => snapshotSketch(sketch(entries, {constraints}), () => 's');
const point = (s: SketchSnapshot, id: number) => {
  const p = s.entities.find(e => e.kind === 'point' && e.id === id)!;
  assert.equal(p.kind, 'point');
  return p.position;
};
const near = (a: readonly number[], b: readonly number[], tolerance = 1e-7) =>
  a.forEach((v, i) =>
    assert.ok(Math.abs(v - b[i]) <= tolerance, a + ' != ' + b),
  );
const curve = (s: SketchSnapshot, id: number) =>
  sketchCurveGeometry(
    s.entities.find(e => e.id === id)!,
    ref => point(s, ref.id),
  )!;
const online = (s: SketchSnapshot, p: number, c: number) =>
  assert.ok(
    isPointOnSketchCurve(point(s, p), curve(s, c)),
    JSON.stringify(s.entities),
  );
const circle: readonly SketchEntry[] = [
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 10]],
  ['point', 3, [10, 0]],
];
const arc: readonly SketchEntry[] = [
  ['point', 1, [0, 0]],
  ['point', 2, [10, 0]],
  ['point', 3, [0, 10]],
  ['arc', 4, [1, 10, 2, 3, 'ccw']],
  ['point', 5, [6, 8]],
];

test('a point slides on a fixed circle through half turns and a full turn without changing source topology', () => {
  const initial = make(circle, [
    ['fixed', 1],
    ['radius', [2, 10]],
  ]);
  assert.equal(sketchDragRequiresSolver([initial]), true);
  let moved = initial;
  for (const position of [
    [-20, 0],
    [0, -20],
    [20, 0],
    [0, 20],
    [0, 0],
  ] as const) {
    const previous = point(moved, 3);
    moved = solveSketchSnapshot([moved], {id: 3, position, reference: initial});
    online(moved, 3, 2);
    near(
      point(moved, 3),
      position.every(v => v === 0) ? previous : position.map(v => v / 2),
    );
    near(point(moved, 1), [0, 0]);
    assert.deepEqual(moved.constraints, initial.constraints);
    assert.equal(moved.degreesOfFreedom, initial.degreesOfFreedom);
  }
});

test('free circle center translation and radius resizing carry its contacting points', () => {
  const initial = make(circle);
  const translated = solveSketchSnapshot([initial], {id: 1, position: [5, 6]});
  near(point(translated, 3), [15, 6]);
  assert.equal(curve(translated, 2).kind, 'circle');
  online(translated, 3, 2);
  const resized = solveSketchSnapshot([initial], {id: 2, position: [0, 15]});
  near(point(resized, 1), [0, 0]);
  near(point(resized, 3), [15, 0]);
  online(resized, 3, 2);
});

test('free arc center and radius gestures preserve the polar pose of additional points', () => {
  const initial = make(arc);
  const translated = solveSketchSnapshot([initial], {id: 1, position: [5, 6]});
  for (const id of [1, 2, 3, 5])
    near(
      point(translated, id),
      point(initial, id).map((v, i) => v + [5, 6][i]),
    );
  online(translated, 5, 4);
  const resized = solveSketchSnapshot([initial], {id: 4, position: [0, 20]});
  near(point(resized, 1), [0, 0]);
  near(point(resized, 5), [12, 16]);
  online(resized, 5, 4);
});

test('fixed finite arcs clamp to endpoints and release bounds on later frames for both directions', () => {
  for (const direction of ['cw', 'ccw'] as const) {
    const initial = make(
      [
        ...arc.slice(0, 3),
        ['arc', 4, [1, 10, 2, 3, direction]],
        ['point', 5, direction === 'cw' ? [-10, 0] : [6, 8]],
      ],
      [
        ['fixed', 1],
        ['fixed', 2],
        ['fixed', 3],
      ],
    );
    let moved = initial;
    const geometry = curve(initial, 4);
    for (const t of [0.1, 0.8, 1.1, 0.6, -0.1, 0.3]) {
      const target = sketchCurvePosition(geometry, t);
      moved = solveSketchSnapshot([moved], {
        id: 5,
        position: target,
        reference: initial,
      });
      online(moved, 5, 4);
      near(
        point(moved, 5),
        sketchCurvePosition(geometry, Math.max(0, Math.min(1, t))),
      );
      for (const id of [1, 2, 3]) near(point(moved, id), point(initial, id));
    }
  }
});

test('moving an arc endpoint retains additional points within the resulting finite arc', () => {
  const initial = make(arc, [
    ['fixed', 1],
    ['fixed', 2],
    ['radius', [4, 10]],
  ]);
  const end = [Math.sqrt(75), 5] as const;
  const moved = solveSketchSnapshot([initial], {id: 3, position: end});
  near(point(moved, 3), end);
  near(point(moved, 5), end);
  online(moved, 5, 4);
});

test('points in an arc gap or merely passing a circle do not gain a connection', () => {
  const initial = make(
    [...arc.slice(0, 4), ['point', 5, [-10, 0]]],
    [
      ['fixed', 1],
      ['fixed', 2],
      ['fixed', 3],
    ],
  );
  const moved = solveSketchSnapshot([initial], {id: 5, position: [-12, 5]});
  near(point(moved, 5), [-12, 5]);
  const away = make([...circle.slice(0, 2), ['point', 3, [15, 0]]]);
  const crossing = solveSketchSnapshot([away], {
    id: 3,
    position: [10, 0],
    reference: away,
  });
  const end = solveSketchSnapshot([crossing], {
    id: 3,
    position: [5, 0],
    reference: away,
  });
  near(point(end, 3), [5, 0]);
});

test('upstream circles and finite arcs guide a local alias without sharing layer IDs', () => {
  for (const entries of [circle.slice(0, 2), arc.slice(0, 4)]) {
    const base = sketch(entries);
    const local = base.derive([
      ['point', 1, [6, 8]],
      ['point', 2, 1],
    ]);
    const layers = [base, local].map(value =>
      snapshotSketch(value, v => (v === base ? 'base' : 'local')),
    );
    const original = structuredClone(layers[0]);
    const moved = solveSketchSnapshot(layers, {id: 2, position: [0, 15]});
    near(point(moved, 1), [0, 10]);
    near(point(moved, 2), [0, 10]);
    assert.deepEqual(layers[0], original);
    if (entries.some(e => e[0] === 'arc')) {
      const bounded = solveSketchSnapshot(layers, {id: 2, position: [-4, 12]});
      assert.deepEqual(point(bounded, 1), [0, 10]);
      assert.deepEqual(point(bounded, 2), [0, 10]);
    }
  }
});

test('circle incidence detection and solving scale with geometry and respect coordinate locks', () => {
  for (const scale of [1e-8, 1, 1e8]) {
    const initial = make(
      [
        ['point', 1, [0, 0]],
        ['circle', 2, [1, 10 * scale]],
        ['point', 3, [10 * scale, 0]],
      ],
      [
        ['fixed', 1],
        ['radius', [2, 10 * scale]],
      ],
    );
    const moved = solveSketchSnapshot([initial], {
      id: 3,
      position: [0, 20 * scale],
    });
    near(point(moved, 3), [0, 10 * scale], 1e-7 * scale);
    online(moved, 3, 2);
    const locked = solveSketchSnapshot([initial], {
      id: 3,
      position: [5 * scale, 5 * scale],
      locks: [{id: 3, parameter: 1, value: 0}],
    });
    near(point(locked, 3), [10 * scale, 0], 1e-7 * scale);
  }
});

test('a constrained line attached to a circle follows it continuously without losing either relation', () => {
  const initial = make(
    [...circle, ['point', 4, [20, 0]], ['line', 5, [3, 4]]],
    [
      ['fixed', 1],
      ['radius', [2, 10]],
      ['horizontal', 5],
      ['length', [5, 10]],
    ],
  );
  let moved = initial;
  for (let frame = 1; frame <= 48; frame++) {
    const angle = (frame * Math.PI) / 24;
    const position = [10 + 10 * Math.cos(angle), 10 * Math.sin(angle)] as const;
    moved = solveSketchSnapshot([moved], {id: 4, position, reference: initial});
    near(point(moved, 4), position);
    online(moved, 3, 2);
    near(point(moved, 3), [position[0] - 10, position[1]]);
  }
});

test('duplicate circular geometry remains redundant and genuine expression conflicts reject atomically', () => {
  const initial = make(
    [...circle, ['circle', 4, [1, 10]]],
    [
      ['fixed', 1],
      ['radius', [2, 10]],
      ['radius', [4, 10]],
    ],
  );
  const moved = solveSketchSnapshot([initial], {id: 3, position: [0, 20]});
  near(point(moved, 3), [0, 10]);
  online(moved, 3, 2);
  online(moved, 3, 4);
  const original = structuredClone(initial);
  assert.throws(
    () =>
      solveSketchSnapshot([initial], {
        id: 3,
        position: [20, 0],
        locks: [
          {id: 3, parameter: 0, value: 20},
          {id: 3, parameter: 1, value: 0},
        ],
      }),
    /constraint/i,
  );
  assert.deepEqual(initial, original);
});

test('upstream arc IDs do not capture local radius constraints or result indices', () => {
  const base = sketch(arc.slice(0, 4));
  for (const curved of [false, true]) {
    const local = base.derive(
      curved
        ? [
            ['point', 1, [30, 0]],
            ['point', 2, [35, 0]],
            ['point', 3, [30, 5]],
            ['arc', 4, [1, 5, 2, 3, 'ccw']],
            ['point', 5, [33, 4]],
          ]
        : [
            ['point', 1, [30, 0]],
            ['circle', 4, [1, 5]],
            ['point', 5, [33, 4]],
          ],
      {
        constraints: [
          ['fixed', 1],
          ['radius', [4, 5]],
        ],
      },
    );
    const layers = [base, local].map(value =>
      snapshotSketch(value, v => (v === base ? 'base' : 'local')),
    );
    const moved = solveSketchSnapshot(layers, {id: 5, position: [30, 10]});
    near(point(moved, 5), [30, 5]);
    online(moved, 5, 4);
    assert.equal(layers[0].entities.find(e => e.kind === 'arc')!.radius, 10);
  }
});
