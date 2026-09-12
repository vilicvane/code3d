import {cylinder, regularPrism} from '@code3d/core';

/**
 * Select spacer(...) to edit its parameters or compare the Arguments presets.
 * @code3d.param height {kind: 'length', default: 12, constraints: {min: 4, max: 30}}
 * @code3d.param radius {kind: 'length', default: 5, constraints: {min: 4, max: 10}}
 * @code3d.param sides {kind: 'count', default: 6, constraints: {min: 3, max: 12}}
 * @code3d.arguments [12, 5, 6]
 * @code3d.arguments [20, 6, 8]
 */
export function spacer(height = 12, radius = 5, sides = 6) {
  const body = regularPrism(radius, height, sides);
  const bore = cylinder(2, height);
  return body.cut([bore]);
}

export default spacer(12, 5, 6);
