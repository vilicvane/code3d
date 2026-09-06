import {defined, createModelSnapshotter} from './model-test.ts';
import type {Model} from '@code3d/core';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  box,
  circle,
  group,
  line,
  loft,
  point,
  rectangle,
  regularPolygon,
  sphere,
} from '@code3d/core';
import {
  composeTransforms,
  modelElementReference,
  rotateVector,
  rotationAround,
} from '@code3d/core/tooling';

const snapshot = createModelSnapshotter();
const identity = [0, 0, 0, 1];
function near(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-6,
) {
  actual.forEach((value, i) =>
    assert.ok(
      Math.abs(value - expected[i]) < tolerance,
      `${actual} differs from ${expected}`,
    ),
  );
}
const pose = (model: Model) => snapshot(model).compositionTransform;
const position = (model: Model) => pose(model).position;

for (const [direction, expected] of Object.entries({
  up: [0, 7, 0],
  down: [0, -7, 0],
  left: [-11, 0, 0],
  right: [11, 0, 0],
  front: [0, 0, 18],
  back: [0, 0, -18],
})) {
  test(`on ${direction} translates the matching support boundary`, () => {
    const base = box(20, 10, 30);
    const placed = box(2, 4, 6).relate(self =>
      self.on(
        base[direction as 'up' | 'down' | 'left' | 'right' | 'front' | 'back'],
      ),
    );
    near(position(placed), expected);
    near(pose(placed).quaternion, identity);
    near(snapshot(placed).transform.position, [0, 0, 0]);
  });
}

for (const scale of [0.01, 1, 100])
  for (const reverse of [false, true]) {
    test(`joint translations are independent of equation order (${scale}, ${reverse})`, () => {
      const base = box(10 * scale, 10 * scale, 10 * scale);
      const placed = box(2 * scale, 2 * scale, 2 * scale).relate(self => {
        const relations = [
          self.on(base.up),
          self.on(base.right),
          self.on(base.front),
        ];
        return reverse ? relations.reverse() : relations;
      });
      near(position(placed), [6 * scale, 6 * scale, 6 * scale], 1e-6 * scale);
      near(pose(placed).quaternion, identity);
    });
  }

test('a tilted source uses its actual support, preserves orientation and tangential position', () => {
  const base = box(10, 10, 10);
  const source = box(4, 6, 8).rotate(0, 0, 30);
  const placed = source.relate(self => self.on(base.up));
  near(position(placed), [
    0,
    5 + 2 * Math.sin(Math.PI / 6) + 3 * Math.cos(Math.PI / 6),
    0,
  ]);
  near(pose(placed).quaternion, identity);
  const offsetPoint = point([13, -8, 17]).relate(self => self.on(base.up));
  near(position(offsetPoint), [0, 13, 0]);
});

test('target local direction determines the shared projection frame', () => {
  const base = box(10, 20, 30).rotate(0, 0, 90);
  const placed = box(2, 4, 6).relate(self => self.on(base.up));
  near(position(placed), [-11, 0, 0]);
  near(pose(placed).quaternion, identity);
});

test('selected points, edges and surfaces use only their own finite extent', () => {
  const base = box(10, 10, 10);
  const source = box(20, 20, 20);
  const top = source
    .surfaces()
    .find(
      surface =>
        defined(modelElementReference(surface.down)).transform.position[1] > 9,
    );
  const edge = source
    .edges()
    .find(
      edge =>
        defined(modelElementReference(edge.down)).transform.position[1] > 9,
    );
  const vertex = source
    .vertices()
    .find(
      vertex =>
        defined(modelElementReference(vertex)).transform.position[1] > 9,
    );
  for (const geometry of [top, edge, vertex]) {
    const placed = source.relate(() => defined(geometry).on(base.up));
    near(position(placed), [0, -5, 0]);
  }
  near(position(source.relate(self => self.on(base.up))), [0, 15, 0]);
  const sloped = line([-5, -3, 0], [5, 3, 0]).relate(self =>
    self.edge(1).on(base.up),
  );
  near(position(sloped), [0, 8, 0]);
});

