import {box, sketch} from '@code3d/core';

/**
 * One-piece phone stand: a leaning back, retaining lip and charging opening.
 * @code3d.param width {kind: 'length', default: 70, constraints: {min: 45, max: 100}}
 * @code3d.param angle {kind: 'angle', default: 20, constraints: {min: 15, max: 30}}
 * @code3d.arguments [70, 20]
 * @code3d.arguments [85, 25]
 */
export function phoneStand(width = 70, angle = 20) {
  const body = sideProfile(angle)
    .face()
    .extrude(width)
    .originOffset(0, width / 2, 0)
    .rotate(90, 90, 0);
  const cableOpening = box(14, 26, 24).originOffset(0, -22, 2);
  return body.cut([cableOpening]).fillet(1).material('#8ed5d1');
}

export default phoneStand();

// The side outline is measured as [depth, height], in millimeters.
// Extrusion makes the whole stand one solid; no assembly offsets are needed.
function sideProfile(angle: number) {
  const lean = 70 * Math.tan((angle * Math.PI) / 180);
  return sketch([
    ['point', 1, [0, 0]],
    ['point', 2, [65, 0]],
    ['point', 3, [65, 5]],
    ['point', 4, [23, 5]],
    ['point', 5, [23 + lean, 75]],
    ['point', 6, [18 + lean, 75]],
    ['point', 7, [18 + (13 * lean) / 70, 18]],
    ['point', 8, [5, 18]],
    ['point', 9, [5, 28]],
    ['point', 10, [0, 28]],
    ['point', 11, [0, 13]],
    ['point', 12, [17, 13]],
    ['point', 13, [15, 5]],
    ['point', 14, [0, 5]],
    ['line', 15, [1, 2]],
    ['line', 16, [2, 3]],
    ['line', 17, [3, 4]],
    ['line', 18, [4, 5]],
    ['line', 19, [5, 6]],
    ['line', 20, [6, 7]],
    ['line', 21, [7, 8]],
    ['line', 22, [8, 9]],
    ['line', 23, [9, 10]],
    ['line', 24, [10, 11]],
    ['line', 25, [11, 12]],
    ['line', 26, [12, 13]],
    ['line', 27, [13, 14]],
    ['line', 28, [14, 1]],
  ]);
}
