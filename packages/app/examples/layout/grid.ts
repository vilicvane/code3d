import {cylinder, group} from '@code3d/core';
import {grid, repeat} from '@code3d/layout';

const pins = grid(repeat(cylinder(3, 10), 12), {
  columns: 4,
  axes: ['x', 'z'],
  gap: 8,
});
export default group(pins, 'Grid of pins');
