import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  box,
  circle,
  cut,
  ellipse,
  extrude,
  rectangle,
  regularPolygon,
  type FaceModel,
  type Model,
} from '../bld/node/index.js';
import {replicad} from '../bld/node/replicad.js';
import {clearKernelOperationCache} from '../bld/library/kernel-cache.js';
import {defined} from '../../../test/assert.ts';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';

const models: Model[] = [];
function keep<T extends Model>(model: T): T {
  models.push(model);
  return model;
}
afterEach(() => {
  disposeModelObjects(models.splice(0));
  clearKernelOperationCache();
});

function volume(model: Model) {
  return replicad.measureVolume(modelGeometry(model).value.shape.asShape3D());
}
function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} ≈ ${expected}`);
}
function bounds(model: Model, expected: number[]) {
  modelGeometry(model)
    .value.localBounds.flat()
    .forEach((value, index) => {
      near(value, expected[index]);
    });
}

test('face extrusion uses signed distance from the unchanged starting face', () => {
  const profiles = [
    [keep(rectangle(4, 6)), 24],
    [keep(circle(2)), 4 * Math.PI],
    [keep(ellipse(2, 3)), 6 * Math.PI],
    [keep(regularPolygon(2, 6)), 6 * Math.sqrt(3)],
  ] as const;
  const snapshot = createModelSnapshotter();
  for (const [profile, area] of profiles) {
    const before = snapshot(profile);
    for (const distance of [3, -3]) {
      const result = keep(profile.extrude(distance));
      near(volume(result), area * Math.abs(distance));
      const [minimum, maximum] = modelGeometry(result).value.localBounds;
      near(minimum[1], Math.min(0, distance));
      near(maximum[1], Math.max(0, distance));
      const output = snapshot(result);
      assert.equal(output.kind, 'solid');
      assert.equal(output.operation.kind, 'extrude');
      assert.deepEqual(output.operation.inputs, [
        {nodeId: before.nodeId, role: 'receiver', index: 0},
      ]);
      assert.ok(defined(output.mesh).triangles.length > 0);
    }
    assert.deepEqual(createModelSnapshotter()(profile), before);
  }
});

test('extrusion follows the rotated plane normal and retains offset and scaled coordinates', () => {
  const profile = keep(rectangle(4, 6));
  const rotated = keep(keep(profile.rotate(0, 0, 90)).originOffset(-10, 0, 0));
  const result = keep(extrude(rotated, 3));
  bounds(result, [7, -2, -3, 10, 2, 3]);
  near(volume(result), 72);
  bounds(keep(rotated.extrude(-3)), [10, -2, -3, 13, 2, 3]);
  const scaled = keep(rotated.scaled(2));
  const scaledResult = keep(scaled.extrude(3));
  bounds(scaledResult, [17, -4, -6, 20, 4, 6]);
  near(volume(scaledResult), 288);
  bounds(profile, [-2, 0, -3, 2, 0, 3]);
});

test('extrusions retain source placement and color while exposing ordinary solid operations', () => {
  const stock = keep(box(20, 10, 20));
  const source = keep(keep(rectangle(8, 6)).paint('#336699'));
  const profile = keep(source.relate(self => self.down.on(stock.up)));
  const result = keep(profile.extrude(3));
  const snapshot = createModelSnapshotter();
  const input = snapshot(profile);
  const output = snapshot(result);
  assert.deepEqual(output.compositionTransform, input.compositionTransform);
  assert.deepEqual(
    output.constraints,
    input.constraints.map(constraint => ({
      ...constraint,
      source: {...constraint.source, nodeId: output.nodeId},
    })),
  );
  assert.equal(output.color, input.color);
  assert.deepEqual(output.transform.position, [0, 0, 0]);
  near(output.compositionTransform.position[1], 5);
  bounds(result, [-4, 0, -3, 4, 3, 3]);
  const rounded = keep(result.fillet(0.5));
  assert.ok(volume(rounded) < volume(result));
  const holeProfile = keep(circle(1));
  const hole = keep(holeProfile.extrude(3));
  const drilled = keep(cut(keep(source.extrude(3)), [hole]));
  near(volume(drilled), 144 - 3 * Math.PI);
  assert.ok(defined(snapshot(drilled).mesh).triangles.length > 0);
});

test('extrusion inherits the starting cap and its topology paths for subsequent selections', () => {
  const profile = keep(rectangle(4, 6));
  const result = keep(profile.extrude(3));
  assert.deepEqual(result.surface([1, 1]).id, [1, 1]);
  assert.deepEqual(
    result
      .surface([1, 1])
      .edges()
      .map(edge => edge.id),
    profile.edges().map(edge => [1, edge.id]),
  );
  assert.equal(result.surfaces().length, 6);
  assert.equal(result.edges().length, 12);
  assert.equal(result.vertices().length, 8);
  const rounded = keep(result.fillet(0.2, [[1, 1]]));
  assert.ok(volume(rounded) < volume(result));
});

test('method and function share cached geometry across edits and source disposal', () => {
  const profile = keep(rectangle(4, 6));
  const result = keep(profile.extrude(3));
  const repeatProfile = keep(rectangle(4, 6));
  const repeat = keep(extrude(repeatProfile, 3));
  const changedDistance = keep(profile.extrude(4));
  const reversed = keep(profile.extrude(-3));
  const changedProfile = keep(keep(rectangle(5, 6)).extrude(3));
  const rotated = keep(keep(profile.rotate(0, 0, 90)).extrude(3));
  const geometryId = modelGeometry(result).id;
  assert.equal(modelGeometry(repeat).id, geometryId);
  assert.equal(
    new Set(
      [result, changedDistance, reversed, changedProfile, rotated].map(
        model => modelGeometry(model).id,
      ),
    ).size,
    5,
  );
  disposeModelObjects(models.splice(0));
  const restored = keep(keep(rectangle(4, 6)).extrude(3));
  assert.equal(modelGeometry(restored).id, geometryId);
  near(volume(restored), 72);
  assert.ok(
    defined(createModelSnapshotter()(restored).mesh).triangles.length > 0,
  );
});

test('extrusion rejects invalid distances and non-face inputs before evaluating geometry', () => {
  const profile = keep(rectangle(4, 6));
  for (const distance of [0, -0, NaN, Infinity, -Infinity]) {
    assert.throws(() => profile.extrude(distance), /finite and non-zero/);
  }
  for (const input of [keep(box(1, 1, 1)), [profile], undefined]) {
    assert.throws(
      () => extrude(input as unknown as FaceModel, 3),
      /single face model/,
    );
  }
  bounds(profile, [-2, 0, -3, 2, 0, 3]);
});
