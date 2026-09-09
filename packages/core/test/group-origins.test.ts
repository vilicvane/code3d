import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Anchor, Model} from '@code3d/core';
import {box, group, line, point, rectangle} from '../bld/node/index.js';
import {
  composeTransforms,
  modelElementReference,
  rotateVector,
} from '../bld/tooling/index.js';
import {defined} from '../../../test/assert.ts';
import {createModelSnapshotter} from './model-test.ts';

const snapshot = createModelSnapshotter();
const frame = (anchor: Anchor) =>
  defined(modelElementReference(anchor)).transform;
const position = (anchor: Anchor) => frame(anchor).position;
const near = (actual: readonly number[], expected: readonly number[]) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );
};
const vertices = (model: Model) => [
  ...defined(snapshot(model).mesh).topologyVertices,
];

test('originPoint selects centers, named points and vertices across geometric families', () => {
  const solid = box(8, 6, 4).originOffset(1, 2, 3);
  const face = rectangle(8, 6).originOffset(3, 0, 4);
  const curve = line([3, 4, 5], [6, 8, 10]);
  const vertex = point([7, 8, 9]);
  const named = solid.expose({mount: solid.vertex(3)});
  for (const [body, anchor] of [
    [solid, solid.center],
    [face, face.vertex(1)],
    [curve, curve.start],
    [vertex, vertex.center],
    [named, named.mount],
  ] as const) {
    const before = vertices(body);
    const offset = position(anchor);
    const result = body.originPoint(anchor);
    near(
      vertices(result),
      before.map((v, i) => v - offset[i % 3]),
    );
    near(vertices(body), before);
    near(snapshot(result).origin, [0, 0, 0]);
    assert.deepEqual(
      defined(snapshot(result).mesh).vertexIds,
      defined(snapshot(body).mesh).vertexIds,
    );
  }
  near(position(curve.originPoint(curve.start).start), [0, 0, 0]);
  near(vertices(vertex.originPoint(vertex)), [0, 0, 0]);
  near(
    vertices(solid.originPoint(solid.vertex(3))),
    vertices(solid.originVertex(3)),
  );
  // @ts-expect-error Runtime author calls must also reject non-point geometry.
  assert.throws(() => solid.originPoint(curve), /requires a point reference/);
});

test('direct assembly retains the common origin even with unequal geometry bounds', () => {
  const base = box(100, 4, 8).originOffset(0, 2, 0);
  const lid = box(10, 2, 6).originOffset(0, -1, 0);
  const assembly = group([base, lid]).expose({base, lid});
  near(position(assembly.base.center), [0, -2, 0]);
  near(position(assembly.lid.center), [0, 1, 0]);
  near(position(assembly.base.up), position(assembly.lid.down));
  for (const child of snapshot(assembly).children)
    near(child.transform.position, [0, 0, 0]);
});

test('default group origin is the bounds center of solved direct origins, not their mean', () => {
  const a = point([100, 0, 0]);
  const b = point().relate(self => self.align(point([2, 4, -8])));
  const c = point().relate(self => self.align(point([20, -6, 2])));
  const assembly = group([a, b, c]).expose({a, b, c});
  const children = snapshot(assembly).children;
  near(children[0].transform.position, [-10, 1, 3]);
  near(children[1].transform.position, [-8, 5, -5]);
  near(children[2].transform.position, [10, -5, 5]);
  near(position(assembly.a), [90, 1, 3]);
  near(position(assembly.b), [-8, 5, -5]);
  near(position(assembly.c), [10, -5, 5]);
  near(children[1].transform.quaternion, [0, 0, 0, 1]);
});

test('changing a member origin changes a newly constructed group default', () => {
  const target = point([20, 0, 0]);
  const original = box(2, 2, 2).relate(self => self.center.align(target));
  const changed = original.originOffset(5, 0, 0);
  const before = snapshot(group([target, original]));
  const after = snapshot(group([target, changed]));
  near(before.children[0].transform.position, [-10, 0, 0]);
  near(after.children[0].transform.position, [-12.5, 0, 0]);
  near(before.children[1].transform.position, [10, 0, 0]);
  near(after.children[1].transform.position, [12.5, 0, 0]);
});

