import {PivotChain, TransformationRotation, type Vec3} from './runtime.js';
import {assertFiniteVector} from './validation.js';
/**
 * Select a pivot in self's local coordinates for the next rotation.
 * @code3d.inspect relate.inspectRelation
 * @code3d.param x {kind: 'length', default: 0, label: 'Pivot X'}
 * @code3d.param y {kind: 'length', default: 0, label: 'Pivot Y'}
 * @code3d.param z {kind: 'length', default: 0, label: 'Pivot Z'}
 */
export function pivot([x, y, z]: Vec3): PivotChain;
export function pivot([x = 0, y = 0, z = 0]: Vec3 = [0, 0, 0]): PivotChain {
  assertFiniteVector('pivot', [x, y, z]);
  return new PivotChain(new TransformationRotation(), {
    kind: 'pivot',
    point: [x, y, z],
  });
}
