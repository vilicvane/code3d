import {on, box, distance, group, offset} from '@code3d/core';

/**
 * A beam fills the measured opening without changing its cross-section.
 * @code3d.param gap {kind: 'length', default: 60, constraints: {exclusiveMin: 0}}
 * @code3d.param depth {kind: 'length', default: 32, constraints: {exclusiveMin: 8}}
 * @code3d.arguments [60, 32]
 * @code3d.arguments [95, 48]
 */
export function fittedBeam(gap = 60, depth = 32) {
  const left = box(8, 30, depth).material('#708090');
  const right = box(8, 30, depth)
    .relate(() => [on(left.right), offset(gap, 0, 0)])
    .material('#708090');

  // Queries solve the existing placement even before group().
  const length = distance(left.right, right.left, 'x');
  const beamDepth = distance(left.front, left.back, 'z') - 8;
  const beam = box(length, 10, beamDepth)
    .relate(() => on(left.right))
    .material('#d99d47');

  // The numbers above stay fixed if more relations are added later.
  return group([left, right, beam]).expose({
    supportA: left,
    supportB: right,
    beam,
  });
}

export default fittedBeam();
