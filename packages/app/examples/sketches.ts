import {sketch} from '@code3d/core';

const width = 30;

// Current geometry is separate from constraints. The explicit width stays
// fixed; drag point 3 to change the unconstrained height, or edit width in code.
export const sketch1 = sketch(
  [
    ['point', 1, [0, 0]],
    ['point', 2, [30, 0]],
    ['point', 3, [30, 20]],
    ['line', 4, [1, 2]],
    ['line', 5, [2, 3]],
  ],
  {
    constraints: [
      ['fixed', 1],
      ['horizontal', 4],
      ['vertical', 5],
      ['length', [4, width]],
    ],
  },
);

// Upstream geometry is visible and locked. IDs in this layer start afresh;
// cross-layer endpoints name the sketch that owns the point.
export const sketch2 = sketch1.derive(
  [
    ['point', 1, [0, 20]],
    ['line', 2, [sketch1.point(3), 1]],
    ['line', 3, [1, sketch1.point(1)]],
  ],
  {
    constraints: [
      ['horizontal', 2],
      ['vertical', 3],
    ],
  },
);
