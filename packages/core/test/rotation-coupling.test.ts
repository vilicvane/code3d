import assert from 'node:assert/strict';
import test from 'node:test';
import {
  align,
  axisLine,
  box,
  circle,
  coupleRotation,
  group,
  offset,
  rotate,
} from '@code3d/core';
import {rotateVector} from '@code3d/core/tooling';
import {createModelSnapshotter} from './model-test.ts';

const snapshot = createModelSnapshotter();
const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((v, i) =>
    assert.ok(Math.abs(v - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );
const heading = (angle: number) => [
  Math.cos((angle * Math.PI) / 180),
  0,
  -Math.sin((angle * Math.PI) / 180),
];

test('external attachments carry cumulative rotations through a ratio chain', () => {
  for (const angle of [
    -1080, -361, -180, 0, 47, 179, 181, 359, 360, 361, 1080,
  ]) {
    const base = box(2, 2, 2);
    const crank = box(10, 2, 2).relate(self => [
      align(self.frame, base.frame),
      rotate(0, angle, 0),
    ]);
    const driver = box(3, 2, 3).relate(self => align(self.frame, crank.frame));
    const driven = box(4, 2, 4).relate(self => [
      align(self.origin, driver.origin),
      coupleRotation(driver, {
        ratio: -2 / 3,
        phase: 6,
      }),
      offset(20, 0, 0),
    ]);
    const output = box(8, 2, 2).relate(self => align(self.frame, driven.frame));
    const assembly = snapshot(group([base, crank, driver, driven, output]));
    near(
      rotateVector([1, 0, 0], assembly.children[4].transform.quaternion),
      heading((-2 / 3) * angle + 6),
    );
    near(assembly.children[4].transform.position, [20, 0, 0]);
    near(assembly.children[1].transform.position, [0, 0, 0]);
    near(snapshot(base).compositionTransform.quaternion, [0, 0, 0, 1]);
  }
});

test('cumulative coordinates respect constraint stages and immutable references', () => {
  const base = box(1, 1, 1);
  const original = box(2, 2, 2).relate(self => [
    align(self.frame, base.frame),
    rotate(0, 720, 0),
    align(self.origin, base.origin),
    rotate(0, 45, 0),
  ]);
  const driven = box(2, 2, 2).relate(() =>
    coupleRotation(original, {ratio: 0.4}),
  );
  const changed = original.relate(() => rotate(0, 90, 0));
  near(
    rotateVector([1, 0, 0], snapshot(driven).compositionTransform.quaternion),
    heading(306),
  );
  near(
    rotateVector([1, 0, 0], snapshot(changed).compositionTransform.quaternion),
    heading(135),
  );
  const reset = original.relate(self => align(self.frame, base.frame));
  const resetDriven = box(2, 2, 2).relate(() =>
    coupleRotation(reset, {ratio: 0.4}),
  );
  near(
    rotateVector(
      [1, 0, 0],
      snapshot(resetDriven).compositionTransform.quaternion,
    ),
    heading(0),
  );
});

test('angular constraints report conflicting drivers and unsupported axis changes', () => {
  const base = box(1, 1, 1);
  const crank = box(2, 2, 2).relate(self => [
    align(self.frame, base.frame),
    rotate(0, 60, 0),
  ]);
  const incompatible = box(2, 2, 2).relate(self => [
    align(self.frame, base.frame),
    coupleRotation(crank, {ratio: 1}),
  ]);
  assert.throws(
    () => snapshot(incompatible),
    /Conflicting rotation constraints/,
  );
  const tilted = crank.relate(() => rotate(10, 0, 0));
  const driven = box(2, 2, 2).relate(() => coupleRotation(tilted, {ratio: -1}));
  assert.throws(() => snapshot(driven), /selected fixed axis/);
  assert.throws(
    () => box(2, 2, 2).relate(self => coupleRotation(base, {ratio: 0})),
    /nonzero ratio/,
  );
});

test('each model uses its own non-Y axis through rigid group placement', () => {
  for (const angles of [
    [0, 0, -90],
    [90, 0, 0],
    [23, 11, 42],
  ] as const) {
    const base = box(2, 3, 4).rotate(angles[0], angles[1], angles[2]);
    const driver = base.relate(self => axisLine(self.axis).rotate(750));
    const follower = base.relate(() =>
      coupleRotation(driver, {ratio: 1, phase: 10}),
    );
    const expected = base.relate(self => axisLine(self.axis).rotate(760));
    near(
      rotateVector(
        [1, 2, 3],
        snapshot(follower).compositionTransform.quaternion,
      ),
      rotateVector(
        [1, 2, 3],
        snapshot(expected).compositionTransform.quaternion,
      ),
    );
    const assembly = group([driver, follower]).rotate(21, 32, 43);
    assert.equal(snapshot(assembly).children.length, 2);
  }
});

test('cyclic driving dependencies report the supported chain boundary', () => {
  const loop = box(2, 2, 2).relate(self => {
    const feedback = box(1, 1, 1).relate(frame =>
      align(frame.frame, self.frame),
    );
    return coupleRotation(feedback, {ratio: -1});
  });
  assert.throws(() => snapshot(loop), /acyclic driving chain/);
});

test('an unrelated articulated branch on the same support keeps its rotation freedom', () => {
  const base = box(10, 2, 10);
  const driver = box(2, 2, 2).relate(self => [
    align(self.frame, base.frame),
    rotate(0, 720, 0),
  ]);
  const follower = box(2, 2, 2).relate(() =>
    coupleRotation(driver, {ratio: 0.25}),
  );
  const output = box(2, 2, 2).relate(self => align(self.frame, follower.frame));
  const unrelated = box(2, 2, 2).relate(self => [
    align(self.frame, base.frame),
    rotate(30, 0, 0),
  ]);
  const result = snapshot(group([base, driver, follower, output, unrelated]));
  near(
    rotateVector([1, 0, 0], result.children[3].transform.quaternion),
    heading(180),
  );
  near(rotateVector([0, 1, 0], result.children[4].transform.quaternion), [
    0,
    Math.cos(Math.PI / 6),
    0.5,
  ]);
});

test('model axes retain angular datums after geometry and origin changes', () => {
  const driver = box(2, 3, 4)
    .rotate(0, 30, 0)
    .relate(self => axisLine(self.axis).rotate(730));
  const original = box(2, 3, 4).rotate(0, -15, 0).originOffset(2, 3, 4);
  const result = original.relate(() =>
    coupleRotation(driver, {ratio: 0.5, phase: 7}),
  );
  near(
    rotateVector([1, 0, 0], snapshot(result).compositionTransform.quaternion),
    heading(0.5 * 760 + 7 + 15),
  );
  // Coupling controls angle without making the two axis positions coincide.
  near(snapshot(result).compositionTransform.position, [0, 0, 0]);
});

test('different model axes and external-axis rotations preserve complete turns', () => {
  const original = box(2, 3, 4);
  const support = original.relate(() => offset(4, 5, 6));
  const driver = original.relate(() => axisLine(support.axis).rotate(735));
  const attached = original.relate(self => align(self.frame, driver.frame));
  const followerBase = original.rotate(90, 0, 0);
  const follower = followerBase.relate(() =>
    coupleRotation(attached, {ratio: 0.4}),
  );
  const expected = followerBase.relate(self => axisLine(self.axis).rotate(294));
  near(
    rotateVector([1, 2, 3], snapshot(follower).compositionTransform.quaternion),
    rotateVector([1, 2, 3], snapshot(expected).compositionTransform.quaternion),
  );
});

test('implicit self uses the innermost callback and restores its parent after errors', () => {
  const driver = box(2, 3, 4).relate(() => rotate(0, 730, 0));
  const follower = box(2, 3, 4).relate(() => {
    const inner = box(2, 3, 4).relate(() =>
      coupleRotation(driver, {ratio: 0.25}),
    );
    assert.throws(
      () => group([]).relate(() => coupleRotation(driver, {ratio: 1})),
      /each model to have an axis/,
    );
    return coupleRotation(inner, {ratio: 0.5});
  });
  near(
    rotateVector([1, 0, 0], snapshot(follower).compositionTransform.quaternion),
    heading(91.25),
  );
  assert.throws(
    () => coupleRotation(driver, {ratio: 1}),
    /inside a relate callback/,
  );
});

test('a reference to the original receiver remains distinct from the new self', () => {
  const original = box(2, 3, 4).relate(() => rotate(0, 1080, 0));
  const follower = original.relate(() =>
    coupleRotation(original, {ratio: 0.5}),
  );
  near(
    rotateVector([1, 0, 0], snapshot(follower).compositionTransform.quaternion),
    heading(540),
  );
  near(
    rotateVector([1, 0, 0], snapshot(original).compositionTransform.quaternion),
    heading(1080),
  );
});

test('coupling requires two models with straight axes', () => {
  const driver = box(2, 3, 4);
  assert.throws(
    () => driver.relate(() => coupleRotation(driver.axis as never, {ratio: 1})),
    /requires a model with an axis/,
  );
  assert.throws(
    () => driver.relate(() => coupleRotation(group([]) as never, {ratio: 1})),
    /each model to have an axis/,
  );
  const curve = circle(3);
  const curvedAxis = group([curve]).expose({axis: curve.edge(1)});
  assert.throws(
    () => driver.relate(() => coupleRotation(curvedAxis, {ratio: 1})),
    /straight/,
  );
});