test('group rebasing preserves solved internal relations, anchors, bounds and earlier values', () => {
  const base = box(10, 10, 10);
  const cap = box(2, 2, 2).relate(self => self.on(base.up));
  const assembly = group([base, cap]).expose({base, cap});
  const moved = assembly.originOffset(3, 5, 7);
  const before = snapshot(assembly),
    after = snapshot(moved);
  near(before.children[0].transform.position, [0, -3, 0]);
  near(before.children[1].transform.position, [0, 3, 0]);
  near(after.children[0].transform.position, [-3, -8, -7]);
  near(after.children[1].transform.position, [-3, -2, -7]);
  near(position(moved.base.up), position(moved.cap.down));
  near(position(moved.up), [-3, -1, -7]);
  near(position(moved.down), [-3, -13, -7]);
  near(position(assembly.up), [0, 4, 0]);
  const exposedLater = moved.expose({capAgain: cap});
  near(position(exposedLater.capAgain.center), position(moved.cap.center));
  const restored = moved.originOffset(-3, -5, -7).material('#abcdef');
  near(position(restored.cap.center), position(assembly.cap.center));
  near(
    snapshot(restored).children[0].transform.position,
    before.children[0].transform.position,
  );
  assert.deepEqual(after.children[1].mesh, before.children[1].mesh);
  const relation = after.children[1].constraints[0];
  near(
    composeTransforms(
      after.children[1].transform,
      relation.sourceElement.transform,
    ).position,
    composeTransforms(
      after.children[0].transform,
      relation.targetElement.transform,
    ).position,
  );
});

test('originPoint resolves a rotated member into the group frame and keeps explicit origin through copies', () => {
  const body = box(8, 6, 4);
  const instance = body.relate(self =>
    self.center.align(point([20, 4, 6])).rotate(0, 0, 90),
  );
  const assembly = group([point(), instance]).expose({body: instance});
  const selected = assembly.originPoint(instance.vertex(3)).material('#aabbcc');
  near(position(selected.body.vertex(3)), [0, 0, 0]);
  const named = assembly.originPoint(assembly.body.vertex(3));
  near(position(named.body.center), position(selected.body.center));
  near(
    snapshot(selected).children[1].transform.quaternion,
    snapshot(assembly).children[1].transform.quaternion,
  );
  const afterOffset = selected.originOffset(2, 0, 0);
  near(position(afterOffset.body.vertex(3)), [-2, 0, 0]);
  near(
    position(afterOffset.originPoint(instance.vertex(3)).body.vertex(3)),
    [0, 0, 0],
  );
});

test('nested groups contribute their own origin once and rebase as a rigid assembly', () => {
  const body = box(2, 2, 2).relate(self =>
    self.center.align(point([30, 0, 0])),
  );
  const inner = group([point(), body]).expose({body}).originOffset(4, 0, 0);
  const outer = group([inner, point()]).expose({inner});
  near(snapshot(outer).children[0].transform.position, [0, 0, 0]);
  near(position(outer.inner.body.center), [11, 0, 0]);
  const moved = outer.originPoint(body.center);
  near(position(moved.inner.body.center), [0, 0, 0]);
  near(snapshot(moved).children[0].transform.position, [-11, 0, 0]);
  near(snapshot(moved).children[0].children[1].transform.position, [11, 0, 0]);
});

test('ambiguous repeated members require a concrete occurrence reference', () => {
  const body = box(2, 2, 2);
  const part = group([body]).expose({body});
  const left = part.relate(self => self.body.center.align(point([-10, 0, 0])));
  const right = part.relate(self => self.body.center.align(point([30, 0, 0])));
  const assembly = group([left, right]).expose({
    leftPart: left,
    rightPart: right,
  });
  assert.throws(
    () => assembly.originPoint(body.center),
    /multiple occurrences/,
  );
  const selected = assembly.originPoint(right.body.center);
  near(position(selected.rightPart.body.center), [0, 0, 0]);
  near(position(selected.leftPart.body.center), [-40, 0, 0]);
  near(position(assembly.leftPart.body.center), [-20, 0, 0]);
});

test('group origin edits carry its existing self relation references without moving its constrained geometry', () => {
  const body = box(2, 2, 2);
  const original = group([body])
    .expose({body})
    .relate(self => self.body.vertex(3).align(point([20, 30, 40])));
  const moved = original
    .originPoint(original.body.center)
    .originOffset(3, 5, 7);
  const before = snapshot(original),
    after = snapshot(moved);
  near(
    composeTransforms(
      before.compositionTransform,
      frame(original.body.vertex(3)),
    ).position,
    [20, 30, 40],
  );
  near(
    composeTransforms(after.compositionTransform, frame(moved.body.vertex(3)))
      .position,
    [20, 30, 40],
  );
  near(
    after.compositionTransform.position,
    before.compositionTransform.position.map((v, i) => v + [3, 5, 7][i]),
  );
});

test('empty groups retain zero as their default and allow explicit origin edits', () => {
  const empty = group([])
    .originOffset(1, 2, 3)
    .rotate(10, 20, 30)
    .originPoint(point([4, 5, 6]));
  near(snapshot(empty).origin, [0, 0, 0]);
  assert.deepEqual(snapshot(empty).children, []);
});

