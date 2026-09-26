import {sketch} from '@code3d/core';

const holeRadius = 8;

// Change holeRadius: both holes resize and the lower one stays tangent to a guide.
// Equal sloping sides keep the plate symmetric; the construction line locates
// both hole centers without becoming a face boundary.
export const profile = sketch(
  [
    ['point', 1, [0, 0]],
    ['point', 2, [60, 0]],
    ['point', 3, [30, 60]],
    ['line', 4, [1, 2]],
    ['line', 5, [2, 3]],
    ['line', 6, [3, 1]],
    ['point', 7, [30, 12]],
    ['circle', 8, [7, 8]],
    ['point', 9, [30, 0]],
    ['aux:line', 10, [9, 3]],
    ['point', 11, [30, 30]],
    ['circle', 12, [11, 8]],
    ['point', 13, [0, 4]],
    ['point', 14, [60, 4]],
    ['aux:line', 15, [13, 14]],
  ],
  {
    constraints: [
      ['fixed', 1],
      ['horizontal', 4],
      ['length', 4, 60],
      ['y', 3, 60],
      ['equalLength', [5, 6]],
      ['midpoint', [9, 1, 2]],
      ['radius', 8, holeRadius],
      ['equalRadius', [8, 12]],
      ['pointOn', [7, 10]],
      ['pointOn', [11, 10]],
      ['y', 11, 30],
      ['fixed', 13],
      ['fixed', 14],
      ['tangent', [15, 8]],
    ],
  },
);

export default profile.face().extrude(3).material('#8ed5d1');
