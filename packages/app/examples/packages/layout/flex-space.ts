import {box, group} from '@code3d/core';
import {flex} from '@code3d/layout';

const space = box(72, 20, 12);
const parts = flex([box(8, 12, 12), box(16, 20, 12), box(12, 16, 12)], space, {
  axis: 'x',
  crossAxis: 'y',
  alignItems: 'start',
  justifyContent: 'space-between',
});
export default group(parts, 'Equal clearances inside a space');
