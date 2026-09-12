import {defined} from '../../../test/assert.ts';
import {createModelSnapshotter} from './model-test.ts';
import type {Model} from '@code3d/core';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  box,
  circle,
  line,
  point,
  cut,
  group,
  loft,
  regularPolygon,
  regularPrism,
} from '../bld/node/index.js';
import {
  composeTransforms,
  modelElementReference,
  rotateVector,
} from '../bld/tooling/index.js';

const snapshot = createModelSnapshotter();
const near = (actual: readonly number[], expected: readonly number[]) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );
};
const vertices = (model: Model) => [
  ...defined(snapshot(model).mesh).topologyVertices,
];
const center = (model: Model) =>
  defined(snapshot(model).elements.find(element => element.name === 'center'))
    .transform.position;
const shifted = (points: readonly number[], offset: readonly number[]) =>
  points.map((value, i) => value - offset[i % 3]);
function boundsCenter(model: Model) {
  const points = vertices(model);
  return [0, 1, 2].map(axis => {
    const coordinates = points.filter((_, index) => index % 3 === axis);
    return (Math.min(...coordinates) + Math.max(...coordinates)) / 2;
  });
}

test('originCenter follows the carried geometric center, independently of the rotated bounds', () => {
  const body = regularPrism(6, 2, 3);
  const initialCenter = center(body);
  near(initialCenter, boundsCenter(body));
  const rotated = body.rotate(0, 45, 0).scaled(2);
  const [x, y, z] = initialCenter;
  const expected = [Math.SQRT2 * (x + z), y * 2, Math.SQRT2 * (z - x)];
  near(center(rotated), expected);
  assert.ok(
    Math.hypot(...boundsCenter(rotated).map((v, i) => v - expected[i])) > 0.1,
  );
  const offset = rotated.originOffset(9, 8, 7).originOffset(1, 2, 3);
  near(center(offset), shifted(expected, [10, 10, 10]));
  const centered = offset.originCenter();
  near(snapshot(centered).origin, [0, 0, 0]);
  near(center(centered), [0, 0, 0]);
  near(vertices(centered), shifted(vertices(rotated), expected));
  near(vertices(centered.originCenter()), vertices(centered));
  near(center(body), initialCenter);
});

test('originCenter re-expresses faces, curves and points at local zero', () => {
  for (const body of [
    regularPolygon(6, 3),
    line([1, 2, 3], [5, 8, 11]),
    point([7, 8, 9]),
  ]) {
    const moved = body.rotate(0, 0, 90);
    const [x, y, z] = center(body);
    near(center(moved), [-y, x, z]);
    near(center(moved.originCenter()), [0, 0, 0]);
    near(vertices(moved.originCenter()), shifted(vertices(moved), [-y, x, z]));
  }
});

test('origin offsets compose and cancel while preserving topology and old model references', () => {
  const body = box(8, 6, 4);
  const base = body.expose({
    corner: body.vertex(3),
    rim: body.edge(1),
    mount: body.surface(1),
  });
  const captured = base.corner;
  const positioned = base.originOffset(1, 2, 3);
  const offset = positioned.originOffset(4, 0, 0).originOffset(0, 5, 0);
  near(vertices(offset), shifted(vertices(base), [5, 7, 3]));
  near(vertices(positioned), shifted(vertices(base), [1, 2, 3]));
  near(vertices(offset.originOffset(-5, -7, -3)), vertices(base));
  for (const model of [base, positioned, offset])
    near(snapshot(model).origin, [0, 0, 0]);
  const before = defined(snapshot(base).mesh),
    after = defined(snapshot(offset).mesh);
  assert.deepEqual(after.vertexIds, before.vertexIds);
  assert.deepEqual(
    after.edgeGroups.map(x => x.edgeId),
    before.edgeGroups.map(x => x.edgeId),
  );
  assert.deepEqual(
    after.surfaceGroups.map(x => x.surfaceId),
    before.surfaceGroups.map(x => x.surfaceId),
  );
  for (const name of ['corner', 'rim', 'mount'] as const) {
    const original = defined(modelElementReference(base[name])).transform;
    const changed = defined(modelElementReference(offset[name])).transform;
    near(changed.position, shifted(original.position, [5, 7, 3]));
    near(changed.quaternion, original.quaternion);
  }
  near(
    defined(modelElementReference(captured)).transform.position,
    defined(modelElementReference(base.corner)).transform.position,
  );
  const selected = offset.originVertex(3);
  near(
    defined(modelElementReference(selected.vertex(3))).transform.position,
    [0, 0, 0],
  );
  assert.throws(() => base.originVertex(99), /Unknown or retired vertex V99/);
  for (const method of ['originOffset', 'rotate'] as const) {
    assert.throws(() => base[method](NaN, 0, 0), /finite/);
    assert.throws(() => base[method](0, Infinity, 0), /finite/);
  }
  assert.equal('origin' in base, false);
});

