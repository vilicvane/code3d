import assert from 'node:assert/strict';
import {test} from 'node:test';
import {box, group, line, offset, point, rotate} from '@code3d/core';
import {
  composeTransforms,
  modelElementReference,
  rotateVector,
  isModelObject,
} from '@code3d/core/tooling';
import {createModelSnapshotter} from './model-test.ts';

const snapshot = createModelSnapshotter();
const near = (a: readonly number[], b: readonly number[]) => {
  assert.equal(a.length, b.length);
  a.forEach((value, index) =>
    assert.ok(Math.abs(value - b[index]) < 1e-6, `${a} != ${b}`),
  );
};
const pose = (model: Parameters<typeof snapshot>[0]) =>
  snapshot(model).compositionTransform;
type FramePose = Pick<ReturnType<typeof pose>, 'position' | 'quaternion'>;
const sameFrame = (a: FramePose, b: FramePose) => {
  near(a.position, b.position);
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as const)
    near(rotateVector(axis, a.quaternion), rotateVector(axis, b.quaternion));
};

test('origin is the same frame-origin reference, distinct from point geometry', () => {
  for (const model of [
    point([10, 0, 0]),
    line([10, 0, 0]),
    box(2, 4, 6),
    group([]),
  ]) {
    assert.equal(model.origin, model.frame.origin);
    assert.equal(isModelObject(model.origin), false);
    assert.equal(isModelObject(model.frame), false);
    near(modelElementReference(model.origin)!.transform.position, [0, 0, 0]);
    const changed = model.originOffset(3, 4, 5).rotate(20, 30, 40);
    assert.equal(changed.origin, changed.frame.origin);
    near(modelElementReference(changed.origin)!.transform.position, [0, 0, 0]);
  }
  near(
    modelElementReference(point([10, 0, 0]).center)!.transform.position,
    [10, 0, 0],
  );
});

test('origin alignment fixes position while frame alignment also fixes orientation', () => {
  for (const angles of [
    [23, 41, 79],
    [0, 180, 0],
  ] as const) {
    const target = box(4, 6, 8).relate(self => [
      self.origin.align(point([12, 7, -4])),
      rotate(angles[0], angles[1], angles[2]),
    ]);
    const positioned = box(2, 3, 5).relate(self =>
      self.origin.align(target.origin),
    );
    near(pose(positioned).position, pose(target).position);
    near(pose(positioned).quaternion, [0, 0, 0, 1]);
    for (const build of [
      (self: typeof positioned) => self.frame.align(target.frame),
      (self: typeof positioned) => target.frame.align(self.frame),
    ]) {
      const placed = box(2, 3, 5).relate(build);
      sameFrame(pose(placed), pose(target));
      assert.equal(snapshot(group([point(), placed])).children.length, 2);
    }
  }
});

test('exposed frames and their origins follow nested occurrences and local transforms', () => {
  const part = box(2, 4, 6).relate(self => [
    self.origin.align(point([9, 8, 7])),
    rotate(15, 30, 45),
  ]);
  const assembly = group([point(), part]).expose({mount: part.frame});
  const nested = group([assembly])
    .expose({mount: assembly.mount})
    .rotate(10, 20, 30)
    .originOffset(4, 5, 6);
  const reference = modelElementReference(nested.mount)!.transform;
  near(
    modelElementReference(nested.mount.origin)!.transform.position,
    reference.position,
  );
  const follower = group([box(1, 2, 3)]).relate(self =>
    self.frame.align(nested.mount),
  );
  sameFrame(pose(follower), composeTransforms(pose(nested), reference));
  const originFollower = point([20, 0, 0]).relate(self =>
    self.origin.align(nested.mount.origin),
  );
  near(pose(originFollower).position, pose(follower).position);
});

test('coordinate constraints preserve selected old references across origin edits', () => {
  const target = box(4, 4, 4);
  const original = box(2, 2, 2).relate(self => self.frame.align(target.frame));
  const movedOrigin = original.originOffset(3, 4, 5);
  near(movedOrigin.position(target), [3, 4, 5]);
  near(movedOrigin.bounds(target).minimum, [-1, -1, -1]);
  near(original.position(target), [0, 0, 0]);
  const shifted = original.relate(self => [
    self.frame.align(target.frame),
    offset(7, 0, 0),
  ]);
  near(shifted.position(target), [7, 0, 0]);
});

test('frame alignment participates in joint geometric constraints and reports conflicts', () => {
  const source = box(2, 2, 2),
    target = box(4, 4, 4);
  const placed = source.relate(self => [
    self.frame.align(target.frame),
    self.center.align(target.origin),
  ]);
  sameFrame(pose(placed), pose(target));
  assert.throws(
    () =>
      snapshot(
        source.relate(self => [
          self.frame.align(target.frame),
          self.origin.align(point([10, 0, 0])),
        ]),
      ),
    /[Cc]onflict|incompatible/,
  );
});
