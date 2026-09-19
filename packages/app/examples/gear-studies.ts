import {group} from '@code3d/core';
import {helicalGear, internalGear, spurGear} from '@code3d/gears';

// Complete nominal parts from the public gear library. Tooth roots and flanks
// are modeled for layout and visualization, not tolerance or strength approval.
export const spurWithBore = spurGear({
  module: 2,
  teeth: 24,
  faceWidth: 10,
  mounting: {kind: 'bore', diameter: 8},
  standards: {toothProfile: 'ISO53', moduleSeries: 'ISO54'},
})
  .material('#91aeca')
  .originOffset(110, 0, 45);

export const spurWithKeyedHub = spurGear({
  module: 2,
  teeth: 22,
  faceWidth: 10,
  mounting: {
    kind: 'bore',
    diameter: 8,
    keyway: {width: 2.4, depth: 1.2},
    hub: {diameter: 22, length: 6, side: 'up'},
  },
})
  .material('#d3b46c')
  .originOffset(0, 0, 45);

export const spurWithShaft = spurGear({
  module: 2,
  teeth: 18,
  faceWidth: 9,
  mounting: {
    kind: 'shaft',
    diameter: 7,
    upExtension: 13,
    downExtension: 16,
  },
})
  .material('#d49a85')
  .originOffset(-110, 0, 45);

export const helicalWithHub = helicalGear({
  normalModule: 2,
  teeth: 22,
  faceWidth: 12,
  helixAngle: 20,
  hand: 'right',
  mounting: {
    kind: 'bore',
    diameter: 9,
    hub: {diameter: 20, length: 5, side: 'up'},
  },
})
  .material('#83bba6')
  .originOffset(60, 0, -100);

export const internalRingWithBoltHoles = internalGear({
  module: 2,
  teeth: 48,
  faceWidth: 10,
  outerDiameter: 130,
  boltPattern: {count: 6, circleDiameter: 116, holeDiameter: 3},
})
  .material('#b9a9cc')
  .originOffset(-60, 0, -100);

export default group(
  [
    spurWithShaft,
    spurWithKeyedHub,
    spurWithBore,
    internalRingWithBoltHoles,
    helicalWithHub,
  ],
  'Gear types and mounting choices',
);
