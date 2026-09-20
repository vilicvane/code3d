import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  box,
  font,
  group,
  line,
  originCenter,
  point,
  rectangle,
  regularPrism,
  rotate,
  sphere,
  text,
  wrap,
  extrude,
  type Model,
} from '../bld/node/index.js';
import {clearKernelOperationCache} from '../bld/tooling/index.js';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';

const models: Model[] = [];
const keep = <T extends Model>(value: T): T => {
  models.push(value);
  return value;
};
const keepAll = <T extends Model>(values: readonly T[]) => values.map(keep);
const near = (actual: readonly number[], expected: readonly number[]) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );
};
const center = (model: Model) => {
  const {minimum, maximum} = model.bounds();
  return minimum.map((v, i) => (v + maximum[i]) / 2);
};
afterEach(() => {
  disposeModelObjects(models.splice(0));
  clearKernelOperationCache();
});

test('single values and singleton arrays match the instance operation, including placement', () => {
  const base = keep(box(20, 4, 20).originOffset(-8, 0, 0));
  const source = keep(
    regularPrism(6, 2, 3)
      .rotate(0, 45, 0)
      .relate(self => self.on(base.up)),
  );
  const direct = keep(source.originCenter());
  for (const actual of [
    keep(originCenter(source)),
    ...keepAll(originCenter([source])),
  ]) {
    near(actual.bounds().minimum, direct.bounds().minimum);
    near(actual.bounds().maximum, direct.bounds().maximum);
    near(actual.position(base), direct.position(base));
    near(center(actual), [0, 0, 0]);
    assert.equal(modelGeometry(actual).id, modelGeometry(direct).id);
  }
});

test('batch centering preserves text islands, spacing, topology and downstream face operations', async () => {
  const profiles = keepAll(
    text(
      'B8i',
      await font(new URL('./fonts/DejaVuSans.ttf', import.meta.url)),
      10,
    ),
  );
  const layout = keep(group(profiles));
  const original = profiles.map(p => p.bounds());
  const shift = center(layout);
  const centered = keepAll(originCenter(profiles));
  assert.equal(centered.length, profiles.length);
  near(center(keep(group(centered))), [0, 0, 0]);
  const snapshot = createModelSnapshotter();
  centered.forEach((profile, i) => {
    near(
      profile.bounds().minimum,
      original[i].minimum.map((v, axis) => v - shift[axis]),
    );
    near(
      profile.bounds().maximum,
      original[i].maximum.map((v, axis) => v - shift[axis]),
    );
    near(profiles[i].bounds().minimum, original[i].minimum);
    assert.equal(profile.area, profiles[i].area);
    assert.deepEqual(
      snapshot(profile).mesh!.vertexIds,
      snapshot(profiles[i]).mesh!.vertexIds,
    );
  });
  const repeated = keepAll(originCenter(centered));
  repeated.forEach((p, i) =>
    near(p.bounds().minimum, centered[i].bounds().minimum),
  );
  keepAll(extrude(centered, 1));
  const target = keep(sphere(30));
  const positioned = keepAll(centered.map(p => p.originOffset(0, -35, 0)));
  assert.equal(
    keepAll(wrap(positioned, target.surface(1))).length,
    profiles.length,
  );
});

test('batch centering resolves member placements and frames once without changing their layout', () => {
  const reference = keep(box(2, 2, 2));
  const base = keep(
    box(8, 4, 6)
      .rotate(0, 25, 0)
      .relate(self => [self.frame.align(reference.frame), rotate(0, 40, 0)]),
  );
  const second = keep(rectangle(3, 5).relate(self => self.on(base.up)));
  const third = keep(box(2, 3, 4).relate(self => self.frame.align(base.frame)));
  const source = [base, second, third] as const;
  const assembly = keep(group(source));
  const shift = center(assembly);
  const original = source.map(m => m.bounds(assembly));
  const centered = keepAll(originCenter(source));
  centered.forEach((m, i) => {
    near(
      m.bounds().minimum,
      original[i].minimum.map((v, axis) => v - shift[axis]),
    );
    near(
      m.bounds().maximum,
      original[i].maximum.map((v, axis) => v - shift[axis]),
    );
  });
  near(center(keep(group(centered))), [0, 0, 0]);
  source.forEach((m, i) =>
    near(m.bounds(assembly).minimum, original[i].minimum),
  );
});

test('centering supports degenerate finite bounds, repeated inputs and empty arrays', () => {
  const p = keep(point([4, 5, 6]));
  near(center(keep(originCenter(p))), [0, 0, 0]);
  const curve = keep(line([1, 2, 3], [7, 8, 9]));
  near(center(keep(originCenter(curve))), [0, 0, 0]);
  const repeated = keepAll(originCenter([p, p]));
  assert.equal(repeated.length, 2);
  assert.notEqual(repeated[0], repeated[1]);
  repeated.forEach(v => near(center(v), [0, 0, 0]));
  assert.deepEqual(originCenter([]), []);
  const empty = keep(group([]));
  assert.throws(
    () => originCenter(empty as unknown as typeof p),
    /requires geometry/,
  );
});
