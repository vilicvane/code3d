import {sketch} from '@code3d/core';

const width = 30;

// Select either binding to open the sketch editor. Point 2 follows width;
// its coordinates remain expressions, while literal points can be dragged.
export const sketch1 = sketch([
  ['point', 1, [0, 0]],
  ['point', 2, [width, 0]],
  ['point', 3, [30, 20]],
  ['line', 4, [1, 2]],
  ['line', 5, [2, 3]],
]);

// Upstream geometry is visible and locked. IDs in this layer start afresh;
// cross-layer endpoints name the sketch that owns the point.
export const sketch2 = sketch1.derive([
  ['point', 1, [0, 20]],
  ['line', 2, [sketch1.point(3), 1]],
  ['line', 3, [1, sketch1.point(1)]],
]);
