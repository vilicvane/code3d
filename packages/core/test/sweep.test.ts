import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  align,
  bezier,
  circle,
  line,
  sketch,
  sweep,
  type Model,
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

test('sweep creates a solid along straight and curved open paths', () => {
  const profile = keep(circle(2));
  const straight = keep(line([0, 12, 0]));
  const rod = keep(sweep(profile, straight));
  assert.ok(Math.abs(volume(rod) - 48 * Math.PI) < 1e-3);
  const curve = keep(
    bezier([
      [0, 0, 0],
      [0, 8, 0],
      [5, 16, 0],
      [5, 24, 0],
    ]),
  );
  const bentRod = keep(profile.sweep(curve));
  assert.ok(volume(bentRod) > 0);
  assert.ok(modelGeometry(bentRod).value.localBounds[1][0] > 5);
  const snapshot = createModelSnapshotter()(bentRod);
  assert.equal(snapshot.operation.kind, 'sweep');
  assert.equal(snapshot.operation.inputs[1].role, 'spine');
  assert.ok(snapshot.mesh?.surfaceGroups.length);
  assert.ok(
    modelGeometry(rod).value.topology.surfaces.ids.some(
      id => Array.isArray(id) && id[0] === 1 && id[1] === 1,
    ),
  );
});

test('sweep preserves a single through hole', () => {
  const profile = keep(
    sketch([
      ['point', 1, [0, 0]],
      ['circle', 2, [1, 5]],
      ['circle', 3, [1, 2]],
    ]).face(),
  );
  const spine = keep(line([0, 10, 0]));
  const pipe = keep(sweep(profile, spine));
  assert.ok(Math.abs(volume(pipe) - 210 * Math.PI) < 1e-3);
});

test('sweep resolves the path placement into the profile frame', () => {
  const profile = keep(circle(2));
  const original = keep(line([5, 0, 0], [5, 12, 0]));
  const placed = keep(
    original.relate(self => align(self.start, profile.origin)),
  );
  const solid = keep(sweep(profile, placed));
  assert.ok(Math.abs(volume(solid) - 48 * Math.PI) < 1e-3);

  const rotated = keep(circle(2).rotate(0, 0, 90));
  const horizontal = keep(line([-12, 0, 0]));
  const turned = keep(rotated.sweep(horizontal));
  assert.ok(Math.abs(volume(turned) - 48 * Math.PI) < 1e-3);
});

test('sweep requires the authored profile frame to meet the path start', () => {
  const profile = keep(circle(2));
  const shifted = keep(line([1, 0, 0], [1, 12, 0]));
  assert.throws(() => sweep(profile, shifted), /origin must coincide/);
  const sideways = keep(line([12, 0, 0]));
  assert.throws(() => profile.sweep(sideways), /normal must point along/);
});
