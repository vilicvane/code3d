import {box, cylinder, group} from '@code3d/core';
import {flex} from '@code3d/layout';

const parts = flex([box(12, 6, 16), cylinder(5, 14), box(20, 10, 12)], {
  axis: 'y',
  gap: 4,
  crossAxis: 'x',
  alignItems: 'center',
});
export default group(parts, {name: 'Flex with clearances'});
