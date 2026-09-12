import assert from 'node:assert/strict';
import test from 'node:test';
import * as screws from '@code3d/screws';
import {box, cut} from '@code3d/core';

import {
  keep,
  near,
  y,
  volume,
  headedStandardTests,
  releaseModels,
} from './standard-test.ts';

headedStandardTests(['ISO4762', 'ISO10642', 'ISO4014', 'ISO4017', 'ISO7380_1']);

test('standard subpaths and aggregate exports share the same functions and specifications', async () => {
  for (const [name, standard] of Object.entries(screws)) {
    const subpath = '@code3d/screws/' + name.toLowerCase().replace('_', '-');
    const direct = await import(subpath);
    assert.equal(direct.screw, standard.screw);
    assert.equal(direct.specifications, standard.specifications);
  }
  // @ts-expect-error Private implementation is not a package export.
  await assert.rejects(import('@code3d/screws/common'), {
    code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  });
});

test('ISO head dimensions and partial thread rules differ from DIN and socket caps', () => {
  assert.equal(screws.ISO10642.resolveSpecification('M6').headDiameter, 13.44);
  assert.equal(screws.ISO7380_1.resolveSpecification('M6').headHeight, 3.3);
  assert.equal(screws.ISO4017.resolveSpecification('M10').headWidth, 16);
  assert.equal(screws.ISO4014.resolveSpecification('M12').headWidth, 18);
  const bolt = screws.ISO4014.resolveSpecification('M6');
  assert.equal(screws.ISO4014.threadLength(bolt, 30), 18);
  assert.equal(screws.ISO4014.threadLength(bolt, 150), 24);
  assert.equal(screws.ISO4014.threadLength(bolt, 210), 37);
  assert.equal(screws.ISO4017.threadLength(bolt, 30), 30);
  assert.equal(
    screws.ISO4762.threadLength(screws.ISO4762.resolveSpecification('M6'), 30),
    24,
  );
  const partial = keep(screws.ISO4014.screw('M6', 30));
  const full = keep(screws.ISO4017.screw('M6', 30));
  assert.ok(volume(partial) > volume(full));
});

test('clearance and counterbore references describe the exact cutting geometry', () => {
  const hole = keep(
    screws.ISO7380_1.clearanceHole('M6', {depth: 10, counterbore: true}),
  );
  near(y(hole.shaftTop) - y(hole.shaftBottom), 10);
  near(y(hole.counterboreTop), y(hole.shaftTop));
  near(y(hole.counterboreTop) - y(hole.counterboreBottom), 3.8);
  const plain = keep(screws.ISO4017.clearanceHole('M6', 10));
  assert.equal('counterboreBottom' in plain, false);
  near(volume(plain), Math.PI * 3.3 ** 2 * 10);
});

test('all ordinary counterbore standards accept custom recess diameter and depth', () => {
  const {ISO10642, ISO4029, ISO7379, ...standards} = screws;
  for (const standard of Object.values(standards)) {
    const clearanceHole: (
      size: 'M6',
      options: screws.ISO7380_1.CounterboredHoleOptions,
    ) => screws.ISO7380_1.CounterboredHole = standard.clearanceHole;
    const diameter = standard.resolveSpecification('M6').headDiameter + 2;
    const hole = keep(
      clearanceHole('M6', {
        depth: 12,
        counterbore: {diameter, depth: 3},
      }),
    );
    near(volume(hole), Math.PI * (3.3 ** 2 * 9 + (diameter / 2) ** 2 * 3));
    near(y(hole.counterboreTop) - y(hole.counterboreBottom), 3);
    near(y(hole.shaftTop) - y(hole.shaftBottom), 12);
    releaseModels();
  }
});

test('countersunk screws seat flush through named references without intersecting the plate', () => {
  const hole = keep(screws.ISO10642.clearanceHole('M6', 10));
  const screw = keep(
    screws.ISO10642.screw('M6', 20).relate(part =>
      part.headTop.on(hole.countersinkTop),
    ),
  );
  const stock = keep(box(30, 10, 30));
  const plate = keep(cut(stock, [hole]));
  const afterScrew = keep(cut(plate, [screw]));
  near(volume(afterScrew), volume(plate));
  near(y(hole.countersinkTop), y(hole.shaftTop));
  near(y(hole.countersinkTop) - y(hole.countersinkBottom), (13.94 - 6.6) / 2);
  const plain = keep(
    screws.ISO10642.clearanceHole('M6', {depth: 2, countersink: false}),
  );
  assert.equal('countersinkTop' in plain, false);
  assert.throws(
    () => screws.ISO10642.clearanceHole('M6', 1),
    /Countersink depth/,
  );
  assert.throws(() => screws.ISO10642.screw('M6', 3), /length/i);
});

test('invalid custom head, recess and hole dimensions fail before producing models', () => {
  assert.throws(
    () =>
      screws.ISO10642.screw(
        {...screws.ISO10642.specifications.M6, headHeight: 4},
        20,
      ),
    /90-degree/,
  );
  assert.throws(
    () =>
      screws.ISO7380_2.screw(
        {...screws.ISO7380_2.specifications.M6, collarHeight: 4},
        20,
      ),
    /collar/,
  );
  assert.throws(
    () =>
      screws.ISO7045.screw(
        {...screws.ISO7045.specifications.M6, headCurvatureRadius: 1},
        20,
      ),
    /curvature/,
  );
  assert.throws(
    () =>
      screws.ISO14583.screw(
        {
          ...screws.ISO14583.specifications.M6,
          recess: {...screws.ISO14583.specifications.M6.recess, depth: 10},
        },
        20,
      ),
    /Recess/,
  );
  assert.throws(
    () =>
      screws.ISO4017.clearanceHole('M6', {
        depth: 10,
        counterbore: {axialClearance: -1},
      }),
    /Axial clearance/,
  );
  assert.throws(
    () => screws.ISO4014.clearanceHole('M6', {depth: 10, diameter: 6}),
    /exceed/,
  );
});
