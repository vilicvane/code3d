import {Transformation} from './runtime.js';
import {assertFiniteVector} from './validation.js';
/**
 * Move the joint result along the fixed axes of its composition.
 * @code3d.inspect relate.inspectRelation
 * @code3d.param x {kind: 'length', default: 0, label: 'ΔX'}
 * @code3d.param y {kind: 'length', default: 0, label: 'ΔY'}
 * @code3d.param z {kind: 'length', default: 0, label: 'ΔZ'}
 */
export function offset(x: number, y: number, z: number): Transformation;
export function offset(x = 0, y = 0, z = 0): Transformation {
  assertFiniteVector('offset', [x, y, z]);
  return new Transformation({offset: [x, y, z]});
}
