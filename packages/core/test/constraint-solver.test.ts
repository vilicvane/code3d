import {defined} from '../../../test/assert.ts';
import {createModelSnapshotter} from './model-test.ts';
import type {Model} from '@code3d/core';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  offset,
  pivot,
  rotate,
  pivotVertex,
  aroundLine,
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
  relativeTransform,
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

test('target model axes determine bounds after geometry rotates', () => {
  const base = box(10, 20, 30).rotate(0, 0, 90);
  const placed = box(2, 4, 6).relate(self => self.on(base.up));
  near(position(placed), [0, 7, 0]);
  near(pose(placed).quaternion, identity);
});

test('on snapshots retain the complete source box in the target projection frame', () => {
  const source = box(4, 6, 8).rotate(0, 0, 30);
  const base = box(10, 20, 30).rotate(0, 0, 90);
  for (const target of [base.up, base.up.flip()]) {
    const result = snapshot(source.relate(self => self.on(target)));
    const constraint = result.constraints[0];
    assert.equal(constraint.kind, 'on');
    if (constraint.kind !== 'on') return;
    near(constraint.sourceBounds.size, [
      4 * Math.cos(Math.PI / 6) + 6 * Math.sin(Math.PI / 6),
      6 * Math.cos(Math.PI / 6) + 4 * Math.sin(Math.PI / 6),
      8,
    ]);
    const contact = relativeTransform(
      constraint.sourceElement.transform,
      constraint.sourceBounds.transform,
    );
    near(contact.position, [
      0,
      (defined(constraint.sourceElement.bound).facing *
        constraint.sourceBounds.size[1]) /
        2,
      0,
    ]);
    near(contact.quaternion, identity);
  }
  const assembly = group([box(2, 4, 6), point([10, 12, 14])]);
  const constraint = snapshot(
    assembly.relate(self => self.on(box(10, 10, 10).up)),
  ).constraints[0];
  assert.equal(constraint.kind, 'on');
  if (constraint.kind === 'on')
    near(constraint.sourceBounds.size, [11, 14, 17]);

  const reverse = snapshot(
    box(2, 4, 6).relate(self => box(20, 10, 30).on(self.up)),
  ).constraints[0];
  assert.equal(reverse.kind, 'on');
  if (reverse.kind === 'on') near(reverse.sourceBounds.size, [20, 10, 30]);
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
    const constraint = snapshot(placed).constraints[0];
    assert.equal(constraint.kind, 'on');
    if (constraint.kind === 'on') near([constraint.sourceBounds.size[1]], [0]);
  }
  near(position(source.relate(self => self.on(base.up))), [0, 15, 0]);
  const sloped = line([-5, -3, 0], [5, 3, 0]).relate(self =>
    self.edge(1).on(base.up),
  );
  near(position(sloped), [0, 8, 0]);
});

test('offset translates the existing solution without pinning bound centers', () => {
  const base = box(10, 10, 10);
  const shifted = box(20, 20, 20).relate(self => [
    self.on(base.down),
    offset(5, 0, 7),
  ]);
  near(position(shifted), [5, -15, 7]);
  const centered = point([20, 0, 30]).relate(self => [
    self.on(base.up),
    offset(0, 0, 0),
  ]);
  near(position(centered), [0, 5, 0]);
  const flip = box(20, 20, 20).relate(self => [
    self.on(base.up.flip()),
    offset(5, 0, 7),
  ]);
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
    self.on(base.up),
    offset(0, 0, 0),
    self.on(base.right),
  ]);
  near(position(pinnedConflict), [5, 5, 0]);
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
  const moved = inner.relate(self => [self.on(target.up), offset(0, 0, 0)]);
  const outer = snapshot(group([target, moved]));
  near(outer.children[1].transform.position, [0, 35, 0]);
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
  const via = regularPolygon(20, 8).relate(self => [
    self.on(start.up),
    pivot([50, 0, 0]).rotate(0, 0, 45),
  ]);
  const end = rectangle(40, 40).relate(self => [
    self.on(start.up),
    pivot([50, 0, 0]).rotate(0, 0, 90),
  ]);
  near(position(via), [50 - 25 * Math.SQRT2, -25 * Math.SQRT2, 0]);
  near(position(end), [50, -50, 0]);
  near(snapshot(via).transform.quaternion, identity);
  assert.ok(
    defined(snapshot(loft([start, via, end])).mesh).triangles.length > 0,
  );
});

