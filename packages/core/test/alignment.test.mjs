import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arc,
  bezier,
  box,
  circle,
  cylinder,
  ellipse,
  group,
  line,
  point,
  rectangle,
  sphere,
} from '@code3d/core';
import {
  composeTransforms,
  createModelSnapshotter,
  modelElementReference,
  rotateVector,
} from '@code3d/core/tooling';

const snapshot = createModelSnapshotter();
const pose = model => snapshot(model).compositionTransform;
const near = (a, b, tolerance = 1e-6) =>
  a.forEach((v, i) =>
    assert.ok(Math.abs(v - b[i]) < tolerance, `${a} != ${b}`),
  );
const position = model => pose(model).position;
const world = (model, reference) =>
  composeTransforms(pose(model), modelElementReference(reference).transform);
const direction = (model, reference) =>
  rotateVector(
    [0, modelElementReference(reference).direction ?? 1, 0],
    world(model, reference).quaternion,
  );

test('point coincidence translates self on either written side and preserves original values', () => {
  const original = point([1, 2, 3]),
    target = point([10, 20, 30]);
  for (const build of [
    s => s.align(target),
    s => target.align(s),
    () => original.align(target),
  ]) {
    const placed = original.relate(build);
    near(position(placed), [9, 18, 27]);
    near(pose(placed).quaternion, [0, 0, 0, 1]);
  }
  near(position(original), [0, 0, 0]);
});

test('point on a supporting line ignores trims and direction without introducing rotation', () => {
  for (const target of [
    line([20, 0, 0], [30, 0, 0]),
    line([200, 0, 0], [300, 0, 0]).reverse(),
  ]) {
    const placed = point([4, 7, 9]).relate(s => s.align(target));
    near(position(placed), [0, -7, -9]);
    near(pose(placed).quaternion, [0, 0, 0, 1]);
  }
});

test('point to face uses the supporting plane beyond its boundary', () => {
  const placed = point([100, 30, 200]).relate(s => s.align(rectangle(2, 2)));
  near(position(placed), [0, -30, 0]);
});

test('directed line coincidence is independent of parameter origins and reverse keeps reference axes', () => {
  const target = line([100, 0, 0], [200, 0, 0]);
  for (const source of [
    line([10, 5, 0], [10, 8, 0]),
    line([10, 50, 0], [10, 80, 0]),
  ]) {
    const placed = source.relate(s => s.align(target));
    near(position(placed), [0, 10, 0]);
    near(direction(placed, placed.edge(1)), [1, 0, 0]);
    const reversed = source.relate(s => s.align(target.reverse()));
    near(direction(reversed, reversed.edge(1)), [-1, 0, 0]);
  }
  const edge = target.edge(1),
    before = modelElementReference(edge),
    after = modelElementReference(edge.reverse());
  assert.deepEqual(before.transform, after.transform);
  assert.deepEqual(modelElementReference(edge.reverse().reverse()), before);
});

test('antipodal directed lines and planes solve without becoming stationary', () => {
  const placed = line([0, 0, 0], [0, -10, 0]).relate(s =>
    s.align(line([0, 0, 0], [0, 10, 0])),
  );
  near(direction(placed, placed.edge(1)), [0, 1, 0]);
  const face = rectangle(10, 10).relate(s => s.align(rectangle(20, 20).flip()));
  near(rotateVector([0, 1, 0], pose(face).quaternion), [0, -1, 0]);
});

test('whole line lies in plane and retains its in-plane heading', () => {
  const placed = line([4, 8, 2], [14, 8, 12]).relate(s =>
    s.align(rectangle(2, 2)),
  );
  near(position(placed), [0, -8, 0]);
  near(pose(placed).quaternion, [0, 0, 0, 1]);
  const vertical = line([2, 0, 3], [2, 10, 3]).relate(s =>
    s.align(rectangle(2, 2)),
  );
  assert.ok(Math.abs(direction(vertical, vertical.edge(1))[1]) < 1e-6);
});

test('directed plane coincidence leaves tangential position and in-plane rotation free', () => {
  const source = rectangle(10, 20).rotate(0, 32, 0);
  const placed = source.relate(s => s.align(rectangle(2, 2)));
  near(position(placed), [0, 0, 0]);
  near(pose(placed).quaternion, [0, 0, 0, 1]);
});

