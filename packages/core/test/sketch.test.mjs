import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sketch} from '../bld/library/index.js';
import {
  isSketch,
  sketchDefinition,
  snapshotSketch,
  solveSketchSnapshot,
} from '../bld/tooling/index.js';

test('sketches exist without a kernel, a closed region, or any entities', () => {
  const empty = sketch([]);
  assert.equal(isSketch(empty), true);
  assert.equal(isSketch([]), false);
  assert.deepEqual(
    snapshotSketch(empty, () => 'empty'),
    {
      id: 'empty',
      base: undefined,
      entities: [],
      constraints: [],
      degreesOfFreedom: 0,
      redundant: [],
    },
  );
});

test('IDs are explicit, unordered and permit forward references', () => {
  const value = sketch([
    ['line', 3, [1, 2]],
    ['point', 2, [10, 0]],
    ['point', 1, [0, 0]],
  ]);
  assert.deepEqual(snapshotSketch(value, () => 's').entities, [
    {
      kind: 'line',
      id: 3,
      points: [
        {layer: 's', id: 1},
        {layer: 's', id: 2},
      ],
    },
    {kind: 'point', id: 2, position: [10, 0]},
    {kind: 'point', id: 1, position: [0, 0]},
  ]);
});

test('unconstrained dragging needs no native kernel and preserves other points', () => {
  const initial = snapshotSketch(
    sketch([
      ['point', 1, [0, 0]],
      ['point', 2, [10, 0]],
      ['line', 3, [1, 2]],
    ]),
    () => 'local',
  );
  const moved = solveSketchSnapshot([initial], {id: 1, position: [4, 5]});
  assert.deepEqual(moved.entities[0].position, [4, 5]);
  assert.deepEqual(moved.entities[1].position, [10, 0]);
  assert.equal(moved.degreesOfFreedom, 4);
  assert.deepEqual(initial.entities[0].position, [0, 0]);
});

test('the value captures its definition without retaining mutable coordinate arrays', () => {
  const entries = [
    ['point', 1, [0, 0]],
    ['point', 2, [10, 0]],
    ['line', 3, [1, 2]],
  ];
  const value = sketch(entries);
  entries[0][2][0] = 99;
  entries[2][2][0] = 2;
  entries.push(['point', 4, [30, 30]]);
  assert.deepEqual(sketchDefinition(value).entries, [
    ['point', 1, [0, 0]],
    ['point', 2, [10, 0]],
    ['line', 3, [1, 2]],
  ]);
});

test('derived layers independently reuse IDs while preserving upstream addresses', () => {
  const base = sketch([
    ['point', 1, [0, 0]],
    ['point', 2, [10, 0]],
  ]);
  const derived = base.derive([
    ['point', 1, [10, 10]],
    ['line', 2, [base.point(2), 1]],
  ]);
  const identity = value => (value === base ? 'base' : 'derived');
  assert.deepEqual(snapshotSketch(derived, identity), {
    id: 'derived',
    base: 'base',
    constraints: [],
    degreesOfFreedom: 2,
    redundant: [],
    entities: [
      {kind: 'point', id: 1, position: [10, 10]},
      {
        kind: 'line',
        id: 2,
        points: [
          {layer: 'base', id: 2},
          {layer: 'derived', id: 1},
        ],
      },
    ],
  });
  assert.equal(sketchDefinition(base).entries.length, 2);
  assert.throws(() => derived.point(2), /Unknown local sketch point 2/);
});

test('references may reach ancestors, but not siblings or unrelated sketches', () => {
  const base = sketch([['point', 1, [0, 0]]]);
  const child = base.derive([['point', 1, [10, 0]]]);
  const grandchild = child.derive([
    ['line', 1, [base.point(1), child.point(1)]],
  ]);
  assert.equal(isSketch(grandchild), true);
  const sibling = base.derive([['point', 1, [20, 0]]]);
  assert.throws(
    () => child.derive([['line', 1, [sibling.point(1), base.point(1)]]]),
    /local or upstream/,
  );
});

test('invalid author IDs, positions and point references have explicit errors', () => {
  assert.throws(
    () =>
      sketch([
        ['point', 1, [0, 0]],
        ['line', 1, [1, 1]],
      ]),
    /Duplicate/,
  );
  assert.throws(() => sketch([['point', 0, [0, 0]]]), /positive safe integers/);
  assert.throws(() => sketch([['point', 1, [NaN, 0]]]), /finite coordinates/);
  assert.throws(() => sketch([['line', 1, [2, 3]]]), /missing local point 2/);
});
