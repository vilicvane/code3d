import {box, sketch} from '@code3d/core';

// Sketch coordinates are local [x,y]; the relation places that plane on the stock.
// Select slot to edit its points/arcs. The surrounding stock is read-only context.
export const stock = box(64, 6, 36).rotate(0, 0, 15);
/**
 * Select sketch(...) inside this function and compare its Arguments presets.
 * @code3d.param radius {kind: 'length', default: 4, constraints: {min: 2, max: 8}}
 * @code3d.arguments [4]
 * @code3d.arguments [6]
 */
export function roundedSlot(radius = 4) {
  return sketch([
    ['point', 1, [-14, 0]],
    ['point', 2, [14, 0]],
    ['point', 3, [-14, radius]],
    ['point', 4, [14, radius]],
    ['point', 5, [14, -radius]],
    ['point', 6, [-14, -radius]],
    ['line', 7, [3, 4]],
    ['arc', 8, [2, radius, 4, 5, 'cw']],
    ['line', 9, [5, 6]],
    ['arc', 10, [1, radius, 6, 3, 'cw']],
  ]);
}
export const slot = roundedSlot(4).relate(profile =>
  profile.plane.align(stock.surface(4)),
);
export const cutter = slot.face().extrude(-6);
export const mountingPlate = stock.cut([cutter]).material('#8ed5d1');
export default mountingPlate;
