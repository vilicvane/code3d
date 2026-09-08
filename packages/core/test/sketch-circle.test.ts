import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sketch} from '../bld/node/index.js';
import {
  snapshotSketch,
  sketchDefinition,
  solveSketchSnapshot,
  SketchConstraintError,
} from '../bld/tooling/index.js';
import type {
  Sketch,
  SketchCircleSnapshot,
  SketchSnapshot,
} from '../bld/tooling/index.js';

const identities = new Map<Sketch, string>();
const snapshot = (value: Sketch) =>
  snapshotSketch(value, sketch => {
    let id = identities.get(sketch);
    if (!id) identities.set(sketch, (id = `layer:${identities.size}`));
    return id;
  });
const circle = (value: SketchSnapshot, id = 2) =>
  value.entities.find(e => e.id === id) as SketchCircleSnapshot;
const near = (actual: number, expected: number) =>
  assert.ok(
    Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-8,
    `${actual} != ${expected}`,
  );

test('circles are native current geometry with one radius freedom and stable point references', () => {
  const value = sketch([
    ['circle', 2, [1, 10]],
    ['point', 1, [7, 8]],
  ]);
  const view = snapshot(value);
  assert.deepEqual(circle(view), {
    kind: 'circle',
    id: 2,
    center: {layer: view.id, id: 1},
    radius: 10,
  });
  assert.equal(view.degreesOfFreedom, 3);
  assert.equal(value.point(1).id, 1);
  assert.throws(() => value.point(2), /Unknown local sketch point/);
  const child = value.derive([['circle', 1, [value.point(1), 5]]]);
  const derived = snapshot(child);
  assert.equal(derived.degreesOfFreedom, 1);
  assert.deepEqual(circle(derived, 1).center, {layer: view.id, id: 1});
  assert.equal(circle(view).radius, 10);
});

test('radius constraints solve the current value without changing the authored seed or center', () => {
  const value = sketch(
    [
      ['point', 1, [20, 30]],
      ['circle', 2, [1, 15]],
    ],
    {constraints: [['radius', 2, 8]]},
  );
  const view = snapshot(value);
  near(circle(view).radius, 8);
  assert.deepEqual(view.entities[0], {
    kind: 'point',
    id: 1,
    position: [20, 30],
  });
  assert.deepEqual(sketchDefinition(value).entries[1], ['circle', 2, [1, 15]]);
  assert.equal(view.degreesOfFreedom, 2);
  const moved = solveSketchSnapshot([view], {id: 2, position: [40, 30]});
  near(circle(moved).radius, 8);
});

test('circle center and radius dragging share the solver and numeric expression locks', () => {
  for (const constrained of [false, true]) {
    const value = sketch(
      [
        ['point', 1, [0, 0]],
        ['circle', 2, [1, 10]],
      ],
      {constraints: constrained ? [['fixed', 1]] : []},
    );
    const view = snapshot(value);
    const resized = solveSketchSnapshot([view], {id: 2, position: [0, 16]});
    near(circle(resized).radius, 16);
    assert.deepEqual(resized.entities[0], view.entities[0]);
    const locked = solveSketchSnapshot([view], {
      id: 2,
      position: [20, 0],
      locks: [{id: 2, parameter: 0, value: 7}],
    });
    near(circle(locked).radius, 7);
    near(circle(solveSketchSnapshot([view])).radius, 10);
    const moved = solveSketchSnapshot([view], {id: 1, position: [3, 4]});
    near(circle(moved).radius, 10);
    assert.deepEqual(moved.entities[0], {
      kind: 'point',
      id: 1,
      position: constrained ? [0, 0] : [3, 4],
    });
  }
});

test('radius normalization covers translated tiny and large circles and retains upstream radii', () => {
  for (const size of [1e-6, 1, 1e6]) {
    const base = sketch(
      [
        ['point', 1, [100 * size, -20 * size]],
        ['circle', 2, [1, size]],
      ],
      {constraints: [['radius', 2, size * 2]]},
    );
    const child = base.derive([['circle', 2, [base.point(1), size * 3]]], {
      constraints: [['radius', 2, size * 4]],
    });
    const upstream = snapshot(base),
      local = snapshot(child);
    const result = solveSketchSnapshot([upstream, local]);
    near(circle(result).radius / size, 4);
    near(circle(upstream).radius / size, 2);
    assert.equal(result.degreesOfFreedom, 0);
  }
});

test('matching constant equations do not conflict with a mouse goal on another fixed axis', () => {
  for (const constraints of [
    [['fixed', 1]],
    [
      ['x', 1, 3],
      ['y', 1, 4],
    ],
  ] as const) {
    const view = snapshot(
      sketch(
        [
          ['point', 1, [3, 4]],
          ['circle', 2, [1, 5]],
        ],
        {constraints},
      ),
    );
    const result = solveSketchSnapshot([view], {
      id: 1,
      position: [20, 30],
      locks: [{id: 1, parameter: 0, value: 3}],
    });
    assert.deepEqual(result.entities[0], view.entities[0]);
    near(circle(result).radius, 5);
    assert.throws(
      () =>
        solveSketchSnapshot([view], {
          id: 1,
          position: [20, 30],
          locks: [{id: 1, parameter: 0, value: 9}],
        }),
      SketchConstraintError,
    );
  }
  const view = snapshot(
    sketch(
      [
        ['point', 1, [3, 4]],
        ['circle', 2, [1, 5]],
      ],
      {constraints: [['radius', 2, 5]]},
    ),
  );
  const result = solveSketchSnapshot([view], {
    id: 1,
    position: [20, 30],
    locks: [{id: 2, parameter: 0, value: 5}],
  });
  near(circle(result).radius, 5);
  assert.deepEqual(result.entities[0], {
    kind: 'point',
    id: 1,
    position: [20, 30],
  });
});

test('radius conflicts and invalid circles remain located hard failures', () => {
  const entries = [
    ['point', 1, [0, 0]],
    ['circle', 2, [1, 10]],
  ] as const;
  assert.throws(
    () =>
      sketch(entries, {
        constraints: [
          ['radius', 2, 10],
          ['radius', 2, 11],
        ],
      }),
    SketchConstraintError,
  );
  const redundant = snapshot(
    sketch(entries, {
      constraints: [
        ['radius', 2, 10],
        ['radius', 2, 10],
      ],
    }),
  );
  near(circle(redundant).radius, 10);
  for (const radius of [0, -1, NaN, Infinity])
    assert.throws(
      () =>
        sketch([
          ['point', 1, [0, 0]],
          ['circle', 2, [1, radius]],
        ]),
      /positive finite radius/,
    );
  assert.throws(() => sketch([['circle', 2, [1, 10]]]), /missing local point/);
  assert.throws(
    () => sketch(entries, {constraints: [['radius', 1, 10]]}),
    /missing local circular curve/,
  );
  const view = snapshot(sketch(entries, {constraints: [['radius', 2, 10]]}));
  assert.throws(
    () =>
      solveSketchSnapshot([view], {
        id: 2,
        position: [20, 0],
        locks: [{id: 2, parameter: 0, value: 9}],
      }),
    SketchConstraintError,
  );
});
