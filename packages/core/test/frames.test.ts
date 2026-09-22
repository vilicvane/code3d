import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  align,
  box,
  coupleRotation,
  distance,
  frame,
  group,
  offset,
  rotate,
  sketch,
} from '../bld/node/index.js';
import {
  createModelSnapshotter,
  disposeModelObjects,
  isFrame,
  isModelObject,
  modelElementReference,
  planModelSnapshotQueries,
  modelOperationObject,
  relatedModelObjects,
  transformsAreEquivalent,
  xyzRotation,
} from '../bld/tooling/index.js';
import type {Anchor, Model} from '../bld/node/index.js';

const snapshot = createModelSnapshotter();
function runtime(value: Model) {
  assert.ok(isModelObject(value));
  return value;
}
const reference = (value: Anchor) => {
  const result = modelElementReference(value);
  assert.ok(result);
  return result;
};
const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((v, i) =>
    assert.ok(Math.abs(v - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );

test('spatial derivations distinguish their source from newly introduced relation references', () => {
  const left = box(2, 4, 6);
  const right = box(2, 4, 6).originOffset(-10, 0, 0);
  const datum = frame().relate(self => align(self, left.frame));
  const profile = sketch().relate(self => align(self.plane, left.up));
  const part = box(1, 1, 1).relate(self => align(self.frame, left.frame));
  const pairs = [
    [datum, datum.relate(self => align(self, right.frame))],
    [profile, profile.relate(self => align(self.plane, right.up))],
    [part, part.relate(self => align(self.frame, right.frame))],
  ];
  try {
    for (const [source, derived] of pairs) {
      const sourceObject = modelOperationObject(source)!;
      const derivedObject = modelOperationObject(derived)!;
      assert.ok(sourceObject);
      assert.ok(derivedObject);
      const view = snapshot(derivedObject);
      assert.equal(view.operation.kind, 'relate');
      assert.deepEqual(view.operation.inputs, [
        {nodeId: sourceObject.nodeId, role: 'source', index: 0},
        {nodeId: runtime(right).nodeId, role: 'reference', index: 0},
      ]);
      assert.equal(view.constraints.length, 2);
      assert.equal(snapshot(sourceObject).constraints.length, 1);
      assert.ok(relatedModelObjects(derivedObject).includes(runtime(left)));
    }
  } finally {
    disposeModelObjects([
      runtime(left),
      runtime(right),
      ...pairs.flat().map(value => modelOperationObject(value)!),
    ]);
  }
});

test('standalone frames are reference values without model geometry or bounds', () => {
  const base = frame('Assembly frame');
  assert.ok(isFrame(base));
  assert.equal(isModelObject(base), false);
  assert.equal('bounds' in base, false);
  assert.equal('up' in base, false);
  assert.equal(reference(base).kind, 'frame');
  const view = snapshot(base);
  assert.equal(view.kind, 'reference');
  assert.equal(view.name, 'Assembly frame');
  assert.equal(view.mesh, undefined);
  assert.deepEqual(view.children, []);
  assert.deepEqual(planModelSnapshotQueries([base]), []);
  assert.equal(view.elements[0].kind, 'frame');
  assert.equal(distance(base.origin, base.origin), 0);
});

test('frame placement copies preserve old values and align both points and complete frames', () => {
  const base = frame();
  const moved = base.relate(() => [offset(10, 20, 30), rotate(0, 90, 0)]);
  const following = frame().relate(self => align(self, moved));
  const located = frame().relate(self => align(self.origin, moved.origin));
  near(
    snapshot(reference(base).model).compositionTransform.position,
    [0, 0, 0],
  );
  const expected = snapshot(reference(moved).model).compositionTransform;
  near(expected.position, [10, 20, 30]);
  assert.ok(
    transformsAreEquivalent(
      snapshot(reference(following).model).compositionTransform,
      expected,
    ),
  );
  near(
    snapshot(reference(located).model).compositionTransform.position,
    [10, 20, 30],
  );
  const chained = moved.relate(() => offset(2, 0, 0));
  near(
    snapshot(reference(chained).model).compositionTransform.position,
    [12, 20, 30],
  );
  near(
    snapshot(reference(moved).model).compositionTransform.position,
    [10, 20, 30],
  );
});

test('explicit assembly frames retain driven rotations and full-turn coupling independent of member order', () => {
  const base = frame();
  for (const angle of [0, 90, 360, 450, -720]) {
    const driver = box(4, 6, 8).relate(self => [
      align(self.frame, base),
      rotate(0, angle, 0),
    ]);
    const driven = box(2, 3, 4).relate(() => [
      coupleRotation(driver, {ratio: 0.3}),
      offset(20, 0, 0),
    ]);
    const model = runtime(
      group([driver, driven], {frame: base, name: 'Transmission'}),
    );
    const reversed = runtime(group([driven, driver], {frame: base}));
    const inherited = runtime(group([driver, driven]));
    try {
      const view = snapshot(model);
      assert.equal(view.name, 'Transmission');
      assert.equal(view.children.length, 2);
      assert.ok(
        transformsAreEquivalent(view.children[0].transform, {
          position: [0, 0, 0],
          quaternion: xyzRotation([0, angle, 0]),
        }),
      );
      assert.ok(
        transformsAreEquivalent(view.children[1].transform, {
          position: [20, 0, 0],
          quaternion: xyzRotation([0, angle * 0.3, 0]),
        }),
      );
      assert.deepEqual(
        snapshot(reversed).children.map(v => v.transform),
        [...view.children].reverse().map(v => v.transform),
      );
      near(snapshot(inherited).children[0].transform.quaternion, [0, 0, 0, 1]);
    } finally {
      disposeModelObjects([model, reversed, inherited]);
    }
  }
});

test('assembly frame references follow nested groups and subsequent origin edits', () => {
  const base = frame().relate(() => [offset(10, 20, 30), rotate(0, 90, 0)]);
  const part = box(2, 4, 6).relate(self => align(self.frame, base));
  const assembly = group([part], {frame: base}).expose({datum: base});
  const transformed = assembly.rotate(0, 30, 0).originOffset(3, 4, 5);
  const nested = group([transformed], {frame: frame()}).expose({datum: base});
  const objects = [assembly, transformed, nested].map(runtime);
  try {
    near(snapshot(objects[0]).children[0].transform.position, [0, 0, 0]);
    near(reference(assembly.datum).transform.position, [0, 0, 0]);
    assert.ok(
      transformsAreEquivalent(
        reference(transformed.datum).transform,
        reference(nested.datum).transform,
      ),
    );
    assert.ok(
      transformsAreEquivalent(
        reference(transformed.datum).transform,
        reference(transformed.expose({again: base}).again).transform,
      ),
    );
    const empty = runtime(group([], {frame: base}));
    try {
      assert.equal(snapshot(empty).children.length, 0);
      assert.equal(snapshot(empty).elements.filter(v => v.bound).length, 0);
      near(
        reference(empty.expose({datum: base}).datum).transform.position,
        [0, 0, 0],
      );
    } finally {
      disposeModelObjects([empty]);
    }
  } finally {
    disposeModelObjects(objects);
  }
});

test('group accepts exposed model frames including their local reference transform', () => {
  const base = frame();
  const marker = box(2, 2, 2).relate(self => [
    align(self.frame, base),
    offset(12, 3, 4),
    rotate(0, 30, 0),
  ]);
  const support = group([marker], {frame: base}).expose({mount: marker.frame});
  const part = box(4, 5, 6).relate(self => align(self.frame, support.mount));
  const assembly = runtime(group([part], {frame: support.mount}));
  try {
    const pose = snapshot(assembly).children[0].transform;
    near(pose.position, [0, 0, 0]);
    near(pose.quaternion, [0, 0, 0, 1]);
    assert.equal(snapshot(assembly).children.length, 1);
  } finally {
    disposeModelObjects([assembly]);
  }
});
