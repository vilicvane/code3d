import {
  align,
  box,
  cylinder,
  frame,
  group,
  input,
  rotate,
  union,
} from '@code3d/core';
import {assembleGears, spurGear} from '@code3d/gears';

const driveAngle = input('Drive angle', 0, {min: -1080, max: 1080, step: 1});
const layerSpacing = 12;
// The assembly's fixed coordinate system is independent of its rotating parts.
const base = frame('Assembly frame');

// A shaft and an off-center handle make the input's rotation visible.
const shaft = cylinder(3.5, 36).material('#c5d4da');
// The arm covers the shaft end; the shaft, arm and handle meet at their faces.
const crankReach = 21;
const armEnd = cylinder(4, 3);
const arm = union([
  armEnd,
  box(crankReach, 3, 8).originOffset(-crankReach / 2, 0, 0),
  armEnd.originOffset(-crankReach, 0, 0),
]).originOffset(0, -19.5, 0);
const handle = cylinder(3, 12).originOffset(-crankReach, -27, 0);
export const inputCrank = group(
  [shaft, arm.material('#d49a85'), handle.material('#d49a85')],
  {name: 'Input crank'},
).relate(self => [align(self.frame, base), rotate(0, driveAngle, 0)]);

// Only the external crank reads the input. The pinion follows its frame.
const pinion = spurGear({
  module: 2,
  teeth: 20,
  faceWidth: 10,
  mounting: {kind: 'bore', diameter: 7},
})
  .material('#d49a85')
  .relate(self => align(self.frame, inputCrank.frame));
const middleLarge = spurGear({
  module: 2,
  teeth: 30,
  faceWidth: 10,
  mounting: {kind: 'bore', diameter: 7},
}).material('#d3b46c');
// The taller small gear sits directly on the large gear, sharing its shaft origin.
const middleSmall = spurGear({
  module: 2,
  teeth: 18,
  faceWidth: 14,
  mounting: {kind: 'bore', diameter: 7},
})
  .material('#d3b46c')
  .originOffset(0, -layerSpacing, 0);
const wheel = spurGear({
  module: 2,
  teeth: 40,
  faceWidth: 10,
  mounting: {kind: 'bore', diameter: 7},
}).material('#91aeca');

export const gears = assembleGears(
  [pinion, [middleLarge, middleSmall], wheel],
  {centerDistanceDelta: 0.2},
);

// Raised gears need longer shafts to keep their lower ends at the same height.
const raisedShaft = cylinder(3.5, 36 + layerSpacing)
  .originOffset(0, layerSpacing / 2, 0)
  .material('#c5d4da');
export const middleShaft = raisedShaft
  .originOffset(0, -layerSpacing, 0)
  .relate(self => align(self.frame, gears[1].frame));
export const outputCrank = group(
  [raisedShaft, arm.material('#91aeca'), handle.material('#91aeca')],
  {name: 'Output crank'},
).relate(self => align(self.frame, gears[3].frame));

// Angular changes: input 1×, both middle gears −2/3×, output +3/10×.
export default group([inputCrank, ...gears, middleShaft, outputCrank], {
  name: 'Gear transmission',
  frame: base,
});
