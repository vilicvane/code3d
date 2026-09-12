import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aroundLine,
  aroundEdge,
  pivotPoint,
  box,
  group,
  line,
  offset,
  pivot,
  pivotVertex,
  rotate,
  type Constraint,
} from '@code3d/core';
import {
  relationPreview,
  modelElementReference,
  composeTransforms,
  invertTransform,
  rotateVector,
} from '@code3d/core/tooling';
import {createModelSnapshotter} from './model-test.ts';

const snapshot = createModelSnapshotter();
const near = (actual: readonly number[], expected: readonly number[]) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );
};

test('independent offset moves the joint result without changing local geometry', () => {
  const base = box(20, 4, 20);
  const original = box(2, 2, 2);
  const placed = original.relate(self => [
    self.axis.align(base.axis),
    self.on(base.up),
    offset(10, 5, 7),
  ]);
  near(snapshot(placed).compositionTransform.position, [10, 8, 7]);
  near(snapshot(placed).transform.position, [0, 0, 0]);
  assert.deepEqual(snapshot(placed).mesh, snapshot(original).mesh);
  near(snapshot(original).compositionTransform.position, [0, 0, 0]);
});

test('offset uses composition axes while rotation defaults to the current self origin', () => {
  const base = box(20, 4, 20);
  const placed = box(2, 2, 2).relate(self => [
    self.on(base.up),
    rotate(0, 0, 90),
    offset(10, 0, 0),
  ]);
  near(snapshot(placed).compositionTransform.position, [10, 3, 0]);
  near(snapshot(placed).compositionTransform.quaternion, [
    0,
    0,
    Math.SQRT1_2,
    Math.SQRT1_2,
  ]);
  const translated = box(2, 2, 2).relate(() => [
    offset(10, 0, 0),
    rotate(0, 0, 90),
  ]);
  near(snapshot(translated).compositionTransform.position, [10, 0, 0]);
});

test('pivot and external axis chains preserve authored call order', () => {
  const axis = line([0, 0, 10]);
  const part = box(2, 2, 2);
  near(
    snapshot(part.relate(() => [offset(10, 0, 0), aroundLine(axis).rotate(90)]))
      .compositionTransform.position,
    [0, 10, 0],
  );
  near(
    snapshot(part.relate(() => [aroundLine(axis).rotate(90), offset(10, 0, 0)]))
      .compositionTransform.position,
    [10, 0, 0],
  );
  near(
    snapshot(
      part.relate(() => [offset(10, 0, 0), pivot([2, 0, 0]).rotate(0, 0, 90)]),
    ).compositionTransform.position,
    [12, -2, 0],
  );
  const byVertex = part.relate(() => pivotVertex(1).rotate(20, 30, 40));
  const vertex = modelElementReference(part.vertex(1))!.transform;
  near(
    composeTransforms(snapshot(byVertex).compositionTransform, vertex).position,
    vertex.position,
  );
});

test('a later constraint segment preserves free translation and inherited orientation', () => {
  const base = box(20, 4, 20);
  const placed = box(4, 2, 2).relate(self => [
    self.on(base.up),
    offset(10, 5, 7),
    rotate(0, 0, 90),
    self.on(base.up),
  ]);
  near(snapshot(placed).compositionTransform.position, [10, 4, 7]);
  near(snapshot(placed).compositionTransform.quaternion, [
    0,
    0,
    Math.SQRT1_2,
    Math.SQRT1_2,
  ]);
  const aligned = box(2, 2, 2).relate(self => [
    self.on(base.up),
    offset(10, 5, 7),
    self.axis.align(line([10, 0, 7], [10, 10, 7])),
  ]);
  near(snapshot(aligned).compositionTransform.position, [10, 8, 7]);
});

test('successive relate calls continue the ordered placement and inherited free modes', () => {
  const base = box(20, 4, 20);
  const placed = box(2, 2, 2)
    .relate(self => self.on(base.up))
    .relate(() => offset(10, 5, 7))
    .relate(self => self.on(base.up));
  near(snapshot(placed).compositionTransform.position, [10, 3, 7]);
});

