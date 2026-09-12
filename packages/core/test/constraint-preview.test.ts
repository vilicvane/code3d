import assert from 'node:assert/strict';
import test from 'node:test';
import {
  box,
  line,
  offset,
  pivot,
  axisLine,
  rotate,
  type Constraint,
  type Transformation,
  type SolidModel,
  type Relation,
} from '@code3d/core';
import {
  relationPreview,
  type RelationExpression,
  type Transform,
} from '@code3d/core/tooling';
import {createModelSnapshotter} from './model-test.ts';

const snapshot = createModelSnapshotter();
const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((v, i) =>
    assert.ok(Math.abs(v - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );
const samePose = (a: Transform, b: Transform) => {
  near(a.position, b.position);
  near(a.quaternion, b.quaternion);
};
function previewOf(expression: RelationExpression | undefined) {
  assert.ok(expression);
  const preview = relationPreview(expression);
  assert.ok(preview);
  return preview;
}

test('independent steps and unfinished references retain their prefixes after the callback finishes', () => {
  const base = box(20, 10, 30);
  const original = box(8, 6, 4).originOffset(1, 2, 3).rotate(10, 20, 30);
  const stages = (self: SolidModel) => {
    const contact = self.on(base.up);
    const shift = offset(10, 2, 3);
    const center = pivot([5, 0, 0]);
    const turn = center.rotate(25, 35, 10);
    const axis = axisLine(base.axis.reverse());
    const orbit = axis.rotate(45);
    const finalShift = offset(7, 0, 0);
    return {
      expressions: [contact, shift, center, turn, axis, orbit, finalShift],
      complete: [contact, shift, turn, orbit, finalShift] satisfies Relation[],
    };
  };
  let captured: ReturnType<typeof stages> | undefined;
  const placed = original.relate(self => {
    captured = stages(self);
    return captured.complete;
  });
  assert.ok(captured);
  const final = snapshot(placed);
  const completed = [1, 2, 2, 3, 3, 4, 5];
  captured.expressions.forEach((expression, index) => {
    const preview = previewOf(expression);
    const expected = snapshot(
      original.relate(self => stages(self).complete.slice(0, completed[index])),
    );
    samePose(
      preview.object.compositionTransform,
      expected.compositionTransform,
    );
    assert.equal(preview.object.nodeId, final.nodeId);
    assert.equal(preview.object.constraints[0].source.nodeId, final.nodeId);
    assert.equal('offsets' in preview.object.constraints[0], false);
    assert.equal('rotations' in preview.object.constraints[0], false);
  });
  near(
    previewOf(captured.expressions[1]).object.transformations![0].offsets[0]
      .value,
    [10, 2, 3],
  );
  near(
    previewOf(captured.expressions.at(-1)).object.transformations!.at(-1)!
      .offsets[0].value,
    [7, 0, 0],
  );
  samePose(snapshot(placed).compositionTransform, final.compositionTransform);
});

test('align previews jointly solve inherited and sibling constraints before transformations', () => {
  const base = box(20, 10, 20);
  const guide = line([10, 6, 0], [10, 6, 30]);
  const original = box(2, 2, 2).relate(s => s.on(base.up));
  let early: Constraint | undefined;
  original.relate(self => {
    early = self.center.align(guide);
    return [early, self.on(base.front), rotate(0, 25, 0)];
  });
  const preview = previewOf(early);
  assert.equal(preview.object.constraints.length, 3);
  samePose(
    preview.object.compositionTransform,
    snapshot(
      original.relate(self => [self.center.align(guide), self.on(base.front)]),
    ).compositionTransform,
  );
});

for (const reverse of [false, true]) {
  test(`bound previews keep joint contacts and stop before independent offsets (reverse=${reverse})`, () => {
    const base = box(10, 10, 10);
    let first: Constraint | undefined,
      second: Constraint | undefined,
      shift: Transformation | undefined;
    const model = box(20, 20, 20).relate(self => {
      first = reverse ? base.on(self.left) : self.on(base.right);
      second = reverse ? base.on(self.up) : self.on(base.down);
      shift = offset(0, 0, 6);
      return [first, second, shift];
    });
    for (const expression of [first, second]) {
      const preview = previewOf(expression);
      assert.equal(preview.object.constraints.length, 2);
      near(preview.object.compositionTransform.position, [15, -15, 0]);
      assert.equal(preview.object.transformations, undefined);
    }
    samePose(
      previewOf(shift).object.compositionTransform,
      snapshot(model).compositionTransform,
    );
  });
}

test('reverse-written align retains self as the owner of later independent rotations', () => {
  const base = line([10, 0, 0], [10, 30, 0]);
  const original = line([30, 0, 0]);
  let early: Transformation | undefined;
  const placed = original.relate(self => {
    early = rotate(10, 20, 30);
    return [base.align(self), early, axisLine(box(10, 10, 10).axis).rotate(40)];
  });
  const preview = previewOf(early);
  samePose(
    preview.object.compositionTransform,
    snapshot(original.relate(self => [base.align(self), rotate(10, 20, 30)]))
      .compositionTransform,
  );
  assert.equal(
    preview.object.constraints[0].target.nodeId,
    snapshot(placed).nodeId,
  );
  assert.equal(preview.spatial?.nodeId, snapshot(placed).nodeId);
});

test('constraints expose no chained transformations or rotation selectors', () => {
  const part = box(2, 2, 2),
    base = box(10, 10, 10);
  for (const constraint of [part.on(base.up), part.axis.align(base.axis)]) {
    for (const method of [
      'offset',
      'rotate',
      'pivot',
      'pivotVertex',
      'pivotPoint',
      'axisEdge',
      'axisLine',
      'pivotOffset',
      'axisOffset',
    ])
      assert.equal(Reflect.get(constraint, method), undefined, method);
  }
});
