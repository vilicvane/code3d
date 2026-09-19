import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  box,
  line,
  arc,
  circle,
  rectangle,
  tube,
  sphere,
  cylinder,
  point,
  group,
  offset,
  rotate,
  type Model,
} from '@code3d/core';
import {clearKernelOperationCache} from '@code3d/core/tooling';
import {createModelSnapshotter, disposeModelObjects} from './model-test.ts';
const models: Model[] = [];
const keep = <T extends Model>(model: T): T => (models.push(model), model);
afterEach(() => {
  disposeModelObjects(models.splice(0));
  clearKernelOperationCache();
});
const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 1e-5, `${actual} != ${expected}`),
  );

test('bounds and positions distinguish local geometry, model origins and solved placement', () => {
  const frame = keep(group([]));
  const solid = keep(
    box(2, 4, 6)
      .originOffset(3, 0, 0)
      .relate(() => [rotate(0, 0, 90), offset(10, 20, 30)]),
  );
  near(solid.bounds().minimum, [-4, -2, -3]);
  near(solid.bounds().maximum, [-2, 2, 3]);
  near(solid.bounds(frame).minimum, [8, 16, 27]);
  near(solid.bounds(frame).size, [4, 2, 6]);
  near(solid.position(frame), [10, 20, 30]);
  near(solid.position(solid), [0, 0, 0]);
  const p = keep(point([4, 5, 6]));
  near(p.bounds().minimum, [4, 5, 6]);
  near(p.position(frame), [0, 0, 0]);
});

test('queries preserve group occurrence frames and reject ambiguous repeated sources', () => {
  const a = keep(box(2, 4, 6));
  const b = keep(box(4, 2, 6).relate(() => offset(10, 0, 0)));
  const pair = keep(group([a, b]).rotate(0, 0, 90).originOffset(3, 4, 5));
  near(b.position(pair), [-3, 6, -5]);
  near(b.bounds(pair).minimum, [-4, 4, -8]);
  const repeated = keep(group([a, a]));
  assert.throws(() => a.bounds(repeated), /multiple occurrences/);
  assert.throws(() => a.position(repeated), /multiple occurrences/);
  assert.throws(() => keep(group([])).bounds(), /Empty geometry/);
});

test('rotated curved models use tight geometry bounds rather than rotated bounding-box corners', () => {
  const solid = keep(cylinder(5, 8).relate(() => rotate(0, 45, 0)));
  const frame = keep(group([]));
  near(solid.bounds(frame).size, [10, 8, 10]);
  const scene = keep(group([frame, solid]));
  const snapshot = createModelSnapshotter()(scene);
  assert.equal(snapshot.children.length, 2);
  near(scene.bounds().size, [10, 8, 10]);
});

test('measurement method names follow the existing exposed-element collision rules', () => {
  const solid = keep(box(2, 4, 6));
  for (const name of ['bounds', 'position']) {
    assert.throws(
      () => solid.expose({[name]: solid.up}),
      /conflicts with the model API/,
    );
  }
  near(solid.bounds().size, [2, 4, 6]);
});

test('finite edge length uses arc length and follows geometry and exposed reference scaling', () => {
  const straight = keep(line([3, 4, 0]));
  near(
    [straight.length, straight.edges()[0].length, straight.reverse().length],
    [5, 5, 5],
  );
  const curved = keep(arc([10, 0, 0], [0, 10, 0], [-10, 0, 0]));
  near([curved.length], [10 * Math.PI]);
  const closed = keep(circle(10)).edges()[0];
  near([closed.length], [20 * Math.PI]);
  const transformed = keep(
    curved.originOffset(3, 4, 5).rotate(32, 47, 11).scaled(2),
  );
  near(
    [transformed.length, transformed.edges()[0].length],
    [20 * Math.PI, 20 * Math.PI],
  );
  const body = keep(box(2, 3, 4));
  const original = body.edge(1);
  const exposed = keep(
    body.expose({selected: original}).scaled(3).rotate(12, 34, 56),
  );
  near([exposed.selected.length], [original.length * 3]);
  const assembly = keep(group([transformed]).expose({curve: transformed}));
  near([assembly.curve.length], [transformed.length]);
  near([curved.length, original.length], [10 * Math.PI, body.edge(1).length]);
});

test('area measures trimmed and curved surfaces and the whole boundary of solids', () => {
  const face = keep(rectangle(4, 6));
  const annulus = keep(tube(10, 6, 8));
  const ball = keep(sphere(10));
  near([face.area, face.surfaces()[0].area, face.flip().area], [24, 24, 24]);
  near([ball.area], [400 * Math.PI]);
  const expected = 2 * Math.PI * (10 + 6) * 8 + 2 * Math.PI * (100 - 36);
  near(
    [
      annulus.area,
      annulus.surfaces().reduce((sum, face) => sum + face.area, 0),
    ],
    [expected, expected],
  );
  const changed = keep(
    annulus
      .expose({wall: annulus.surface(1)})
      .scaled(2)
      .rotate(15, 25, 35)
      .originOffset(3, 7, 9),
  );
  near(
    [changed.area, changed.wall.area],
    [expected * 4, annulus.surface(1).area * 4],
  );
  const assembly = keep(group([changed]).expose({body: changed}));
  near([assembly.body.area], [changed.area]);
});

test('volume excludes holes and cavities and follows cubic scaling of exposed solids', () => {
  const solid = keep(box(2, 3, 4));
  const ball = keep(sphere(3));
  const pipe = keep(tube(5, 3, 7));
  const outer = keep(box(10, 10, 10));
  const cavity = keep(box(6, 6, 6));
  const hollow = keep(outer.cut([cavity]));
  near(
    [solid.volume, ball.volume, pipe.volume, hollow.volume],
    [24, 36 * Math.PI, 112 * Math.PI, 784],
  );
  const changed = keep(
    solid
      .expose({original: solid})
      .scaled(2)
      .rotate(17, 29, 43)
      .originOffset(3, 7, 11)
      .relate(() => offset(100, 200, 300)),
  );
  near([changed.volume, changed.original.volume, solid.volume], [192, 192, 24]);
  const assembly = keep(
    group([changed])
      .expose({body: changed})
      .rotate(0, 90, 0)
      .originOffset(5, 8, 13),
  );
  near([assembly.body.volume, keep(hollow.scaled(0.5)).volume], [192, 98]);
});