test('circular arcs with different trimmed ranges share the same underlying circle', () => {
  const source = arc([10, 0, 0], [0, 10, 0], [-10, 0, 0]);
  const target = arc([20, 10, 0], [10, 0, 0], [20, -10, 0]);
  const placed = source.relate(s => s.align(target));
  near(position(placed), [20, 0, 0]);
  near(pose(placed).quaternion, [0, 0, 0, 1]);
  const extension = point([0, -20, 0]).relate(s => s.align(source));
  near(position(extension), [0, 10, 0]);
});

test('ellipse edges use the complete locus and its major axis without endpoint pairing', () => {
  const source = ellipse(20, 10).rotate(0, 45, 0),
    target = ellipse(20, 10);
  const placed = source.relate(s => s.edge(1).align(target.edge(1)));
  const p = pose(placed);
  assert.ok(p.quaternion.every(Number.isFinite));
  near(position(placed), [0, 0, 0]);
  const result = snapshot(placed);
  assert.equal(result.constraints[0].kind, 'align');
  assert.ok(result.constraints[0].sourceElement.arrow);
});

test('point, circle, line and surface constraints use true cylinder and sphere geometry', () => {
  const tube = cylinder(10, 40),
    ball = sphere(10);
  near(
    position(point([20, 80, 0]).relate(s => s.align(tube.surface(1)))),
    [-10, 0, 0],
  );
  near(
    position(point([20, 0, 0]).relate(s => s.align(ball.surface(1)))),
    [-10, 0, 0],
  );
  const generator = line([0, 70, 0], [0, 80, 0]).relate(s =>
    s.align(tube.surface(1)),
  );
  assert.ok(
    Math.abs(Math.hypot(position(generator)[0], position(generator)[2]) - 10) <
      1e-6,
  );
  const equator = circle(10).relate(s => s.edge(1).align(ball.surface(1)));
  near(position(equator), [0, 0, 0]);
  near(
    position(cylinder(10, 5).relate(s => s.surface(1).align(tube.surface(1)))),
    [0, 0, 0],
  );
  near(
    position(sphere(10).relate(s => s.surface(1).align(ball.surface(1)))),
    [0, 0, 0],
  );
});

test('align offset moves self in the target frame and zero does not pin a trim center', () => {
  const target = line([100, 0, 0], [200, 0, 0]);
  const original = point([3, 7, 9]);
  const plain = original.relate(s => s.align(target));
  const zero = original.relate(s => s.align(target).offset(0, 0, 0));
  near(position(plain), position(zero));
  for (const reverse of [false, true]) {
    const placed = original.relate(s =>
      (reverse ? target.align(s) : s.align(target)).offset(0, 5, 0),
    );
    const axes = reverse
      ? modelElementReference(original.center).transform.quaternion
      : modelElementReference(target.edge(1)).transform.quaternion;
    const offset = rotateVector([0, 5, 0], axes);
    near(
      position(placed),
      position(plain).map((v, i) => v + offset[i]),
    );
  }
});

test('elliptic cylinder sections and spherical latitude circles constrain the whole curve', () => {
  const tube = cylinder(10, 40),
    ball = sphere(10);
  const ellipseOnCylinder = ellipse(20, 10).relate(s =>
    s.edge(1).align(tube.surface(1)),
  );
  const circleOnSphere = circle(5).relate(s =>
    s.edge(1).align(ball.surface(1)),
  );
  for (const [model, radial] of [
    [ellipseOnCylinder, p => Math.hypot(p[0], p[2])],
    [circleOnSphere, p => Math.hypot(...p)],
  ]) {
    const value = snapshot(model),
      edges = value.mesh.edges;
    for (let i = 0; i < edges.length; i += 3) {
      const p = composeTransforms(value.compositionTransform, {
        position: [edges[i], edges[i + 1], edges[i + 2]],
        quaternion: [0, 0, 0, 1],
      }).position;
      assert.ok(
        Math.abs(radial(p) - 10) < 1e-4,
        `${p} is off the supporting surface`,
      );
    }
  }
});