test('constraints referencing a transformed part see its final pose', () => {
  const base = box(20, 4, 20);
  const lower = box(2, 2, 2).relate(self => [
    self.on(base.up),
    offset(10, 5, 0),
  ]);
  const upper = box(2, 2, 2).relate(self => [
    self.axis.align(lower.axis),
    self.on(lower.up),
  ]);
  near(snapshot(upper).compositionTransform.position, [10, 10, 0]);
  const assembly = snapshot(group([base, lower, upper]));
  near(assembly.children[1].transform.position, [10, 8, 0]);
  near(assembly.children[2].transform.position, [10, 10, 0]);
});

test('stage previews keep joint siblings and stop at the selected segment', () => {
  const base = box(20, 4, 20);
  let contact: Constraint | undefined;
  let moved: ReturnType<typeof offset> | undefined;
  const placed = box(2, 2, 2).relate(self => {
    contact = self.on(base.up);
    moved = offset(10, 5, 7);
    return [
      self.axis.align(base.axis),
      contact,
      moved,
      rotate(0, 0, 90),
      self.on(base.up),
    ];
  });
  assert.ok(contact && moved);
  near(
    relationPreview(contact)!.object.compositionTransform.position,
    [0, 3, 0],
  );
  near(
    relationPreview(moved)!.object.compositionTransform.position,
    [10, 8, 7],
  );
  near(snapshot(placed).compositionTransform.position, [10, 3, 7]);
});

test('a nested assembly keeps its composition offset axes and selected pivot frame', () => {
  const base = box(20, 4, 20).relate(() => rotate(0, 0, 90));
  const cover = box(2, 2, 2).relate(self => [
    self.axis.align(base.axis),
    self.on(base.up),
  ]);
  const lifted = cover.relate(() => [offset(12, 0, 0), rotate(0, 30, 0)]);
  const closed = snapshot(group([base, cover]));
  const opened = snapshot(group([base, lifted]));
  near(
    opened.children[1].compositionTransform.position.map(
      (value, i) => value - closed.children[1].compositionTransform.position[i],
    ),
    [0, -12, 0],
  );
  const movement = opened.children[1].transformations![0];
  near(rotateVector([1, 0, 0], movement.offsetFrame.quaternion), [0, -1, 0]);
  near(
    opened.children[1].transformations![1].rotations[0].spatial.origin,
    [0, 0, 0],
  );
  const nested = snapshot(group([group([base, lifted]).rotate(0, 45, 0)]));
  assert.ok(nested.children[0].children[1].transformations);
});

test('external axes use their own final independent placement in mixed systems', () => {
  const axis = line([0, 0, 10]).relate(() => offset(3, 4, 0));
  const base = box(20, 4, 20);
  const part = box(2, 2, 2).relate(self => [
    self.axis.align(base.axis),
    self.on(base.up),
    offset(10, -3, 0),
    aroundLine(axis).rotate(90),
  ]);
  near(snapshot(part).compositionTransform.position, [7, 11, 0]);
});

test('completed independent transformations have no chaining operations', () => {
  const axis = line([0, 0, 10]);
  for (const value of [
    offset(1, 2, 3),
    rotate(10, 20, 30),
    pivot([1, 2, 3]).rotate(10, 20, 30),
    pivotVertex(1).rotate(10, 20, 30),
    aroundLine(axis).rotate(30),
  ]) {
    for (const operation of [
      'offset',
      'rotate',
      'pivot',
      'pivotVertex',
      'aroundLine',
    ])
      assert.equal(operation in value, false);
  }
});

