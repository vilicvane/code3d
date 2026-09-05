import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  box,
  circle,
  line,
  point,
  cut,
  group,
  regularPolygon,
  regularPrism,
} from '../bld/node/index.js';
import {
  createModelSnapshotter,
  rotationAround,
  composeTransforms,
} from '../bld/tooling/index.js';

const snapshot = createModelSnapshotter();
const near = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );
};
const vertices = model => [...snapshot(model).mesh.topologyVertices];
const center = model =>
  snapshot(model).elements.find(element => element.name === 'center').transform
    .position;
function boundsCenter(model) {
  const points = vertices(model);
  return [0, 1, 2].map(axis => {
    const coordinates = points.filter((_, index) => index % 3 === axis);
    return (Math.min(...coordinates) + Math.max(...coordinates)) / 2;
  });
}

test('originCenter uses the original body center carried through transforms, not the rotated bounds', () => {
  const body = regularPrism(6, 2, 3);
  const initialCenter = center(body);
  near(initialCenter, boundsCenter(body));
  const rotated = body.origin(0, 0, 0).rotate(0, 45, 0).scaled(2);
  const [x, y, z] = initialCenter;
  const expected = [Math.SQRT2 * (x + z), y * 2, Math.SQRT2 * (z - x)];
  near(center(rotated), expected);
  assert.ok(
    Math.hypot(...boundsCenter(rotated).map((v, i) => v - expected[i])) > 0.1,
  );
  const offset = rotated.origin(9, 8, 7).originOffset(1, 2, 3);
  const centered = offset.originCenter();
  near(snapshot(centered).origin, expected);
  near(center(centered), expected);
  near(vertices(centered), vertices(rotated));
  near(snapshot(offset).origin, [10, 10, 10]);
  near(center(body), initialCenter);
  near(
    snapshot(centered.originOffset(1, 2, 3)).origin,
    expected.map((v, i) => v + i + 1),
  );
  near(snapshot(centered.origin(4, 5, 6)).origin, [4, 5, 6]);
  const mesh = snapshot(centered).mesh;
  const index = mesh.vertexIds.indexOf(1) * 3;
  near(snapshot(centered.originVertex(1)).origin, [
    ...mesh.topologyVertices.slice(index, index + 3),
  ]);
});

test('originCenter shares center anchors on faces, curves and points', () => {
  const models = [
    regularPolygon(6, 3),
    line([1, 2, 3], [5, 8, 11]),
    point(7, 8, 9),
  ];
  for (const body of models) {
    near(center(body), boundsCenter(body));
    const moved = body.origin(0, 0, 0).rotate(0, 0, 90);
    const [x, y, z] = center(body);
    near(snapshot(moved.originCenter()).origin, [-y, x, z]);
    near(center(moved.origin(99, 98, 97)), [-y, x, z]);
  }
});

test('origin setters replace and offsets accumulate without moving geometry or old values', () => {
  const base = box(8, 6, 4);
  const positioned = base.origin(1, 2, 3);
  const offset = positioned.originOffset(4, 0, 0).originOffset(0, 5, 0);
  near(snapshot(offset).origin, [5, 7, 3]);
  near(snapshot(positioned).origin, [1, 2, 3]);
  near(snapshot(base).origin, [0, 0, 0]);
  near(vertices(offset), vertices(base));
  const pivot = offset.originVertex(3);
  const mesh = snapshot(base).mesh;
  const index = mesh.vertexIds.indexOf(3) * 3;
  near(snapshot(pivot).origin, [
    ...mesh.topologyVertices.slice(index, index + 3),
  ]);
  near(snapshot(pivot.originOffset(1, 2, 3).origin(9, 8, 7)).origin, [9, 8, 7]);
  assert.throws(() => base.originVertex(99), /Unknown or retired vertex V99/);
  for (const method of ['origin', 'originOffset', 'rotate']) {
    assert.throws(() => base[method](NaN, 0, 0), /finite/);
    assert.throws(() => base[method](0, Infinity, 0), /finite/);
  }
});

test('rotation fixes its selected pivot and preserves topology and semantic anchors', () => {
  const base = box(8, 6, 4).originVertex(3);
  const before = snapshot(base);
  const rotated = base.rotate(0, 0, 90);
  const after = snapshot(rotated);
  near(after.origin, before.origin);
  assert.deepEqual(after.mesh.vertexIds, before.mesh.vertexIds);
  assert.deepEqual(
    after.mesh.edgeGroups.map(x => x.edgeId),
    before.mesh.edgeGroups.map(x => x.edgeId),
  );
  assert.deepEqual(
    after.mesh.surfaceGroups.map(x => x.surfaceId),
    before.mesh.surfaceGroups.map(x => x.surfaceId),
  );
  const [px, py, pz] = before.origin;
  const expected = vertices(base).reduce((out, _, i, all) => {
    if (i % 3 === 0)
      out.push(px - (all[i + 1] - py), py + (all[i] - px), all[i + 2]);
    return out;
  }, []);
  near(vertices(rotated), expected);
  const center = after.elements.find(x => x.name === 'center');
  near(center.transform.position, [px + py, py - px, 0]);
  near(vertices(rotated.origin(0, 0, 0)), expected);
  near(vertices(rotated.rotate(0, 0, -90)), vertices(base));
});

test('rotation uses fixed local X then Y then Z axes and composes in call order', () => {
  const base = point(2, 3, 4).origin(0, 0, 0);
  near(vertices(base.rotate(90, 90, 0)), [3, -4, -2]);
  near(
    vertices(base.rotate(90, 90, 0)),
    vertices(base.rotate(90, 0, 0).rotate(0, 90, 0)),
  );
  near(vertices(base.rotate(0, 90, 0).rotate(90, 0, 0)), [4, 2, 3]);
  const frame = composeTransforms(
    rotationAround([1, 2, 3], [23, 45, 67]),
    rotationAround([1, 2, 3], [0, 0, 0]),
  );
  assert.ok(frame.quaternion.every(Number.isFinite));
});

test('rotated curves and faces retain their named and intrinsic relation anchors', () => {
  const curve = line(10, 0, 0).origin(0, 0, 0).rotate(0, 0, 90);
  near(
    snapshot(curve).elements.find(x => x.name === 'end').transform.position,
    [0, 10, 0],
  );
  const face = circle(2).rotate(90, 0, 0);
  const pinned = point().relate(self => self.on(face));
  const scene = snapshot(group([face, pinned]));
  near(scene.children[1].transform.position, [0, 0, 0]);
  assert.ok(scene.children[1].transform.quaternion.every(Number.isFinite));
  const mount = box(4, 4, 4).origin(2, 0, 0);
  const marker = point().relate(self => self.on(mount));
  near(
    snapshot(group([mount, marker])).children[1].transform.position,
    [2, 0, 0],
  );
});

test('rotated B-Reps participate in booleans and edge modifications', () => {
  const stock = box(12, 4, 8).origin(2, 0, 1);
  const tool = box(2, 8, 2).rotate(0, 30, 0);
  const drilled = cut(stock, [tool]);
  assert.ok(snapshot(drilled).mesh.triangles.length > 0);
  near(snapshot(drilled).origin, [2, 0, 1]);
  const rotated = stock.rotate(23, 45, 67).fillet(0.3, [1]);
  assert.ok(snapshot(rotated).mesh.triangles.length > 0);
});
