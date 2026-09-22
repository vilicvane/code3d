import {box, group} from '@code3d/core';
import {flex, fillFlex, repeat} from '@code3d/layout';

const space = box(100, 2, 36).originOffset(-50, 0, 0);
const slat = box(10, 20, 4).originOffset(0, -11, 0);

// Six slats: left clearance 5, right flush, internal clearances 7.
const counted = flex(repeat(slat.originOffset(0, 0, 10), 6), space, {
  axis: 'x',
  padding: {start: 5, end: 0},
  justifyContent: 'space-between',
});

// Pack complete slats at gap 5, then align the row to the right edge.
// Six fit; the unused width joins the left clearance, making it 15.
const packed = fillFlex(slat.originOffset(0, 0, -10), space, {
  axis: 'x',
  gap: 5,
  padding: {start: 5, end: 0},
  justifyContent: 'end',
});

export default group(
  [
    space.material('#526273'),
    group(counted, {name: 'Count and equal gaps'}).material('#8ed5d1'),
    group(packed, {name: 'Fixed gap and right alignment'}).material('#e6b968'),
  ],
  {name: 'Grille layouts'},
);
