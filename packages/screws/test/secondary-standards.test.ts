import assert from 'node:assert/strict';
import test from 'node:test';
import * as screws from '@code3d/screws';
import {cut, cylinder} from '@code3d/core';
import {modelGeometry} from '../../core/test/model-test.ts';

import {
  keep,
  near,
  y,
  volume,
  headedStandardTests,
  releaseModels,
} from './standard-test.ts';
const {ISO4029} = screws;

headedStandardTests(['ISO7045', 'ISO7380_2']);

test('ISO 7380-2 collar is included in head height and hole diameter', () => {
  const spec = screws.ISO7380_2.resolveSpecification('M6');
  assert.equal(spec.headDiameter, 13.6);
  assert.equal(spec.buttonDiameter, 10);
  const screw = keep(screws.ISO7380_2.screw('M6', 18));
  near(y(screw.headTop) - y(screw.headBottom), 3.3);
});

test('ISO 4029 has an open cup, a separate socket and overall length datums', () => {
  for (const size of ['M3', 'M6', 'M12'] as const) {
    const spec = ISO4029.resolveSpecification(size);
    const screw = keep(ISO4029.screw(size, 12));
    near(y(screw.driveTop) - y(screw.pointBottom), 12);
    assert.ok(volume(screw) > 0);
    assert.equal('headBottom' in screw, false);
    const cupProbe = keep(
      cylinder(spec.cupDiameter / 10, spec.cupDiameter / 20).originOffset(
        0,
        -y(screw.pointBottom) - spec.cupDiameter / 20,
        0,
      ),
    );
    near(volume(keep(cut(screw, [cupProbe]))), volume(screw));
    const coreProbe = keep(cylinder(spec.nominalDiameter / 10, spec.pitch / 4));
    assert.ok(volume(keep(cut(screw, [coreProbe]))) < volume(screw));
    assert.throws(() => ISO4029.screw(size, spec.hexSocketDepth), /separate/);
    releaseModels();
  }
});

test('ISO 7045 H and Z recesses change the geometry and keep nominal head dimensions', () => {
  const h = keep(screws.ISO7045.screw('M3', 10));
  const z = keep(screws.ISO7045.screw('M3', 10, {recess: 'Z'}));
  assert.notEqual(modelGeometry(h).id, modelGeometry(z).id);
  assert.notEqual(volume(h), volume(z));
  near(y(h.headTop) - y(h.headBottom), 2.4);
  near(y(z.headTop) - y(z.headBottom), 2.4);
  assert.equal(screws.ISO7045.resolveSpecification('M3').headDiameter, 5.6);
  assert.equal(screws.ISO7045.resolveSpecification('M5').headHeight, 3.7);
});
