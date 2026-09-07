import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sketch} from '../bld/node/index.js';
import {
  snapshotSketch,
  solveSketchSnapshot,
  sketchEntityParameters,
  sketchPointResolver,
  type SketchSnapshot,
} from '../bld/tooling/index.js';

const point = (snapshot: SketchSnapshot, id: number) => {
  const entity = snapshot.entities.find(e => e.id === id)!;
  assert.equal(entity.kind, 'point');
  return entity;
};

test('forward and chained aliases retain IDs but allocate only one solver point', () => {
  const value = sketch(
    [
      ['point', 11, 10],
      ['point', 10, 1],
      ['point', 1, [0, 0]],
      ['point', 2, [10, 0]],
      ['line', 3, [11, 2]],
    ],
    {
      constraints: [
        ['horizontal', 3],
        ['coincident', [10, 11]],
      ],
    },
  );
  const initial = snapshotSketch(value, () => 's');
  assert.equal(initial.degreesOfFreedom, 3);
  assert.deepEqual(point(initial, 11).alias, {layer: 's', id: 10});
  assert.deepEqual(sketchEntityParameters(point(initial, 11)), []);
  const moved = solveSketchSnapshot([initial], {id: 11, position: [3, 4]});
  assert.deepEqual(point(moved, 11).position, point(moved, 1).position);
  assert.deepEqual(point(moved, 10).position, point(moved, 1).position);
  assert.deepEqual(sketchPointResolver([initial])({layer: 's', id: 11}), {
    layer: 's',
    id: 1,
  });
});

test('ancestor aliases stay read-only and can be referenced again downstream', () => {
  const base = sketch([
    ['point', 1, [2, 3]],
    ['point', 11, 1],
  ]);
  const middle = base.derive([['point', 1, base.point(11)]]);
  const end = middle.derive([
    ['point', 1, middle.point(1)],
    ['point', 2, [5, 7]],
    ['line', 3, [1, 2]],
  ]);
  const values = [base, middle, end];
  const layers = values.map(v =>
    snapshotSketch(v, s => String(values.indexOf(s))),
  );
  assert.deepEqual(sketchPointResolver(layers)({layer: '2', id: 1}), {
    layer: '0',
    id: 1,
  });
  assert.equal(layers[1].degreesOfFreedom, 0);
  const moved = solveSketchSnapshot(layers, {id: 1, position: [99, 99]});
  assert.deepEqual(point(moved, 1).position, [2, 3]);
  assert.deepEqual(point(layers[0], 11).position, [2, 3]);
});

test('alias cycles, missing targets, unrelated layers and collapsed curves fail', () => {
  assert.throws(() => sketch([['point', 1, 1]]), /Cyclic/);
  assert.throws(
    () =>
      sketch([
        ['point', 1, 2],
        ['point', 2, 1],
      ]),
    /Cyclic/,
  );
  assert.throws(() => sketch([['point', 1, 7]]), /missing local point/);
  const other = sketch([['point', 1, [0, 0]]]);
  assert.throws(
    () => sketch([['point', 1, other.point(1)]]),
    /local or upstream/,
  );
  assert.throws(
    () =>
      sketch([
        ['point', 1, [0, 0]],
        ['point', 2, 1],
        ['line', 3, [1, 2]],
      ]),
    /zero length/,
  );
});

test('hard constraints on an alias apply to its canonical point, including conflicts', () => {
  const value = sketch(
    [
      ['point', 1, [3, 4]],
      ['point', 2, 1],
    ],
    {constraints: [['x', [2, 7]]]},
  );
  const snapshot = snapshotSketch(value, () => 's');
  assert.deepEqual(point(snapshot, 1).position, point(snapshot, 2).position);
  assert.equal(point(snapshot, 1).position[0], 7);
  assert.throws(
    () =>
      sketch(
        [
          ['point', 1, [0, 0]],
          ['point', 2, 1],
        ],
        {
          constraints: [
            ['x', [1, 1]],
            ['x', [2, 2]],
          ],
        },
      ),
    /conflict|inconsistent|converge/i,
  );
});

test('arc grid targets and exact source values do not accumulate solver tails', () => {
  for (const scale of [1e-8, 1, 1e8]) {
    let snapshot = snapshotSketch(
      sketch([
        ['point', 1, [0, 0]],
        ['point', 2, [-15 * scale, 0]],
        ['point', 3, [0, 15 * scale]],
        ['arc', 4, [1, 15 * scale, 2, 3, 'cw']],
      ]),
      () => 's',
    );
    for (let i = 0; i < 10; i++) {
      snapshot = solveSketchSnapshot([snapshot], {
        id: 3,
        position: [15 * scale, 0],
      });
      snapshot = solveSketchSnapshot([snapshot]);
    }
    assert.deepEqual(point(snapshot, 1).position, [0, 0]);
    assert.deepEqual(point(snapshot, 3).position, [15 * scale, 0]);
  }
});

test('precision cleanup retains deliberate tiny features and distinct close points', () => {
  const value = sketch(
    [
      ['point', 1, [1e-12, 0]],
      ['point', 2, [2e-12, 0]],
      ['line', 3, [1, 2]],
      ['point', 4, [1e9, 1e9]],
    ],
    {constraints: [['horizontal', 3]]},
  );
  const snapshot = snapshotSketch(value, () => 's');
  assert.deepEqual(point(snapshot, 1).position, [1e-12, 0]);
  assert.deepEqual(point(snapshot, 2).position, [2e-12, 0]);
  assert.equal(point(snapshot, 2).alias, undefined);
});

test('numeric cleanup cannot turn a nearby mouse target or seed into a changed hard value', () => {
  const snapshot = snapshotSketch(
    sketch(
      [
        ['point', 1, [0, 0]],
        ['point', 2, [10, 0]],
        ['line', 3, [1, 2]],
        ['circle', 4, [1, 15 + 1e-11]],
      ],
      {
        constraints: [
          ['fixed', 1],
          ['radius', [4, 15]],
        ],
      },
    ),
    () => 's',
  );
  const moved = solveSketchSnapshot([snapshot], {
    id: 1,
    position: [1e-12, 1e-12],
  });
  assert.deepEqual(point(moved, 1).position, [0, 0]);
  const circle = moved.entities.find(e => e.kind === 'circle')!;
  assert.equal(circle.radius, 15);
});