test('offset pins bound centers in the unchanged target frame, including explicit zero', () => {
  const base = box(10, 10, 10);
  const shifted = box(20, 20, 20).relate(self =>
    self.on(base.down).offset(5, 0, 7),
  );
  near(position(shifted), [5, -15, -7]);
  const centered = point([20, 0, 30]).relate(self =>
    self.on(base.up).offset(0, 0, 0),
  );
  near(position(centered), [-20, 5, -30]);
  const flip = box(20, 20, 20).relate(self =>
    self.on(base.up.flip()).offset(5, 0, 7),
  );
  near(position(flip), [5, -5, 7]);
  near(pose(flip).quaternion, identity);
  assert.deepEqual(
    defined(modelElementReference(base.up.flip())).transform,
    defined(modelElementReference(base.up)).transform,
  );
  assert.deepEqual(
    modelElementReference(base.up.flip().flip()),
    modelElementReference(base.up),
  );
});

test('redundancy is accepted and positional conflicts never rotate the model', () => {
  const base = box(10, 10, 10);
  const duplicate = box(2, 2, 2).relate(self => [
    self.on(base.up),
    self.on(base.up),
  ]);
  near(position(duplicate), [0, 6, 0]);
  const conflict = box(2, 2, 2).relate(self => [
    self.on(base.up),
    self.on(base.down),
  ]);
  assert.throws(() => snapshot(conflict), /Conflicting bound positions/);
  const pinnedConflict = point().relate(self => [
    self.on(base.up).offset(0, 0, 0),
    self.on(base.right),
  ]);
  assert.throws(() => snapshot(pinnedConflict), /Conflicting bound positions/);
  near(position(point().relate(self => self.on(self.up))), [0, 0, 0]);
  assert.throws(
    () => snapshot(box(2, 2, 2).relate(self => self.on(self.up))),
    /Conflicting bound positions/,
  );
});

test('relate rebinds the original receiver and supports self on either end', () => {
  const base = box(10, 10, 10),
    original = box(2, 2, 2);
  near(position(original.relate(() => original.on(base.up))), [0, 6, 0]);
  near(position(original.relate(self => base.on(self.up))), [0, -6, 0]);
  near(position(original.relate(() => base.on(original.up))), [0, -6, 0]);
  near(position(original), [0, 0, 0]);
  assert.throws(
    () => original.relate(() => base.on(box(1, 1, 1).up)),
    /must involve self/,
  );
});

test('current derived bounds and old references have independent immutable meaning', () => {
  const original = sphere(10);
  const old = original.up;
  const derived = original.scaled(2);
  near(defined(modelElementReference(old)).transform.position, [0, 10, 0]);
  near(
    defined(modelElementReference(derived.up)).transform.position,
    [0, 20, 0],
  );
  const before = modelElementReference(derived.right);
  snapshot(derived);
  assert.deepEqual(modelElementReference(derived.right), before);
});

test('group bounds include solved child placements and stay rigid in a parent composition', () => {
  const base = box(10, 10, 10);
  const cap = box(2, 2, 2).relate(self => self.on(base.up));
  const inner = group([base, cap]);
  const target = point([20, 30, 40]);
  const moved = inner.relate(self => self.on(target.up).offset(0, 0, 0));
  const outer = snapshot(group([target, moved]));
  near(outer.children[1].transform.position, [20, 35, 40]);
  near(outer.children[1].children[1].transform.position, [0, 6, 0]);
  const exposed = moved.expose({mount: cap.up});
  near(
    position(box(2, 2, 2).relate(self => self.on(exposed.mount))),
    [0, 43, 0],
  );
});

test('on rejects arbitrary target anchors and infinite source references', () => {
  const model = box(2, 2, 2);
  for (const target of [
    model,
    model.center,
    model.axis,
    model.surface(1),
    model.vertex(1),
  ]) {
    // @ts-expect-error Only directional bounds are valid on targets.
    assert.throws(() => model.on(target), /requires a directional bound/);
  }
  assert.throws(() => model.axis.on(model.up), /no finite geometry/);
  assert.throws(() => circle(2).plane.on(model.up), /no finite geometry/);
});

test('pivot rotation preserves the original bent loft and standalone geometry', () => {
  const start = circle(20);
  const via = regularPolygon(20, 8).relate(self =>
    self.on(start.up).pivot(50, 0, 0).rotate(0, 0, 45),
  );
  const end = rectangle(40, 40).relate(self =>
    self.on(start.up).pivot(50, 0, 0).rotate(0, 0, 90),
  );
  near(position(via), [50 - 25 * Math.SQRT2, -25 * Math.SQRT2, 0]);
  near(position(end), [50, -50, 0]);
  near(snapshot(via).transform.quaternion, identity);
  assert.ok(
    defined(snapshot(loft([start, via, end])).mesh).triangles.length > 0,
  );
});

