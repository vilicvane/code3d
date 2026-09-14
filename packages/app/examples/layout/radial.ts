import {box, group} from '@code3d/core';
import {radial, repeat} from '@code3d/layout';

const fins = radial(repeat(box(12, 8, 3), 12), {
  radius: 30,
  axis: 'y',
  rotate: true,
});
export default group(fins, 'Radial fins');
