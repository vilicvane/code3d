import {
  assembleGears,
  helicalGear,
  internalGear,
  nominalCenterDistance,
  spurGear,
} from '@code3d/gears';
import type {
  Gear,
  GearAssemblyEntry,
  GearAssemblyConfig,
  GearPairConfig,
  Mounting,
} from '@code3d/gears';
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
spur.gearCenter;
spur.gearFaceUp;
spur.gearFaceDown;
const pairConfig: GearPairConfig = {angle: 60};
const assemblyConfig: GearAssemblyConfig = {
  centerDistanceDelta: 0.2,
  pairs: [pairConfig],
};
const pair: Gear[] = assembleGears(
  [spur, spurGear({module: 2, teeth: 20, faceWidth: 10})],
  assemblyConfig,
);
const centerDistance: number = nominalCenterDistance(pair[0], pair[1]);
const compound: GearAssemblyEntry = [spur, spur.originOffset(0, -12, 0)];
const compoundTrain: Gear[] = assembleGears([spur.scaled(2), compound, spur]);
void compoundTrain;
// @ts-expect-error Compound shafts have exactly two gears.
assembleGears([[spur, spur, spur]]);
// @ts-expect-error A one-member tuple is not a compound shaft.
assembleGears([[spur]]);
void centerDistance;
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