test('pivotOffset preserves the selected vertex and moves its rotation center', () => {
  const part = box(6, 4, 2);
  const point = modelElementReference(part.vertex(1))!.transform.position;
  const displacement = [3, -2, 1] as const;
  const expected = part.relate(() =>
    pivot(
      point.map((value, index) => value + displacement[index]) as [
        number,
        number,
        number,
      ],
    ).rotate(20, 30, 40),
  );
  const actual = part.relate(() =>
    pivotVertex(1)
      .pivotOffset(...displacement)
      .rotate(20, 30, 40),
  );
  near(
    snapshot(actual).compositionTransform.position,
    snapshot(expected).compositionTransform.position,
  );
  near(
    snapshot(actual).compositionTransform.quaternion,
    snapshot(expected).compositionTransform.quaternion,
  );
  const unchanged = part.relate(() =>
    pivotVertex(1).pivotOffset(0, 0, 0).rotate(20, 30, 40),
  );
  near(
    snapshot(unchanged).compositionTransform.position,
    snapshot(part.relate(() => pivotVertex(1).rotate(20, 30, 40)))
      .compositionTransform.position,
  );
  assert.deepEqual(snapshot(part).transform.position, [0, 0, 0]);
});

test('axisOffset moves an axis in its reference frame and retains its direction', () => {
  const axis = line([0, 0, 10]).edge(1);
  const reference = modelElementReference(axis)!;
  const displacement = rotateVector([2, 3, 4], reference.transform.quaternion);
  const shifted = line(displacement, [
    displacement[0],
    displacement[1],
    displacement[2] + 10,
  ]);
  const part = box(2, 3, 4);
  const actual = snapshot(
    part.relate(() => aroundLine(axis).axisOffset(2, 3, 4).rotate(65)),
  );
  const expected = snapshot(part.relate(() => aroundLine(shifted).rotate(65)));
  near(
    actual.compositionTransform.position,
    expected.compositionTransform.position,
  );
  near(
    actual.compositionTransform.quaternion,
    expected.compositionTransform.quaternion,
  );
  const along = snapshot(
    part.relate(() => aroundLine(axis).axisOffset(0, 100, 0).rotate(65)),
  );
  near(
    along.compositionTransform.position,
    snapshot(part.relate(() => aroundLine(axis).rotate(65)))
      .compositionTransform.position,
  );
});

test('reference offsets stay incomplete until rotation and keep model value semantics', () => {
  const center = pivot([2, 3, 4]);
  const shifted = center.pivotOffset(1, 2, 3);
  assert.equal('pivotOffset' in shifted, false);
  assert.equal('offset' in shifted, false);
  const axis = aroundLine(line([0, 1, 0]));
  assert.equal('axisOffset' in axis.axisOffset(1, 2, 3), false);
  assert.equal('axisOffset' in axis.axisOffset(1, 2, 3).rotate(30), false);
  assert.throws(() => box(2, 2, 2).relate(() => shifted as never), /completed/);
  assert.throws(() => center.pivotOffset(NaN, 0, 0), /pivotOffset/);
  assert.throws(() => axis.axisOffset(0, Infinity, 0), /axisOffset/);
  const original = box(2, 2, 2).relate(() => center.rotate(10, 20, 30));
  const before = snapshot(original).compositionTransform;
  box(2, 2, 2).relate(() => shifted.rotate(50, 60, 70));
  assert.deepEqual(snapshot(original).compositionTransform, before);
});

test('aroundEdge is equivalent to a self edge reference after placement, offsets and origin edits', () => {
  const original = box(8, 6, 4)
    .originOffset(2, -1, 3)
    .relate(() => [offset(4, 8, -2), rotate(20, 10, 30)]);
  const byId = original.relate(() =>
    aroundEdge(1).axisOffset(2, 3, 4).rotate(37),
  );
  const byRef = original.relate(self =>
    aroundLine(self.edge(1)).axisOffset(2, 3, 4).rotate(37),
  );
  near(
    snapshot(byId).compositionTransform.position,
    snapshot(byRef).compositionTransform.position,
  );
  near(
    snapshot(byId).compositionTransform.quaternion,
    snapshot(byRef).compositionTransform.quaternion,
  );
  assert.equal(
    snapshot(byId).transformations!.at(-1)!.rotations[0].spatial.reference!
      .kind,
    'aroundEdge',
  );
});

