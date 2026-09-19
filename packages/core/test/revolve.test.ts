import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  circle,
  line,
  rectangle,
  revolve,
  type Model,
  type SolidModel,
} from '../bld/node/index.js';
import {replicad} from '../bld/node/replicad.js';
import {clearKernelOperationCache} from '../bld/library/kernel-cache.js';
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

function volume(model: Model): number {
  return replicad.measureVolume(modelGeometry(model).value.shape.asShape3D());
}

test('revolve creates a full and a partial solid around a directed line', () => {
  const profile = keep(
    keep(keep(rectangle(4, 6)).rotate(90, 0, 0)).originOffset(-8, 0, 0),
  );
  const axis = keep(line([0, -20, 0], [0, 20, 0]));
  const full = keep(revolve(profile, axis, {angle: 360}));
  const unfinished = keep(
    Reflect.apply(revolve, undefined, [profile, axis]) as SolidModel,
  );
  const partial = keep(profile.revolve(axis, {angle: 180}));
  const reversed = keep(profile.revolve(axis.reverse(), {angle: -180}));
  assert.ok(Math.abs(volume(full) - 384 * Math.PI) < 1e-3);
  assert.ok(Math.abs(volume(unfinished) - volume(full)) < 1e-3);
  assert.ok(Math.abs(volume(partial) - 192 * Math.PI) < 1e-3);
  assert.ok(Math.abs(volume(reversed) - 192 * Math.PI) < 1e-3);
  const shiftedAxis = keep(axis.originOffset(-2, 0, 0));
  const shiftedRing = keep(revolve(profile, shiftedAxis, {angle: 360}));
  assert.ok(Math.abs(volume(shiftedRing) - 288 * Math.PI) < 1e-3);
  const snapshot = createModelSnapshotter();
  assert.equal(snapshot(full).operation.kind, 'revolve');
  assert.equal(snapshot(partial).kind, 'solid');
  assert.ok(snapshot(full).mesh?.triangles.length);
});

test('revolve advances a rotated profile for multiple turns', () => {
  const profile = keep(
    keep(keep(circle(1)).rotate(90, 0, 0)).originOffset(-8, 0, 0),
  );
  const axis = keep(line([0, -20, 0], [0, 20, 0]));
  const spring = keep(
    revolve(profile, axis, {
      angle: 5 * 360,
      advance: 25,
    }),
  );
  assert.ok(volume(spring) > 0);
  assert.equal(createModelSnapshotter()(spring).operation.kind, 'revolve');
  assert.ok(modelGeometry(spring).value.localBounds[1][1] > 20);
  const backwards = keep(
    profile.revolve(axis.edge(1).reverse(), {angle: 2 * 360, advance: 12}),
  );
  assert.ok(volume(backwards) > 0);
  assert.ok(modelGeometry(backwards).value.localBounds[0][1] < -10);
  const negativeAdvance = keep(
    profile.revolve(axis.edge(1), {angle: 2 * 360, advance: -12}),
  );
  assert.ok(volume(negativeAdvance) > 0);
  assert.ok(modelGeometry(negativeAdvance).value.localBounds[0][1] < -10);
  const negativeAngle = keep(
    profile.revolve(axis.edge(1), {angle: -2 * 360, advance: 12}),
  );
  assert.ok(volume(negativeAngle) > 0);
  assert.ok(modelGeometry(negativeAngle).value.localBounds[1][1] > 10);
});

test('revolve rejects a repeated pure rotation and non-finite config', () => {
  const profile = keep(rectangle(4, 6));
  const axis = keep(line([0, 1, 0]));
  assert.throws(
    () => revolve(profile, axis.edge(1), {angle: 720}),
    /cannot exceed one turn/,
  );
  assert.throws(
    () => revolve(profile, axis.edge(1), {angle: 360, advance: Infinity}),
    /advance must be finite/,
  );
  assert.throws(
    () => revolve(profile, axis.edge(1), {angle: 360}),
    /non-degenerate solid/,
  );
});
