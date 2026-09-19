import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {replicad} from '@code3d/core/replicad';
import {
  disposeModelObjects,
  modelGeometry,
} from '../../core/test/model-test.ts';
import {helicalGear, internalGear, spurGear} from '../src/library/index.ts';
import {resolveToothDimensions} from '../src/library/specification.ts';
import type {Gear} from '../src/library/index.ts';

const models: Gear[] = [];
after(() => disposeModelObjects(models));
const keep = (gear: Gear) => (models.push(gear), gear);
const volume = (gear: Gear) =>
  replicad.measureVolume(modelGeometry(gear).value.shape.asShape3D());

test('external gears produce complete bore, keyway, hub and shaft solids', () => {
  const plain = keep(
    spurGear({module: 2, teeth: 24, faceWidth: 10, mounting: {kind: 'solid'}}),
  );
  const bored = keep(
    spurGear({
      module: 2,
      teeth: 24,
      faceWidth: 10,
      mounting: {kind: 'bore', diameter: 8},
    }),
  );
  const hub = {diameter: 20, length: 6, side: 'up' as const};
  const hubbed = keep(
    spurGear({
      module: 2,
      teeth: 24,
      faceWidth: 10,
      mounting: {kind: 'bore', diameter: 8, hub},
    }),
  );
  const keyed = keep(
    spurGear({
      module: 2,
      teeth: 24,
      faceWidth: 10,
      mounting: {
        kind: 'bore',
        diameter: 8,
        hub,
        keyway: {width: 2.4, depth: 1.2},
      },
    }),
  );
  const shafted = keep(
    spurGear({
      module: 2,
      teeth: 24,
      faceWidth: 10,
      mounting: {
        kind: 'shaft',
        diameter: 7,
        upExtension: 13,
        downExtension: 16,
      },
    }),
  );

  assert.ok(volume(plain) > volume(bored));
  assert.ok(volume(hubbed) > volume(bored));
  assert.ok(volume(hubbed) > volume(keyed));
  assert.ok(volume(shafted) > volume(plain));
  assert.ok(Math.abs(plain.bounds().size[0] - 52) < 0.01);
  assert.ok(Math.abs(shafted.bounds().size[1] - 39) < 0.01);
  assert.ok(shafted.gearAxis);
  assert.ok(shafted.gearFaceUp);
  assert.ok(shafted.gearFaceDown);
});

test('helical normal module and hand produce full solids', () => {
  const common = {
    normalModule: 2,
    teeth: 22,
    faceWidth: 12,
    helixAngle: 20,
    mounting: {kind: 'bore', diameter: 9} as const,
  };
  const right = keep(helicalGear({...common, hand: 'right'}));
  const left = keep(helicalGear({...common, hand: 'left'}));
  assert.ok(volume(right) > 0);
  assert.ok(Math.abs(volume(right) - volume(left)) < 0.1);
  assert.ok(right.bounds().size[1] >= 11.99);
});

test('internal tooth ring and bolt pattern remove distinct volumes', () => {
  const common = {
    module: 2,
    teeth: 48,
    faceWidth: 10,
    outerDiameter: 130,
  };
  const plain = keep(internalGear(common));
  const bolted = keep(
    internalGear({
      ...common,
      boltPattern: {count: 6, circleDiameter: 116, holeDiameter: 3},
    }),
  );
  assert.ok(volume(plain) > volume(bolted));
  assert.ok(Math.abs(plain.bounds().size[0] - 130) < 0.01);
  assert.ok(bolted.gearAxis);
});

test('standards and dimensions reject unsupported nominal parts', () => {
  const base = {module: 2, teeth: 24, faceWidth: 10};
  keep(spurGear({...base, module: 1.125, standards: {moduleSeries: 'ISO54'}}));
  const spur = resolveToothDimensions('external', 2, 24, 10, 0);
  assert.equal(spur.pitchRadius, 24);
  assert.equal(spur.tipRadius, 26);
  assert.equal(spur.rootRadius, 21.5);
  const helical = resolveToothDimensions('external', 2, 24, 10, 20);
  assert.ok(
    Math.abs(helical.transverseModule - 2 / Math.cos((20 * Math.PI) / 180)) <
      1e-10,
  );
  const internal = resolveToothDimensions('internal', 2, 48, 10, 0);
  assert.equal(internal.tipRadius, 46);
  assert.equal(internal.rootRadius, 50.5);
  assert.throws(
    () => spurGear({...base, module: 0.8, standards: {moduleSeries: 'ISO54'}}),
    /outside ISO54/,
  );
  assert.throws(() => spurGear({...base, teeth: 12}), /at least 18/);
  assert.throws(
    () =>
      helicalGear({
        normalModule: 2,
        teeth: 24,
        faceWidth: 10,
        helixAngle: 0,
        hand: 'right',
      }),
    /positive helix angle/,
  );
  assert.throws(
    () =>
      spurGear({
        ...base,
        mounting: {kind: 'bore', diameter: 8, keyway: {width: 2, depth: 25}},
      }),
    /Keyway must fit/,
  );
  assert.throws(
    () =>
      internalGear({
        module: 2,
        teeth: 48,
        faceWidth: 10,
        outerDiameter: 104,
        boltPattern: {count: 6, circleDiameter: 100, holeDiameter: 6},
      }),
    /Bolt holes must fit/,
  );
});
