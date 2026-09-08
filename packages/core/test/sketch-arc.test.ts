import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sketch} from '../bld/node/index.js';
import {
  snapshotSketch,
  sketchDefinition,
  solveSketchSnapshot,
  sketchArcGeometry,
  sketchCurveClosestParameter,
  sketchCurvePosition,
  sketchCurveBounds,
  SketchConstraintError,
} from '../bld/tooling/index.js';
import type {
  Sketch,
  SketchEntry,
  SketchSnapshot,
  SketchPosition,
} from '../bld/tooling/index.js';

const identities = new Map<Sketch, string>();
const snapshot = (value: Sketch) =>
  snapshotSketch(value, s => {
    if (!identities.has(s)) identities.set(s, `layer:${identities.size}`);
    return identities.get(s)!;
  });
const position = (view: SketchSnapshot, id: number) =>
  view.entities.filter(e => e.kind === 'point').find(e => e.id === id)!
    .position;
const near = (a: number, b: number, tolerance = 1e-7) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const entries = (direction: 'cw' | 'ccw' = 'ccw'): SketchEntry[] => [
  ['arc', 4, [1, 10, 2, 3, direction]],
  ['point', 1, [0, 0]],
  ['point', 2, [10, 0]],
  ['point', 3, [0, 10]],
];

test('arcs retain point identity and explicit direction, with five geometric freedoms', () => {
  for (const direction of ['cw', 'ccw'] as const) {
    const value = sketch(entries(direction)),
      view = snapshot(value);
    assert.deepEqual(view.entities[0], {
      kind: 'arc',
      id: 4,
      center: {layer: view.id, id: 1},
      radius: 10,
      points: [
        {layer: view.id, id: 2},
        {layer: view.id, id: 3},
      ],
      direction,
    });
    assert.equal(view.degreesOfFreedom, 5);
    near(position(view, 2)[0], 10);
    near(position(view, 3)[1], 10);
    assert.deepEqual(sketchDefinition(value).entries, entries(direction));
  }
});

test('intrinsic arc equations solve unequal initial radii without turning current data into fixed constraints', () => {
  const data = entries();
  data[3] = ['point', 3, [0, 8]];
  const value = sketch(data),
    view = snapshot(value),
    center = position(view, 1);
  const radii = [2, 3].map(id =>
    Math.hypot(...position(view, id).map((v, axis) => v - center[axis])),
  );
  near(radii[0], radii[1]);
  assert.equal(view.degreesOfFreedom, 5);
  assert.deepEqual(sketchDefinition(value).entries[3], data[3]);
});

test('arc endpoint dragging crosses 180 degrees and zero without flipping or changing source direction', () => {
  for (const direction of ['cw', 'ccw'] as const) {
    let view = snapshot(
      sketch(entries(direction), {
        constraints: [
          ['fixed', 1],
          ['radius', 4, 10],
        ],
      }),
    );
    for (let step = 1; step < 360; step++) {
      const angle =
        ((90 + step * (direction === 'ccw' ? 1 : -1)) * Math.PI) / 180;
      // The identical start/end location denotes neither a zero arc nor a full circle.
      if (Math.abs(Math.sin(angle)) < 1e-10 && Math.cos(angle) > 0) continue;
      const target: SketchPosition = [
        10 * Math.cos(angle),
        10 * Math.sin(angle),
      ];
      view = solveSketchSnapshot([view], {id: 3, position: target});
      target.forEach((v, axis) => near(position(view, 3)[axis], v, 1e-5));
      const replay = solveSketchSnapshot([view]);
      target.forEach((v, axis) => near(position(replay, 3)[axis], v, 1e-5));
      assert.equal(
        view.entities[0].kind === 'arc' && view.entities[0].direction,
        direction,
      );
    }
  }
});

test('arc radius constraints respect locked upstream centers and coordinate locks at different scales', () => {
  for (const size of [1e-6, 1, 1e6]) {
    const base = sketch([['point', 1, [100 * size, -20 * size]]]);
    const derived = base.derive(
      [
        ['point', 1, [110 * size, -20 * size]],
        ['point', 2, [100 * size, -10 * size]],
        ['arc', 3, [base.point(1), 10 * size, 1, 2, 'cw']],
      ],
      {constraints: [['radius', 3, 10 * size]]},
    );
    const upstream = snapshot(base),
      local = snapshot(derived);
    assert.equal(local.degreesOfFreedom, 2);
    const moved = solveSketchSnapshot([upstream, local], {
      id: 2,
      position: [94 * size, -12 * size],
      locks: [{id: 1, parameter: 0, value: 110 * size}],
    });
    near(position(moved, 1)[0] / size, 110);
    near(position(moved, 2)[0] / size, 94, 1e-5);
    near(position(moved, 2)[1] / size, -12, 1e-5);
    assert.deepEqual(position(upstream, 1), [100 * size, -20 * size]);
  }
});

test('invalid references, collapsed arcs and conflicting radii are hard errors', () => {
  assert.throws(
    () => sketch([['arc', 4, [1, 10, 2, 3, 'ccw']]]),
    /missing local point/,
  );
  for (const data of [
    [1, 10, 1, 3, 'ccw'],
    [1, 10, 2, 2, 'cw'],
  ] as const)
    assert.throws(
      () => sketch([...entries().slice(1), ['arc', 4, data]]),
      /nonzero radius and distinct endpoints/,
    );
  assert.throws(
    () =>
      sketch(entries(), {
        constraints: [
          ['radius', 4, 10],
          ['radius', 4, 11],
        ],
      }),
    SketchConstraintError,
  );
});

test('analytic arcs preserve major/minor direction, finite hit testing and extremum bounds', () => {
  for (const direction of ['cw', 'ccw'] as const) {
    const curve = sketchArcGeometry([0, 0], [10, 0], [0, 10], direction);
    near(curve.sweep, direction === 'ccw' ? Math.PI / 2 : (-3 * Math.PI) / 2);
    const mid = sketchCurvePosition(curve, 0.5);
    near(sketchCurveClosestParameter(curve, mid), 0.5);
    const bounds = sketchCurveBounds(curve);
    near(Math.min(...bounds.map(p => p[0])), direction === 'ccw' ? 0 : -10);
    near(Math.min(...bounds.map(p => p[1])), direction === 'ccw' ? 0 : -10);
  }
  const small = sketchArcGeometry([0, 0], [10, 0], [0, 10], 'ccw');
  near(sketchCurveClosestParameter(small, [-10, 0]), 1);
  near(sketchCurveClosestParameter(small, [0, -10]), 0);
});
