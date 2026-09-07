import {sketch} from '@code3d/core';

const width = 30;

// Arc references center/start/end, with explicit direction (ccw or cw).
// Drag either endpoint through 180 degrees; the radius constraint stays true.
// Arc tool: center, start/radius, end; R reverses the preview direction.
export const arcs = sketch(
  [
    ['point', 1, [0, 0]],
    ['point', 2, [15, 0]],
    ['point', 3, [0, 15]],
    ['arc', 4, [1, 2, 3, 'ccw']],
  ],
  {
    constraints: [
      ['fixed', 1],
      ['radius', [4, 15]],
    ],
  },
);

// Circle uses an ordinary center point and a current radius. Drag its edge to
// resize, or its center to move it. Entering a radius in the drawing tool adds
// a separate radius constraint, just like the constrained concentric circle.
export const circles = sketch(
  [
    ['point', 1, [0, 0]],
    ['circle', 2, [1, 15]],
    ['circle', 3, [1, 8]],
  ],
  {constraints: [['radius', [3, 8]]]},
);

// Current geometry is separate from constraints. The explicit width stays
// fixed; drag point 3 to change the unconstrained height, or edit width in code.
// Hover constraint markers to highlight their geometry; Constraints toggles them.
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

// Rectangle creates the same ordinary points, lines and direction constraints.
// Entered Width/Height become length constraints; blank dimensions remain free.
// Here only width is constrained: select rectangle and drag point 3 to resize height.
export const rectangle = sketch(
  [
    ['point', 1, [0, 0]],
    ['point', 2, [30, 0]],
    ['point', 3, [30, 20]],
    ['point', 4, [0, 20]],
    ['line', 5, [1, 2]],
    ['line', 6, [2, 3]],
    ['line', 7, [3, 4]],
    ['line', 8, [4, 1]],
  ],
  {
    constraints: [
      ['horizontal', 5],
      ['vertical', 6],
      ['horizontal', 7],
      ['vertical', 8],
      ['length', [5, width]],
    ],
  },
);

// Center rectangle retains a normal center point (1), referenceable downstream.
// Width is fixed; in this fresh sketch, drag a corner to resize height around it.
// The midpoint marker links the center to two opposite corners with dashed guides.
export const centeredRectangle = sketch(
  [
    ['point', 1, [0, 0]],
    ['point', 2, [-15, -10]],
    ['point', 3, [15, -10]],
    ['point', 4, [15, 10]],
    ['point', 5, [-15, 10]],
    ['line', 6, [2, 3]],
    ['line', 7, [3, 4]],
    ['line', 8, [4, 5]],
    ['line', 9, [5, 2]],
  ],
  {
    constraints: [
      ['horizontal', 6],
      ['vertical', 7],
      ['horizontal', 8],
      ['vertical', 9],
      ['midpoint', [1, 2, 4]],
      ['length', [6, width]],
    ],
  },
);

// The center remains a locked upstream reference when editing this derived sketch.
export const centeredDetail = centeredRectangle.derive([
  ['point', 1, [0, 30]],
  ['line', 2, [centeredRectangle.point(1), 1]],
]);

// Activate Trim (scissors), hover and click the middle of line 7: only the part between the two
// crossings is removed. The original line splits into two new IDs; the cutting
// lines stay intact. Undo restores the unsplit source in one step.
// Deleting an outer segment also removes its now-disconnected endpoint.
// Esc exits Trim. Select + Delete/Backspace remains available.
export const trimming = sketch([
  ['point', 1, [0, 0]],
  ['point', 2, [40, 0]],
  ['point', 3, [10, -10]],
  ['point', 4, [10, 10]],
  ['point', 5, [30, -10]],
  ['point', 6, [30, 10]],
  ['line', 7, [1, 2]],
  ['line', 8, [3, 4]],
  ['line', 9, [5, 6]],
]);

// Lines 7 and 10 overlap in opposite directions. Trim highlights both and removes
// their shared middle interval in one click; the cutting lines and outer pieces
// remain. The new cut points are shared. One Undo restores both original lines.
export const overlapping = sketch([
  ['point', 1, [0, 0]],
  ['point', 2, [40, 0]],
  ['point', 3, [10, -10]],
  ['point', 4, [10, 10]],
  ['point', 5, [30, -10]],
  ['point', 6, [30, 10]],
  ['line', 7, [1, 2]],
  ['line', 8, [3, 4]],
  ['line', 9, [5, 6]],
  ['line', 10, [2, 1]],
]);
