import {sketch} from '@code3d/core';

// A constrained rectangular plate with a movable hole.
// Drag the free height; horizontal/vertical edges and the hole radius stay fixed.
export const profile = sketch(
  [
    ['point', 1, [0, 0]],
    ['point', 2, [40, 0]],
    ['point', 3, [40, 25]],
    ['point', 4, [0, 25]],
    ['line', 5, [1, 2]],
    ['line', 6, [2, 3]],
    ['line', 7, [3, 4]],
    ['line', 8, [4, 1]],
    ['point', 9, [20, 12.5]],
    ['circle', 10, [9, 4]],
  ],
  {
    constraints: [
      ['fixed', 1],
      ['horizontal', 5],
      ['horizontal', 7],
      ['vertical', 6],
      ['vertical', 8],
      ['length', 5, 40],
      ['radius', 10, 4],
    ],
  },
);

export default profile.face().extrude(3).material('#8ed5d1');