test('rotation, pivot and reversed around axes remain authored after alignment', () => {
  const target = point([10, 0, 0]);
  const rotated = line([0, 0, 0], [0, 10, 0]).relate(s =>
    s.start.align(target).rotate(0, 0, 90),
  );
  near(world(rotated, rotated.start).position, [10, 0, 0]);
  near(direction(rotated, rotated.edge(1)), [-1, 0, 0]);
  const axis = box(1, 1, 1).axis;
  const a = point([10, 0, 0]).relate(s =>
    s.align(target).around(axis).rotate(90),
  );
  const b = point([10, 0, 0]).relate(s =>
    s.align(target).around(axis.reverse()).rotate(-90),
  );
  near(position(a), position(b));
  near(pose(a).quaternion, pose(b).quaternion);
});

test('multiple point relations jointly determine orientation and compose with on', () => {
  const original = line([0, 0, 0], [0, 10, 0]);
  const build = reverse =>
    original.relate(s => {
      const conditions = [
        s.start.align(point([20, 0, 0])),
        s.end.align(point([30, 0, 0])),
      ];
      return reverse ? conditions.reverse() : conditions;
    });
  for (const model of [build(false), build(true)]) {
    near(world(model, model.start).position, [20, 0, 0]);
    near(world(model, model.end).position, [30, 0, 0]);
  }
  const base = box(20, 10, 20),
    placed = box(2, 2, 2).relate(s => [s.axis.align(base.axis), s.on(base.up)]);
  near(position(placed), [0, 6, 0]);
  const assembly = group([base, placed]);
  assert.ok(snapshot(assembly).children.length === 2);
});

test('proven incompatibility, unsupported geometry and nonconvergence are distinct', () => {
  assert.throws(
    () => snapshot(circle(10).relate(s => s.edge(1).align(circle(20).edge(1)))),
    /Geometrically incompatible.*radii/,
  );
  assert.throws(
    () =>
      snapshot(
        line([0, 0, 0], [1, 0, 0]).relate(s => s.align(sphere(10).surface(1))),
      ),
    /whole straight line/,
  );
  assert.throws(
    () =>
      snapshot(
        bezier([
          [0, 0, 0],
          [5, 10, 0],
          [10, 0, 0],
        ]).relate(s => s.align(line([0, 0, 0], [1, 0, 0]))),
      ),
    /does not yet support underlying BEZIER/,
  );
  assert.throws(
    () =>
      snapshot(
        point().relate(s => [
          s.align(point([1, 0, 0])),
          s.align(point([2, 0, 0])),
        ]),
      ),
    /did not converge.*does not prove/,
  );
});

test('repeated compatible rotation chains apply their authored angle once', () => {
  const placed = box(2, 2, 2).relate(self => [
    self.center.align(point()).rotate(0, 90, 0),
    self.center.align(point()).rotate(0, 90, 0),
  ]);
  near(rotateVector([1, 0, 0], pose(placed).quaternion), [0, 0, -1]);
});

test('an already aligned elliptic cylinder section retains its pose', () => {
  const source = ellipse(20, 10).rotate(0, 0, 60);
  const placed = source.relate(self =>
    self.edge(1).align(cylinder(10, 20).surface(1)),
  );
  near(position(placed), [0, 0, 0]);
  near(pose(placed).quaternion, [0, 0, 0, 1]);
});

test('changing a point model origin does not move its geometric align reference', () => {
  const placed = point([3, 4, 5])
    .origin(20, 30, 40)
    .relate(self => self.align(point([10, 20, 30])));
  near(position(placed), [7, 16, 25]);
  near(
    snapshot(placed).constraints[0].sourceElement.transform.position,
    [3, 4, 5],
  );
});

test('point-to-ellipse placement follows the nearest locus point, ignoring trim parameters', () => {
  const target = ellipse(20, 10).edge(1);
  const placed = point([30, 8, 5]).relate(self => self.align(target));
  const move = position(placed),
    p = [30 + move[0], 8 + move[1], 5 + move[2]];
  assert.ok(Math.abs((p[0] / 20) ** 2 + (p[2] / 10) ** 2 - 1) < 1e-7);
  near([p[1]], [0]);
  const tangent = [(-20 * p[2]) / 10, 0, (10 * p[0]) / 20];
  assert.ok(Math.abs(move[0] * tangent[0] + move[2] * tangent[2]) < 1e-4);
});
