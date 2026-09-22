import {Transformation} from './runtime.js';
import {assertFiniteVector} from './validation.js';
/**
 * Rotate about self's current origin and local X, Y, then Z axes.
 * @code3d.inspect relate.inspectRelation
 * @code3d.param x {kind: 'angle', default: 0, label: 'Rotate X'}
 * @code3d.param y {kind: 'angle', default: 0, label: 'Rotate Y'}
 * @code3d.param z {kind: 'angle', default: 0, label: 'Rotate Z'}
 */
export function rotate(x: number, y: number, z: number): Transformation;
export function rotate(x = 0, y = 0, z = 0): Transformation {
  assertFiniteVector('rotate', [x, y, z]);
  return new Transformation({
    pivot: {kind: 'pivot', point: [0, 0, 0], implicit: true},
    angles: [x, y, z],
  });
}
