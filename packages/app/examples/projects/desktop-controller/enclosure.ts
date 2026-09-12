import {box} from '@code3d/core';

/**
 * A reusable shell returns the mounting reference its panel needs.
 * @code3d.param width {kind: 'length', default: 100}
 * @code3d.param height {kind: 'length', default: 28}
 * @code3d.param depth {kind: 'length', default: 70}
 */
export function makeEnclosure(width = 100, height = 28, depth = 70) {
  const outside = box(width, height, depth);
  const cavity = box(width - 4, height, depth - 4).originOffset(0, -2, 0);
  const connector = box(14, 8, 8).originOffset(0, 4, -depth / 2 + 1);
  return outside.cut([cavity, connector]).expose({panelSeat: outside.up});
}

export default makeEnclosure();