test('group rotation carries solved members, references and bounds around the selected origin', () => {
  const base = box(10, 10, 10);
  const cap = box(2, 2, 2).relate(self => self.on(base.up));
  const original = group([base, cap])
    .expose({base, cap})
    .originPoint(cap.center);
  const rotated = original.rotate(0, 0, 90);
  const before = snapshot(original),
    after = snapshot(rotated);
  near(position(rotated.cap.center), [0, 0, 0]);
  near(position(rotated.base.center), [6, 0, 0]);
  // Member contact frames turn with their poses; queried directional bounds
  // continue to use the receiving model's fixed axes.
  near(
    composeTransforms(after.children[0].transform, frame(base.up)).position,
    composeTransforms(after.children[1].transform, frame(cap.down)).position,
  );
  near(position(rotated.right), [11, 0, 0]);
  near(position(rotated.left), [-1, 0, 0]);
  near(position(rotated.up), [5, 5, 0]);
  near(
    position(rotated.expose({corner: cap.vertex(3)}).corner),
    position(rotated.cap.vertex(3)),
  );
  near(snapshot(rotated).origin, [0, 0, 0]);
  near(position(original.base.center), [0, -6, 0]);
  for (let i = 0; i < before.children.length; i++) {
    assert.deepEqual(after.children[i].mesh, before.children[i].mesh);
    near(after.children[i].transform.quaternion, [
      0,
      0,
      Math.SQRT1_2,
      Math.SQRT1_2,
    ]);
  }
  const placed = box(2, 2, 2).relate(self => self.on(rotated.right));
  near(
    snapshot(group([rotated, placed])).children[1].transform.position,
    [6, 0, 0],
  );
  near(
    position(rotated.rotate(0, 0, -90).base.center),
    position(original.base.center),
  );
  near(position(rotated.originOffset(2, 3, 4).cap.center), [-2, -3, -4]);
  assert.throws(() => original.rotate(NaN, 0, 0), /finite/);
});

test('nested repeated assemblies rotate rigidly in fixed XYZ order without re-solving member relations', () => {
  const base = box(10, 4, 6);
  const cap = box(2, 2, 2).relate(self =>
    self.on(base.up).around(base.axis).rotate(35),
  );
  const part = group([base, cap]).expose({base, cap});
  const left = part.relate(self =>
    self.base.center.align(point([-10, 0, 0])).rotate(10, 20, 30),
  );
  const right = part.relate(self => self.base.center.align(point([30, 0, 0])));
  const original = group([left, right])
    .expose({leftPart: left, rightPart: right})
    .originPoint(right.base.center);
  const rotated = original
    .rotate(25, 35, 45)
    .rotate(-10, 15, 20)
    .material('#abcdef');
  for (const name of ['leftPart', 'rightPart'] as const) {
    const expected = point(position(original[name].cap.vertex(3)))
      .rotate(25, 35, 45)
      .rotate(-10, 15, 20);
    near(position(rotated[name].cap.vertex(3)), position(expected.center));
  }
  const before = snapshot(original),
    after = snapshot(rotated);
  for (let i = 0; i < before.children.length; i++)
    for (let j = 0; j < before.children[i].children.length; j++) {
      const a = before.children[i].children[j],
        b = after.children[i].children[j];
      assert.deepEqual(b.transform, a.transform);
      assert.deepEqual(b.constraints, a.constraints);
      assert.deepEqual(b.mesh, a.mesh);
    }
  near(position(rotated.rightPart.base.center), [0, 0, 0]);
  assert.throws(() => rotated.originPoint(base.center), /multiple occurrences/);
  near(
    position(
      rotated
        .originPoint(rotated.leftPart.cap.vertex(3))
        .leftPart.cap.vertex(3),
    ),
    [0, 0, 0],
  );
});

test('direct group rotation updates stored self references and preserves external placement targets', () => {
  const body = box(8, 6, 4);
  const target = point([20, 30, 40]);
  const original = group([body])
    .expose({body})
    .relate(self => self.body.vertex(3).align(target));
  const rotated = original.rotate(15, 25, 35);
  const result = snapshot(rotated);
  near(
    composeTransforms(
      result.compositionTransform,
      frame(rotated.body.vertex(3)),
    ).position,
    [20, 30, 40],
  );
  const child = result.children[0];
  const localVertex = position(body.vertex(3));
  near(
    rotateVector(localVertex, child.transform.quaternion),
    position(rotated.body.vertex(3)),
  );
  near(position(original.body.vertex(3)), localVertex);
});