test('coordinate point construction equals a zero point with the opposite origin offset', () => {
  const a = point([10, 2, -3]);
  const b = point().originOffset(-10, -2, 3);
  near(vertices(a), vertices(b));
  near(center(a), center(b));
  near(vertices(a.rotate(0, 0, 90)), [-2, 10, -3]);
  near(vertices(b.rotate(0, 0, 90)), vertices(a.rotate(0, 0, 90)));
  near(vertices(b.scaled(2)), [20, 4, -6]);
  const scene = snapshot(group([a, b]));
  near(
    scene.children[0].transform.position,
    scene.children[1].transform.position,
  );
  const target = point([20, 30, 40]);
  near(
    snapshot(a.relate(self => self.align(target))).compositionTransform
      .position,
    snapshot(b.relate(self => self.align(target))).compositionTransform
      .position,
  );
});

test('rotation and scaling act about the current local zero after an origin edit', () => {
  const base = box(8, 6, 4).originVertex(3);
  const rotated = base.rotate(0, 0, 90);
  near(
    vertices(rotated),
    vertices(base).flatMap((v, i, all) =>
      i % 3 ? [] : [-all[i + 1], v, all[i + 2]],
    ),
  );
  const [x, y, z] = center(base);
  near(center(rotated), [-y, x, z]);
  near(
    defined(modelElementReference(rotated.vertex(3))).transform.position,
    [0, 0, 0],
  );
  near(vertices(rotated.rotate(0, 0, -90)), vertices(base));
  near(
    vertices(base.scaled(2)),
    vertices(base).map(v => v * 2),
  );
  near(
    center(base.scaled(2)),
    center(base).map(v => v * 2),
  );
});

test('rotation uses fixed local X then Y then Z axes and composes in call order', () => {
  const base = point([2, 3, 4]);
  near(vertices(base.rotate(90, 90, 0)), [3, -4, -2]);
  near(
    vertices(base.rotate(90, 90, 0)),
    vertices(base.rotate(90, 0, 0).rotate(0, 90, 0)),
  );
  near(vertices(base.rotate(0, 90, 0).rotate(90, 0, 0)), [4, 2, 3]);
});

test('line coordinates retain model XYZ independently of the tangent anchor frame', () => {
  const segment = line([10, 0, 0]);
  near(center(segment), [5, 0, 0]);
  near(
    defined(modelElementReference(segment.up)).transform.position,
    [5, 0, 0],
  );
  near(
    rotateVector(
      [0, 1, 0],
      defined(modelElementReference(segment.up)).transform.quaternion,
    ),
    [0, 1, 0],
  );
  const direct = segment.rotate(0, 90, 0);
  const related = segment.relate(self =>
    self.start.align(point()).rotate(0, 90, 0),
  );
  // An explicit first reference retains the frame in which we inspect rotation.
  const scene = snapshot(group([point(), related])).children[1];
  const end = defined(modelElementReference(related.end)).transform;
  near(composeTransforms(scene.transform, end).position, [0, 0, -10]);
  near(
    defined(modelElementReference(direct.end)).transform.position,
    [0, 0, -10],
  );
  const shiftedLine = line([10, 0, 0], [20, 0, 0]).rotate(0, 0, 90);
  near(
    defined(modelElementReference(shiftedLine.start)).transform.position,
    [0, 10, 0],
  );
  near(
    defined(modelElementReference(shiftedLine.end)).transform.position,
    [0, 20, 0],
  );
});

test('origin edits carry existing self relation references into the result coordinates', () => {
  const target = point([20, 30, 40]);
  const original = box(8, 6, 4).relate(self => self.center.align(target));
  const moved = original.originOffset(3, 5, 7);
  near(center(moved), [-3, -5, -7]);
  near(snapshot(moved).compositionTransform.position, [23, 35, 47]);
  near(snapshot(original).compositionTransform.position, [20, 30, 40]);
  near(snapshot(moved).transform.position, [0, 0, 0]);
});

test('booleans and loft retain the primary input local coordinates after rebasing', () => {
  const stock = box(12, 4, 8).originOffset(2, 0, 1);
  const drilled = cut(stock, [box(2, 8, 2).rotate(0, 30, 0)]);
  near(center(drilled), [-2, 0, -1]);
  near(snapshot(drilled).origin, [0, 0, 0]);
  assert.ok(
    defined(snapshot(stock.rotate(23, 45, 67).fillet(0.3, [1])).mesh).triangles
      .length > 0,
  );
  const start = circle(2).originOffset(5, 0, 0);
  const end = circle(2).originOffset(5, -10, 0);
  const result = loft([start, end]);
  near(center(result), [-5, 5, 0]);
  near(snapshot(result).origin, [0, 0, 0]);
});
