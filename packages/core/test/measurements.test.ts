import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  box,
  cylinder,
  point,
  group,
  offset,
  rotate,
  type Model,
} from '@code3d/core';
import {clearKernelOperationCache} from '@code3d/core/tooling';
import {createModelSnapshotter, disposeModelObjects} from './model-test.ts';
const models: Model[] = [];
const keep = <T extends Model>(model: T): T => (models.push(model), model);
afterEach(() => {
  disposeModelObjects(models.splice(0));
  clearKernelOperationCache();
});
const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 1e-5, `${actual} != ${expected}`),
  );

test('bounds and positions distinguish local geometry, model origins and solved placement', () => {
  const frame = keep(group([]));
  const solid = keep(
    box(2, 4, 6)
      .originOffset(3, 0, 0)
      .relate(() => [rotate(0, 0, 90), offset(10, 20, 30)]),
  );
  near(solid.bounds().minimum, [-4, -2, -3]);
  near(solid.bounds().maximum, [-2, 2, 3]);
  near(solid.bounds(frame).minimum, [8, 16, 27]);
  near(solid.bounds(frame).size, [4, 2, 6]);
  near(solid.position(frame), [10, 20, 30]);
  near(solid.position(solid), [0, 0, 0]);
  const p = keep(point([4, 5, 6]));
  near(p.bounds().minimum, [4, 5, 6]);
  near(p.position(frame), [0, 0, 0]);
});

test('queries preserve group occurrence frames and reject ambiguous repeated sources', () => {
  const a = keep(box(2, 4, 6));
  const b = keep(box(4, 2, 6).relate(() => offset(10, 0, 0)));
  const pair = keep(group([a, b]).rotate(0, 0, 90).originOffset(3, 4, 5));
  near(b.position(pair), [-3, 6, -5]);
  near(b.bounds(pair).minimum, [-4, 4, -8]);
  const repeated = keep(group([a, a]));
  assert.throws(() => a.bounds(repeated), /multiple occurrences/);
  assert.throws(() => a.position(repeated), /multiple occurrences/);
  assert.throws(() => keep(group([])).bounds(), /Empty geometry/);
});

test('rotated curved models use tight geometry bounds rather than rotated bounding-box corners', () => {
  const solid = keep(cylinder(5, 8).relate(() => rotate(0, 45, 0)));
  const frame = keep(group([]));
  near(solid.bounds(frame).size, [10, 8, 10]);
  const scene = keep(group([frame, solid]));
  const snapshot = createModelSnapshotter()(scene);
  assert.equal(snapshot.children.length, 2);
  near(scene.bounds().size, [10, 8, 10]);
});

test('measurement method names follow the existing exposed-element collision rules', () => {
  const solid = keep(box(2, 4, 6));
  for (const name of ['bounds', 'position']) {
    assert.throws(
      () => solid.expose({[name]: solid.up}),
      /conflicts with the model API/,
    );
  }
  near(solid.bounds().size, [2, 4, 6]);
});