test('local pivot, pivotVertex, and direct rotate all refer to relate self', () => {
  const base = box(10, 10, 10);
  const original = box(2, 2, 2).origin(3, 4, 5).rotate(0, 0, 30);
  const atOrigin = original.relate(self => self.on(base.up).rotate(0, 45, 0));
  const explicit = original.relate(self =>
    self.on(base.up).pivot(0, 0, 0).rotate(0, 45, 0),
  );
  near(position(atOrigin), position(explicit));
  near(pose(atOrigin).quaternion, pose(explicit).quaternion);
  const self = box(2, 2, 2);
  const vertex = defined(modelElementReference(self.vertex(1))).transform
    .position;
  const a = self.relate(copy =>
    base.on(copy.up).pivotVertex(1).rotate(0, 0, 90),
  );
  const b = self.relate(copy =>
    base
      .on(copy.up)
      .pivot(...vertex)
      .rotate(0, 0, 90),
  );
  near(position(a), position(b));
  near(pose(a).quaternion, pose(b).quaternion);
  assert.throws(
    // @ts-expect-error An unfinished pivot chain must be rejected at runtime.
    () => self.relate(copy => copy.on(base.up).pivot(1, 2, 3)),
    /completed Constraint/,
  );
});

test('successive rotations compose and a second contact constrains the final pose', () => {
  const base = point();
  const source = circle(2);
  const placed = source.relate(self =>
    self
      .on(base.up)
      .pivot(5, 0, 0)
      .rotate(0, 0, 30)
      .pivot(0, 0, 3)
      .rotate(20, 0, 0),
  );
  const expected = composeTransforms(
    rotationAround([5, 0, 0], [0, 0, 30]),
    rotationAround([0, 0, 3], [20, 0, 0]),
  );
  near(position(placed), expected.position);
  near(pose(placed).quaternion, expected.quaternion);
  const constrained = source.relate(self => [
    self.on(base.up).pivot(5, 0, 0).rotate(0, 0, 90),
    self.on(base.right),
  ]);
  near(position(constrained), [0, -5, 0]);
  const conflict = source.relate(self => [
    self.on(base.up).rotate(0, 0, 30),
    self.on(base.right).rotate(0, 0, 45),
  ]);
  assert.throws(() => snapshot(conflict), /Conflicting explicit rotations/);
});

test('around resolves local and positioned external axes', () => {
  const origin = point();
  const selfAxis = box(2, 2, 2).relate(self =>
    self.on(origin.up).around(self.axis).rotate(90),
  );
  near(rotateVector([1, 0, 0], pose(selfAxis).quaternion), [0, 0, -1]);
  const axis = box(2, 2, 2).relate(self =>
    self.center.on(point([10, 20, 30]).up).offset(0, 0, 0),
  );
  const rotated = point().relate(self =>
    self.on(origin.up).around(axis.axis).rotate(90),
  );
  near(position(rotated), [-20, 0, 40]);
  near(rotateVector([1, 0, 0], pose(rotated).quaternion), [0, 0, -1]);
});

test('compatible rotation chains choose free translation independently of relation order and duplication', () => {
  const base = point();
  for (const reverse of [false, true])
    for (const duplicate of [false, true]) {
      const placed = point().relate(self => {
        const a = self.on(base.up).pivot(0, 0, 0).rotate(0, 90, 0);
        const b = self.on(base.up).pivot(10, 0, 0).rotate(0, 90, 0);
        const constraints = [a, b, ...(duplicate ? [a] : [])];
        return reverse ? constraints.reverse() : constraints;
      });
      near(position(placed), [5, 0, 5]);
    }
});

test('runtime errors distinguish missing bound targets and curved rotation axes', () => {
  const part = box(2, 2, 2);
  for (const target of [undefined, null, 3])
    // @ts-expect-error Missing and scalar targets must fail at runtime.
    assert.throws(() => part.on(target), /directional bound/);
  assert.throws(
    () => part.on(part.up).around(circle(3).edge(1)),
    /straight axis/,
  );
});
