import assert from 'node:assert/strict';
import test from 'node:test';
import {box, group, line, point} from '../bld/node/index.js';
import {
  composeTransforms,
  createModelSnapshotter,
  disposeModelObjects,
  rotateVector,
} from '../bld/tooling/index.js';

const snapshot = createModelSnapshotter();
const identity = [0, 0, 0, 1];
function near(actual, expected, tolerance = 1e-6) {
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < tolerance,
      `${actual} differs from ${expected}`,
    ),
  );
}
function position(model) {
  return snapshot(model).compositionTransform.position;
}

for (const scale of [0.01, 1, 100])
  for (const reverse of [false, true]) {
    test(`combines the reported edge and face relations (scale ${scale}, reverse ${reverse})`, () => {
      const first = box(10 * scale, 10 * scale, 10 * scale);
      const second = box(20 * scale, 20 * scale, 20 * scale).relate(self => {
        const constraints = [
          self.edge(3).on(first.edge(1)),
          self.top.on(first.bottom),
        ];
        return reverse ? constraints.reverse() : constraints;
      });
      const assembly = group([first, second]);
      try {
        const pose = snapshot(assembly).children[1].transform;
        near(pose.position, [5 * scale, -15 * scale, 0], 1e-6 * scale);
        near(rotateVector([0, 1, 0], pose.quaternion), [0, 1, 0]);
        near(snapshot(second).transform.position, [0, 0, 0]);
      } finally {
        disposeModelObjects([first, second, assembly]);
      }
    });
  }

test('a single face relation centers and opposing normals remain directed', () => {
  const base = box(10, 10, 10);
  const top = box(20, 20, 20).relate(self => self.bottom.on(base.top));
  const flipped = box(20, 20, 20).relate(self =>
    self.bottom.on(base.top).flip(),
  );
  try {
    near(position(top), [0, 15, 0]);
    near(
      rotateVector([0, 1, 0], snapshot(top).compositionTransform.quaternion),
      [0, 1, 0],
    );
    near(position(flipped), [0, -5, 0]);
    near(
      rotateVector(
        [0, 1, 0],
        snapshot(flipped).compositionTransform.quaternion,
      ),
      [0, -1, 0],
    );
  } finally {
    disposeModelObjects([base, top, flipped]);
  }
});

test('explicit offset fixes the specified anchor position, including zero offset', () => {
  const base = box(10, 10, 10);
  const shifted = box(20, 20, 20).relate(self =>
    self.top.on(base.bottom).offset(5, 0, 7),
  );
  const conflict = box(20, 20, 20).relate(self => [
    self.edge(3).on(base.edge(1)),
    self.top.on(base.bottom).offset(0, 0, 0),
  ]);
  try {
    // Bottom's local Z points toward world -Z.
    near(position(shifted), [5, -15, -7]);
    assert.throws(() => snapshot(conflict), /Could not satisfy/);
  } finally {
    disposeModelObjects([base, shifted, conflict]);
  }
});

test('accepts redundant relations but rejects distinct conflicting planes', () => {
  const base = box(10, 10, 10);
  const duplicate = box(20, 20, 20).relate(self => [
    self.top.on(base.bottom),
    self.top.on(base.bottom),
  ]);
  const conflict = box(20, 20, 20).relate(self => [
    self.top.on(base.bottom),
    self.top.on(base.top),
  ]);
  try {
    near(position(duplicate), [0, -15, 0]);
    assert.equal(snapshot(duplicate).constraints.length, 2);
    assert.throws(() => snapshot(conflict), /Could not satisfy/);
  } finally {
    disposeModelObjects([base, duplicate, conflict]);
  }
});

test('constant self-relations are checked without a singular-matrix failure', () => {
  const redundant = box(2, 2, 2).relate(self => self.center.on(self.center));
  const conflicting = box(2, 2, 2).relate(self => self.top.on(self.bottom));
  try {
    near(position(redundant), [0, 0, 0]);
    assert.throws(() => snapshot(conflicting), /Could not satisfy/);
  } finally {
    disposeModelObjects([redundant, conflicting]);
  }
});

