import assert from 'node:assert/strict';
import test from 'node:test';
import {box, line, type Constraint, type SolidModel} from '@code3d/core';
import {
  constraintPreview,
  type ConstraintExpression,
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

function previewOf(expression: ConstraintExpression | undefined) {
  assert.ok(expression);
  const preview = constraintPreview(expression);
  assert.ok(preview);
  return preview;
}

test('constraint prefixes keep their own offset, pivot and rotation after the callback finishes', () => {
  const base = box(20, 10, 30);
  const original = box(8, 6, 4).originOffset(1, 2, 3).rotate(10, 20, 30);
  const stages = (self: SolidModel) => {
    const on = self.on(base.up);
    const offset = on.offset(10, 2, 3);
    const pivot = offset.pivot([5, 0, 0]);
    const rotate = pivot.rotate(25, 35, 10);
    const around = rotate.around(base.axis.reverse());
    const axisRotate = around.rotate(45);
    const finalOffset = axisRotate.offset(7, 0, 0);
    return [
      on,
      offset,
      pivot,
      rotate,
      around,
      axisRotate,
      finalOffset,
    ] as const;
  };
  let chains: ReturnType<typeof stages> | undefined;
  const placed = original.relate(self => {
    chains = stages(self);
    return chains[6];
  });
  assert.ok(chains);
  const final = snapshot(placed);
  const completed = [0, 1, 1, 3, 3, 5, 6] as const;
  chains.forEach((expression, index) => {
    const preview = previewOf(expression);
    const expected = original.relate(self => stages(self)[completed[index]]);
    const expectedSnapshot = snapshot(expected);
    samePose(
      preview.object.compositionTransform,
      expectedSnapshot.compositionTransform,
    );
    const actualConstraint = preview.object.constraints[0];
    const expectedConstraint = expectedSnapshot.constraints[0];
    assert.ok(
      actualConstraint.kind === 'on' && expectedConstraint.kind === 'on',
    );
    near(
      actualConstraint.sourceBounds.size,
      expectedConstraint.sourceBounds.size,
    );
    samePose(
      actualConstraint.sourceBounds.transform,
      expectedConstraint.sourceBounds.transform,
    );
    assert.equal(preview.object.nodeId, final.nodeId);
    assert.equal(preview.object.constraints[0].source.nodeId, final.nodeId);
  });
  near(
    previewOf(chains[1]).object.constraints[0].offsets.at(-1)!.value,
    [10, 2, 3],
  );
  near(
    previewOf(chains.at(-1)).object.constraints[0].offsets.at(-1)!.value,
    [7, 0, 0],
  );
  samePose(snapshot(placed).compositionTransform, final.compositionTransform);
});

test('align prefixes jointly solve inherited and sibling relations', () => {
  const base = box(20, 10, 20);
  const guide = line([10, 6, 0], [10, 6, 30]);
  const original = box(2, 2, 2).relate(s => s.on(base.up));
  let early: Constraint | undefined;
  const placed = original.relate(self => {
    early = self.center.align(guide);
    return [early.rotate(0, 25, 0), self.on(base.front)];
  });
  const preview = previewOf(early);
  assert.equal(preview.object.constraints.length, 3);
  const expected = original.relate(self => [
    self.center.align(guide),
    self.on(base.front),
  ]);
  samePose(
    preview.object.compositionTransform,
    snapshot(expected).compositionTransform,
  );
  assert.ok(placed);
});

for (const reverse of [false, true]) {
  test(`bound previews keep both contacts and only truncate the selected chain (reverse=${reverse})`, () => {
    const base = box(10, 10, 10);
    let first: Constraint | undefined,
      shifted: Constraint | undefined,
      second: Constraint | undefined;
    const model = box(20, 20, 20).relate(self => {
      first = reverse ? base.on(self.left) : self.on(base.right);
      shifted = first.offset(0, 0, 6);
      second = reverse ? base.on(self.up) : self.on(base.down);
      return [shifted, second];
    });
    const final = snapshot(model);
    for (const expression of [shifted, second]) {
      const preview = previewOf(expression);
      assert.equal(preview.object.constraints.length, 2);
      samePose(preview.object.compositionTransform, final.compositionTransform);
    }
    const beforeOffset = previewOf(first);
    assert.equal(beforeOffset.object.constraints.length, 2);
    near(beforeOffset.object.compositionTransform.position, [15, -15, 0]);
    assert.equal(beforeOffset.object.constraints[0].offsets.length, 0);
  });
}

test('reverse-written align and its earlier rotations retain self as their preview owner', () => {
  const base = line([10, 0, 0], [10, 30, 0]);
  const original = line([30, 0, 0]);
  let early: Constraint | undefined;
  const placed = original.relate(self => {
    early = base.align(self).rotate(10, 20, 30);
    return early.around(box(10, 10, 10).axis).rotate(40);
  });
  const preview = previewOf(early);
  const expected = original.relate(self => base.align(self).rotate(10, 20, 30));
  samePose(
    preview.object.compositionTransform,
    snapshot(expected).compositionTransform,
  );
  assert.equal(
    preview.object.constraints[0].target.nodeId,
    snapshot(placed).nodeId,
  );
  assert.ok(preview.spatial);
  assert.equal(preview.spatial.nodeId, snapshot(placed).nodeId);
});
