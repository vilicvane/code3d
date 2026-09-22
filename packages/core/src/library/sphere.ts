import {makeSphere} from 'replicad';
import {assertPositive} from './validation.js';
import {
  ModelObject,
  evaluateSolidGeometry,
  solidElements,
  storedOperation,
  type CanonicalElements,
  type SolidModel,
} from './runtime.js';

/** @code3d.param radius {kind: 'length', default: 5, constraints: {exclusiveMin: 0}} */
export function sphere(radius: number): SolidModel;
export function sphere(radius = 5): SolidModel {
  assertPositive('radius', radius);
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Sphere',
    geometry: evaluateSolidGeometry('sphere', [radius], [], () => ({
      shape: makeSphere(radius),
    })),
    elements: solidElements([
      [0, -radius, 0],
      [0, radius, 0],
    ]),
    operation: storedOperation('sphere'),
  }) as unknown as SolidModel;
}
