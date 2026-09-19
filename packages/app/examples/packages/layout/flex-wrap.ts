import {box, group} from '@code3d/core';
import {flex} from '@code3d/layout';

const space = box(46, 2, 54);
const parts = flex(
  [
    box(12, 6, 10),
    box(20, 6, 14),
    box(16, 6, 8),
    box(18, 6, 12),
    box(14, 6, 16),
  ],
  space,
  {
    axis: 'x',
    crossAxis: 'z',
    wrap: true,
    gap: 4,
    rowGap: 3,
    padding: 2,
    crossPadding: 2,
    justifyContent: 'space-between',
    alignItems: 'center',
    alignContent: 'center',
  },
);
export default group(parts, 'Wrapped flex rows');
