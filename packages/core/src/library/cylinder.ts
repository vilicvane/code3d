import {makeCylinder} from 'replicad';
import {assertPositive} from './validation.js';
import {
  ModelObject,
  evaluateSolidGeometry,
  solidElements,
  storedOperation,
  type CanonicalElements,
  type SolidModel,
} from './runtime.js';

/**
 * @code3d.param radius {kind: 'length', default: 5, constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 */
export function cylinder(radius: number, y: number): SolidModel;
export function cylinder(radius = 5, y = 10): SolidModel {
  assertPositive('radius', radius);
  assertPositive('y', y);
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Cylinder',
    geometry: evaluateSolidGeometry('cylinder', [radius, y], [], () => ({
      shape: makeCylinder(radius, y, [0, -y / 2, 0], [0, 1, 0]),
    })),
    elements: solidElements([
      [0, -y / 2, 0],
      [0, y / 2, 0],
    ]),
    operation: storedOperation('cylinder'),
  }) as unknown as SolidModel;
}
