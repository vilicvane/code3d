import {box, cylinder, group, timeOffset, rotate} from '@code3d/core';

// Seconds since playback started. One full turn takes six seconds.
const time = timeOffset();
const angle = (time * 60) % 360;

const base = cylinder(14, 6).material('#536675');
const arm = box(48, 4, 8)
  .originOffset(-20, 0, 0)
  .material('#d3b46c')
  .relate(self => [self.on(base.up), rotate(0, angle, 0)]);

// Select the complete assembly, then press Play below the viewport.
export default group([base, arm], 'Rotating arm');
