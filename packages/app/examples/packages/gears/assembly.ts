import {box, group} from '@code3d/core';
import {assembleGears, spurGear} from '@code3d/gears';

const pinion = spurGear({
  module: 2,
  teeth: 20,
  faceWidth: 10,
  mounting: {kind: 'shaft', diameter: 7, upExtension: 8, downExtension: 0},
}).material('#d49a85');

const wheel = spurGear({
  module: 2,
  teeth: 30,
  faceWidth: 10,
  mounting: {
    kind: 'bore',
    diameter: 10,
    hub: {diameter: 22, length: 5, side: 'up'},
  },
}).material('#d3b46c');

const idler = spurGear({
  module: 2,
  teeth: 20,
  faceWidth: 10,
  mounting: {kind: 'bore', diameter: 8},
}).material('#91aeca');

// Turning 60° at the wheel leaves a 120° included angle; use -60 to mirror it.
export const gears = assembleGears([pinion, wheel, idler], {
  centerDistanceDelta: 0.2,
  pairs: [{}, {angle: 60}],
});

const mountingPlate = box(160, 4, 120)
  .originOffset(-35, 0, -20)
  .material('#536675');
export const train = group(gears, 'Three-gear train').relate(self =>
  self.on(mountingPlate.up),
);

export default group([mountingPlate, train], 'Mounted gear train');