test('local pivot, pivotVertex, and direct rotate all refer to relate self', () => {
  const base = box(10, 10, 10);
  const original = box(2, 2, 2).originOffset(3, 4, 5).rotate(0, 0, 30);
  const atOrigin = original.relate(self => [
    self.on(base.up),
    rotate(0, 45, 0),
  ]);
  const explicit = original.relate(self => [
    self.on(base.up),
    pivot([0, 0, 0]).rotate(0, 45, 0),
  ]);
  near(position(atOrigin), position(explicit));
  near(pose(atOrigin).quaternion, pose(explicit).quaternion);
  const self = box(2, 2, 2);
  const vertex = defined(modelElementReference(self.vertex(1))).transform
    .position;
  const a = self.relate(copy => [
    base.on(copy.up),
    pivotVertex(1).rotate(0, 0, 90),
  ]);
  const b = self.relate(copy => [
    base.on(copy.up),
    pivot(vertex).rotate(0, 0, 90),
  ]);
  near(position(a), position(b));
  near(pose(a).quaternion, pose(b).quaternion);
  assert.throws(
    // @ts-expect-error An unfinished pivot chain must be rejected at runtime.
    () => self.relate(copy => [copy.on(base.up), pivot([1, 2, 3])]),
    /completed Constraint/,
  );
});

test('successive rotations compose and a later contact starts a new solve segment', () => {
  const base = point();
  const source = circle(2);
  const placed = source.relate(self => [
    self.on(base.up),
    pivot([5, 0, 0]).rotate(0, 0, 30),
    pivot([0, 0, 3]).rotate(20, 0, 0),
  ]);
  const expected = composeTransforms(
    rotationAround([5, 0, 0], [0, 0, 30]),
    rotationAround([0, 0, 3], [20, 0, 0]),
  );
  near(position(placed), expected.position);
  near(pose(placed).quaternion, expected.quaternion);
  const constrained = source.relate(self => [
    self.on(base.up),
    pivot([5, 0, 0]).rotate(0, 0, 90),
    self.on(base.right),
  ]);
  near(position(constrained), [0, -5, 0]);
  const sequential = source.relate(self => [
    self.on(base.up),
    rotate(0, 0, 30),
    self.on(base.right),
    rotate(0, 0, 45),
  ]);
  near(
    pose(sequential).quaternion,
    rotationAround([0, 0, 0], [0, 0, 75]).quaternion,
  );
});

test('around resolves local and positioned external axes', () => {
  const origin = point();
  const selfAxis = box(2, 2, 2).relate(self => [
    self.on(origin.up),
    aroundLine(self.axis).rotate(90),
  ]);
  near(rotateVector([1, 0, 0], pose(selfAxis).quaternion), [0, 0, -1]);
  const axis = box(2, 2, 2).relate(self =>
    self.center.align(point([10, 20, 30])),
  );
  const rotated = point().relate(self => [
    self.on(origin.up),
    aroundLine(axis.axis).rotate(90),
  ]);
  near(position(rotated), [-20, 0, 40]);
  near(rotateVector([1, 0, 0], pose(rotated).quaternion), [0, 0, -1]);
});

test('joint contacts are independent of order and duplicate entries before one rotation', () => {
  const base = point();
  for (const reverse of [false, true])
    for (const duplicate of [false, true]) {
      const placed = point().relate(self => {
        const a = self.on(base.up);
        const b = self.on(base.front);
        const constraints = [a, b, ...(duplicate ? [a] : [])];
        return [
          ...(reverse ? constraints.reverse() : constraints),
          pivot([10, 0, 0]).rotate(0, 90, 0),
        ];
      });
      near(position(placed), [10, 0, 10]);
    }
});

