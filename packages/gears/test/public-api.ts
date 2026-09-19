import {helicalGear, internalGear, spurGear} from '@code3d/gears';
import type {Gear, Mounting} from '@code3d/gears';
import type {SolidModel} from '@code3d/core';

const mounting: Mounting = {
  kind: 'bore',
  diameter: 8,
  keyway: {width: 2, depth: 1},
};
const spur: Gear = spurGear({module: 2, teeth: 24, faceWidth: 10, mounting});
const helical: SolidModel = helicalGear({
  normalModule: 2,
  teeth: 24,
  faceWidth: 10,
  helixAngle: 20,
  hand: 'right',
});
const ring: SolidModel = internalGear({
  module: 2,
  teeth: 48,
  faceWidth: 10,
  outerDiameter: 130,
});
spur.gearAxis;
spur.gearFaceUp;
spur.gearFaceDown;
void helical;
void ring;

const invalid: Mounting = {
  kind: 'shaft',
  diameter: 8,
  upExtension: 12,
  downExtension: 12,
  // @ts-expect-error Integral shafts cannot also receive a bore keyway.
  keyway: {width: 2, depth: 1},
};
void invalid;
