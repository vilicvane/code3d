import {box, cylinder, group, input, rotate} from '@code3d/core';
import {assembleGears, spurGear} from '@code3d/gears';

const driveAngle = input('Drive angle', 0, {min: -1080, max: 1080, step: 1});
const plate = box(210, 6, 100).originOffset(-70, 21, 0).material('#536675');

// A shaft and an off-center handle make the input's rotation visible.
const shaft = cylinder(3.5, 36).material('#c5d4da');
const arm = box(26, 3, 6).originOffset(-10, -18, 0);
const handle = cylinder(3, 12).originOffset(-21, -25.5, 0);
export const inputCrank = group(
  [shaft, arm.material('#d49a85'), handle.material('#d49a85')],
  'Input crank',
).relate(self => [self.frame.align(plate.frame), rotate(0, driveAngle, 0)]);

// Only the external crank reads the input. The pinion follows its frame.
const pinion = spurGear({
  module: 2,
  teeth: 20,
  faceWidth: 10,
  mounting: {kind: 'bore', diameter: 7},
})
  .material('#d49a85')
  .relate(self => self.frame.align(inputCrank.frame));
const middle = spurGear({
  module: 2,
  teeth: 30,
  faceWidth: 10,
  mounting: {kind: 'bore', diameter: 7},
}).material('#d3b46c');
const wheel = spurGear({
  module: 2,
  teeth: 40,
  faceWidth: 10,
  mounting: {kind: 'bore', diameter: 7},
}).material('#91aeca');

export const gears = assembleGears([pinion, middle, wheel], {
  centerDistanceDelta: 0.2,
});
export const middleShaft = group(
  [shaft, arm.material('#d3b46c')],
  'Middle shaft',
).relate(self => self.frame.align(gears[1].frame));
export const outputCrank = group(
  [shaft, arm.material('#91aeca'), handle.material('#91aeca')],
  'Output crank',
).relate(self => self.frame.align(gears[2].frame));

// Angular changes: input 1×, middle −2/3×, output +1/2×.
export default group(
  [plate, inputCrank, ...gears, middleShaft, outputCrank],
  'Gear transmission',
);