test('pivotPoint self references match vertex pivots and survive immutable origin changes', () => {
  const original = box(8, 6, 4)
    .originOffset(2, -1, 3)
    .relate(() => [offset(4, 8, -2), rotate(20, 10, 30)]);
  const byId = original.relate(() =>
    pivotVertex(1).pivotOffset(2, 3, 4).rotate(17, 23, 31),
  );
  const byRef = original.relate(self =>
    pivotPoint(self.vertex(1)).pivotOffset(2, 3, 4).rotate(17, 23, 31),
  );
  for (const [a, b] of [
    [byId, byRef],
    [byId.originOffset(2, 1, 0), byRef.originOffset(2, 1, 0)],
    [byId.rotate(10, 20, 30), byRef.rotate(10, 20, 30)],
  ] as const) {
    near(
      snapshot(a).compositionTransform.position,
      snapshot(b).compositionTransform.position,
    );
    near(
      snapshot(a).compositionTransform.quaternion,
      snapshot(b).compositionTransform.quaternion,
    );
  }
});

test('pivotPoint external references use their solved position and retain self rotation/displacement axes', () => {
  const reference = box(10, 8, 6)
    .originOffset(-3, 2, -1)
    .relate(() => [offset(20, 8, 4), rotate(15, 20, 25)]);
  const original = box(8, 6, 4).relate(() => [
    offset(4, 8, -2),
    rotate(20, 10, 30),
  ]);
  const point = reference.vertex(1);
  const world = composeTransforms(
    snapshot(reference).compositionTransform,
    modelElementReference(point)!.transform,
  );
  const local = composeTransforms(
    invertTransform(snapshot(original).compositionTransform),
    world,
  ).position;
  const byReference = original.relate(() =>
    pivotPoint(point).pivotOffset(2, 3, 4).rotate(17, 23, 31),
  );
  const byCoordinates = original.relate(() =>
    pivot(local).pivotOffset(2, 3, 4).rotate(17, 23, 31),
  );
  near(
    snapshot(byReference).compositionTransform.position,
    snapshot(byCoordinates).compositionTransform.position,
  );
  near(
    snapshot(byReference).compositionTransform.quaternion,
    snapshot(byCoordinates).compositionTransform.quaternion,
  );
  const spatial =
    snapshot(byReference).transformations!.at(-1)!.rotations[0].spatial;
  assert.equal(spatial.reference!.kind, 'pivotPoint');
  near(
    spatial.origin,
    snapshot(byCoordinates).transformations!.at(-1)!.rotations[0].spatial
      .origin,
  );
});

test('constraint pivotPoint preserves an external center through joint solving and later transforms', () => {
  const base = box(20, 8, 12).relate(() => [
    offset(12, 5, 3),
    rotate(10, 20, 30),
  ]);
  const original = box(8, 6, 4).relate(() => rotate(15, 25, 35));
  const contact = original.relate(self => self.on(base.up));
  const point = base.vertex(1);
  const local = composeTransforms(
    invertTransform(snapshot(contact).compositionTransform),
    composeTransforms(
      snapshot(base).compositionTransform,
      modelElementReference(point)!.transform,
    ),
  ).position;
  const byRef = original.relate(self => [
    self.on(base.up),
    pivotPoint(point).pivotOffset(2, 3, 4).rotate(17, 23, 31),
    offset(3, 2, 1),
    rotate(5, 10, 15),
  ]);
  const byCoordinates = original.relate(self => [
    self.on(base.up),
    pivot(local).pivotOffset(2, 3, 4).rotate(17, 23, 31),
    offset(3, 2, 1),
    rotate(5, 10, 15),
  ]);
  near(
    snapshot(byRef).compositionTransform.position,
    snapshot(byCoordinates).compositionTransform.position,
  );
  near(
    snapshot(byRef).compositionTransform.quaternion,
    snapshot(byCoordinates).compositionTransform.quaternion,
  );
});