test('runtime errors distinguish missing bound targets and curved rotation axes', () => {
  const part = box(2, 2, 2);
  for (const target of [undefined, null, 3])
    // @ts-expect-error Missing and scalar targets must fail at runtime.
    assert.throws(() => part.on(target), /directional bound/);
  assert.throws(
    () => [part.on(part.up), aroundLine(circle(3).edge(1))],
    /straight axis/,
  );
});

for (const reverse of [false, true]) {
  test(`offset translates self's solved pose, including reversed endpoints (${reverse})`, () => {
    const base = box(10, 20, 30).originOffset(-40, -15, 7);
    const part = box(2, 4, 6).originOffset(13, -8, 17);
    const relation = (self: typeof part) =>
      reverse ? base.on(self.up) : self.on(base.up);
    const solved = pose(part.relate(relation));
    const shifted = pose(
      part.relate(self => [relation(self), offset(3, 5, 7)]),
    );
    near(
      shifted.position,
      solved.position.map((n, i) => n + [3, 5, 7][i]),
    );
    near(shifted.quaternion, solved.quaternion);
    near(
      position(part.relate(self => [relation(self), offset(0, 0, 0)])),
      solved.position,
    );
  });
}

test('zero rotation on a sibling contact adds no orientation constraint', () => {
  const base = point();
  const part = circle(2);
  const make = (zero: boolean) =>
    part.relate(self => [
      self.on(base.up),
      pivot([5, 0, 0]).rotate(0, 0, 90),
      self.on(base.right),
      ...(zero ? [rotate(0, 0, 0)] : []),
    ]);
  near(position(make(true)), position(make(false)));
  near(pose(make(true)).quaternion, pose(make(false)).quaternion);
});

for (const kind of ['on', 'align'] as const) {
  test(`${kind} applies offsets and external rotations in call order`, () => {
    const target = point();
    const axis = box(1, 1, 1);
    const original = point();
    const relation = (self: typeof original) =>
      kind === 'on' ? self.on(target.up) : self.align(target);
    const before = original.relate(self => [
      relation(self),
      offset(10, 0, 0),
      aroundLine(axis.axis).rotate(90),
    ]);
    const after = original.relate(self => [
      relation(self),
      aroundLine(axis.axis).rotate(90),
      offset(10, 0, 0),
    ]);
    near(position(before), [0, 0, -10]);
    near(position(after), [10, 0, 0]);
    const interleaved = original.relate(self => [
      relation(self),
      offset(10, 0, 0),
      aroundLine(axis.axis).rotate(90),
      offset(2, 3, 4),
    ]);
    near(position(interleaved), [2, 3, -6]);
  });
}

test('around uses the final external axis position after mixed constraints solve', () => {
  const axis = box(2, 2, 2)
    .rotate(0, 0, 90)
    .relate(self => [
      self.center.align(line([0, 0, 0], [0, 100, 0])),
      self.center.on(point([0, 20, 0]).up),
    ]);
  const rotated = point().relate(self => [
    self.on(point().up),
    aroundLine(axis.axis).rotate(90),
  ]);
  near(position(axis), [0, 20, 0]);
  near(position(rotated), [0, 20, 20]);
});

for (const mixed of [false, true]) {
  test(`untransformed sibling contacts do not dilute offsets (mixed=${mixed})`, () => {
    const base = box(10, 10, 10);
    const axis = box(2, 2, 2).relate(self => self.center.align(base.center));
    for (const reverse of [false, true]) {
      const placed = box(20, 20, 20).relate(self => {
        const constraints = [self.edge(3).on(base.left), self.up.on(base.down)];
        return [
          ...(reverse ? constraints.reverse() : constraints),
          offset(0, 0, 0),
          rotate(0, 0, 0),
          offset(5, 0, 7),
        ];
      });
      const model = group([base, placed, ...(mixed ? [axis] : [])]);
      near(snapshot(model).children[1].transform.position, [10, -15, 7]);
    }
  });
}
