import {regularPrism, type SolidModel} from '@code3d/core';

/**
 * @code3d.param radius {kind: 'length'}
 * @code3d.param height {kind: 'length'}
 * @code3d.param sides {kind: 'count', constraints: {min: 3}}
 * @code3d.arguments [10, 5, 6]
 * @code3d.arguments [14, 7, 8]
 */
export function makeKnob(
  radius: number,
  height: number,
  sides: number,
): SolidModel {
  return regularPrism(radius, height, sides, 30).fillet(0.6).paint('#d8ff3e');
}

export const designArgumentsExample = makeKnob(10, 5, 6);