test('centering follows a target moved by another relation in the same solve', () => {
  const base = box(10, 10, 10);
  const middle = box(20, 20, 20).relate(self => [
    self.edge(3).on(base.edge(1)),
    self.top.on(base.bottom),
  ]);
  const last = box(2, 2, 2).relate(self =>
    self.bottom.on(middle.bottom).flip(),
  );
  const assembly = group([last, middle, base]);
  try {
    const [lastNode, middleNode] = snapshot(assembly).children;
    near(middleNode.transform.position, [5, -15, 0]);
    near(lastNode.transform.position, [5, -24, 0]);
  } finally {
    disposeModelObjects([base, middle, last, assembly]);
  }
});

test('point constraints determine a rigid rotation collectively', () => {
  const references = [point([2, 3, 4]), point([2, 5, 4]), point([0, 3, 4])];
  const sourcePoints = [point(), point([2, 0, 0]), point([0, 2, 0])];
  const source = box(1, 1, 1).expose({
    a: sourcePoints[0],
    b: sourcePoints[1],
    c: sourcePoints[2],
  });
  const related = source.relate(self => [
    self.a.on(references[0]).flip(),
    self.b.on(references[1]).flip(),
    self.c.on(references[2]).flip(),
  ]);
  try {
    const pose = snapshot(related).compositionTransform;
    near(pose.position, [2, 3, 4]);
    near(rotateVector([1, 0, 0], pose.quaternion), [0, 1, 0]);
    near(rotateVector([0, 1, 0], pose.quaternion), [-1, 0, 0]);
  } finally {
    disposeModelObjects([...references, ...sourcePoints, source, related]);
  }
});

test('point-on-plane and point-on-line retain their geometric freedoms', () => {
  const base = box(10, 10, 10);
  const rail = line([3, 5, -10], [3, 5, 10]);
  const result = point().relate(self => [
    self.on(base.top),
    self.on(rail.edge(1)),
  ]);
  try {
    near(position(result), [3, 5, 0]);
  } finally {
    disposeModelObjects([base, rail, result]);
  }
});

test('line-on-plane uses the line direction, not an aligned plane normal', () => {
  const base = box(10, 10, 10);
  const edge = line([-2, 0, 0], [2, 0, 0]).relate(self =>
    self.edge(1).on(base.top),
  );
  try {
    const pose = snapshot(edge).compositionTransform;
    near(pose.position, [0, 5, 0]);
    const direction = rotateVector([1, 0, 0], pose.quaternion);
    assert.ok(Math.abs(direction[1]) < 1e-7);
  } finally {
    disposeModelObjects([base, edge]);
  }
});

test('a group carries its solved child placements when moved as a rigid body', () => {
  const base = box(10, 10, 10);
  const child = box(2, 2, 2).relate(self => self.bottom.on(base.top));
  const inner = group([base, child]);
  const target = point([20, 30, 40]);
  const moved = inner.relate(self => self.on(target).flip());
  const outer = group([target, moved]);
  try {
    const movedNode = snapshot(outer).children[1];
    const childNode = movedNode.children[1];
    near(movedNode.transform.position, [20, 30, 40]);
    near(childNode.transform.position, [0, 6, 0]);
    near(
      composeTransforms(movedNode.transform, childNode.transform).position,
      [20, 36, 40],
    );
    near(snapshot(inner).children[1].transform.position, [0, 6, 0]);
  } finally {
    disposeModelObjects([base, child, inner, target, moved, outer]);
  }
});

test('exposed anchors remain in a moved group’s local frame', () => {
  const base = box(10, 10, 10);
  const child = box(2, 2, 2).relate(self => self.bottom.on(base.top));
  const target = point([20, 30, 40]);
  const moved = group([base, child]).relate(self => self.on(target).flip());
  const exposed = moved.expose({mount: child.top});
  const attached = box(2, 2, 2).relate(self => self.bottom.on(exposed.mount));
  try {
    near(
      snapshot(exposed).elements.find(element => element.name === 'mount')
        .transform.position,
      [0, 7, 0],
    );
    near(position(attached), [20, 38, 40]);
  } finally {
    disposeModelObjects([base, child, target, moved, exposed, attached]);
  }
});
