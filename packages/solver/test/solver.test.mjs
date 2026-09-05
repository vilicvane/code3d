import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import initialize from '../wasm/solver.js';

const solver = await initialize({
  locateFile: () =>
    fileURLToPath(new URL('../wasm/solver.wasm', import.meta.url)),
  print() {},
  printErr() {},
});
const identity = [0, 0, 0, 1];
const body = (position, fixed = false) => ({
  position,
  quaternion: identity,
  fixed,
});
const marker = (body, position = [0, 0, 0]) => ({
  body,
  position,
  quaternion: identity,
});
const equation = (kind, axisI, axisJ = 0, value = 0) => ({
  kind,
  axisI,
  axisJ,
  value,
});
const point = [0, 1, 2].map(axis => equation('point', axis));
const orientation = [0, 1, 2].flatMap(i =>
  [0, 1, 2].map(j => equation('dot', i, j, +(i === j))),
);
const plane = [
  equation('distance', 1),
  equation('dot', 1, 0),
  equation('dot', 1, 2),
];
const line = [
  equation('distance', 0),
  equation('distance', 2),
  equation('dot', 1, 0),
  equation('dot', 1, 2),
];
const relation = (id, i, j, equations) => ({
  id,
  i,
  j,
  equations,
  preferences: [...point, ...orientation],
});
function near(actual, expected, tolerance = 1e-6) {
  actual.forEach((value, i) =>
    assert.ok(
      Math.abs(value - expected[i]) < tolerance,
      `${actual} != ${expected}`,
    ),
  );
}

test('hard geometry overrides competing centering preferences', () => {
  // A plane locks Y and a line locks X/Z. Their marker centers disagree.
  const result = solver.solve({
    bodies: [body([0, 0, 0], true), body([1, 2, 0])],
    relations: [
      relation('plane', marker(0, [0, 2, 0]), marker(1), plane),
      relation('line', marker(0, [1, 0, 0]), marker(1), line),
    ],
  });
  assert.equal(result.status, 'solved', JSON.stringify(result));
  near(result.poses[1].position, [1, 2, 0]);
});

test('centering follows the solved target pose', () => {
  const result = solver.solve({
    bodies: [body([0, 0, 0], true), body([0, 0, 0]), body([0, 0, 0])],
    relations: [
      relation('placed', marker(0, [4, 3, 2]), marker(1), point),
      relation('centered', marker(1, [0, 1, 0]), marker(2), plane),
    ],
  });
  assert.equal(result.status, 'solved', JSON.stringify(result));
  near(result.poses[2].position, [4, 4, 2]);
});

test('duplicate equations are accepted and all conflicting originals are checked', () => {
  for (const distance of [0, 1]) {
    const result = solver.solve({
      bodies: [body([0, 0, 0], true), body([0, 0, 0])],
      relations: [
        relation('first', marker(0), marker(1), plane),
        relation('second', marker(0, [0, distance, 0]), marker(1), plane),
      ],
    });
    assert.equal(
      result.status,
      distance ? 'unsatisfied' : 'solved',
      JSON.stringify(result),
    );
    assert.deepEqual(
      result.residuals.map(item => item.id),
      ['first', 'second'],
    );
  }
});

test('a point joint retains rotational freedom', () => {
  const result = solver.solve({
    bodies: [body([0, 0, 0], true), body([1, 2, 3])],
    relations: [relation('point', marker(0, [2, 3, 4]), marker(1), point)],
  });
  assert.equal(result.status, 'solved', JSON.stringify(result));
  near(result.poses[1].position, [2, 3, 4]);
  near(result.poses[1].quaternion, identity);
});

for (const count of [3, 10, 30]) {
  test(`assembles a perturbed closed loop of ${count} rigid bodies`, () => {
    const centers = Array.from({length: count}, (_, index) => {
      const angle = (2 * Math.PI * index) / count;
      return [Math.cos(angle), Math.sin(angle), 0];
    });
    const bodies = centers.map((center, index) =>
      body(
        center.map(
          (value, axis) => value + (index ? 0.01 * Math.sin(index + axis) : 0),
        ),
        index === 0,
      ),
    );
    const relations = centers.map((center, index) => {
      const next = (index + 1) % count;
      const midpoint = center.map(
        (value, axis) => (value + centers[next][axis]) / 2,
      );
      return relation(
        `joint-${index}`,
        marker(
          index,
          midpoint.map((value, axis) => value - center[axis]),
        ),
        marker(
          next,
          midpoint.map((value, axis) => value - centers[next][axis]),
        ),
        point,
      );
    });
    const result = solver.solve({bodies, relations});
    assert.equal(result.status, 'solved', JSON.stringify(result));
    assert.ok(result.residuals.every(item => item.error < 1e-7));
    near(result.poses[0].position, centers[0]);
  });
}

test('fixed bodies preserve translated and rotated input poses', () => {
  const quaternion = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const result = solver.solve({
    bodies: [{...body([3, 4, 5], true), quaternion}, body([3, 5, 5])],
    relations: [
      relation('fixed-reference', marker(0, [1, 0, 0]), marker(1), point),
    ],
  });
  assert.equal(result.status, 'solved', JSON.stringify(result));
  near(result.poses[0].position, [3, 4, 5]);
  near(result.poses[0].quaternion, quaternion);
  near(result.poses[1].position, [3, 5, 5]);
});
