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
  const original = box(8, 6, 4).origin(1, 2, 3).rotate(10, 20, 30);
  const stages = (self: SolidModel) => {
    const on = self.on(base.up);
    const offset = on.offset(10, 2, 3);
    const pivot = offset.pivot(5, 0, 0);
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
    samePose(
      preview.object.compositionTransform,
      snapshot(expected).compositionTransform,
    );
    assert.equal(preview.object.nodeId, final.nodeId);
    assert.equal(preview.object.constraints[0].source.nodeId, final.nodeId);
  });
  near(previewOf(chains[1]).object.constraints[0].offset, [10, 2, 3]);
  near(previewOf(chains.at(-1)).object.constraints[0].offset, [17, 2, 3]);
  samePose(snapshot(placed).compositionTransform, final.compositionTransform);
});

test('align previews inherit earlier relate calls while excluding sibling return expressions', () => {
  const base = box(20, 10, 20);
  const original = box(2, 2, 2).relate(s => s.on(base.up));
  let early: Constraint | undefined;
  const placed = original.relate(self => {
    early = self.axis.align(base.axis);
    return [early.rotate(0, 25, 0), self.on(base.right)];
  });
  const preview = previewOf(early);
  assert.equal(preview.object.constraints.length, 2);
  samePose(
    preview.object.compositionTransform,
    snapshot(original.relate(s => s.axis.align(base.axis)))
      .compositionTransform,
  );
  // This preview does not need the full return array to have a solution.
  assert.ok(placed);
});

test('reverse-written align and its earlier rotations retain self as their preview owner', () => {
  const base = line([10, 0, 0], [10, 30, 0]);
  const original = line(30, 0, 0);
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
