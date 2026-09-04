import {regularPrism, type ModelObject} from '@code3d/core';

/**
 * @code3d.arguments [10, 5, 6]
 * @code3d.arguments [14, 7, 8]
 */
export function makeKnob(
  radius: number,
  height: number,
  sides: number,
): ModelObject {
  return regularPrism(radius, height, sides, 30).fillet(0.6).paint('#d8ff3e');
}

export const designArgumentsExample = makeKnob(10, 5, 6);
