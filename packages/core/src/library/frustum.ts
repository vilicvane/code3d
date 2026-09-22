import {sketchCircle} from 'replicad';
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
 * @code3d.param bottomRadius {kind: 'length', default: 5, label: 'Bottom radius', constraints: {exclusiveMin: 0}}
 * @code3d.param topRadius {kind: 'length', default: 3, label: 'Top radius', constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 */
export function frustum(
  bottomRadius: number,
  topRadius: number,
  y: number,
): SolidModel;
export function frustum(bottomRadius = 5, topRadius = 3, y = 10): SolidModel {
  assertPositive('bottomRadius', bottomRadius);
  assertPositive('topRadius', topRadius);
  assertPositive('y', y);
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Frustum',
    geometry: evaluateSolidGeometry(
      'frustum',
      [bottomRadius, topRadius, y],
      [],
      () => {
        const bottom = sketchCircle(bottomRadius, {
          plane: 'XZ',
          origin: [0, -y / 2, 0],
        });
        const top = sketchCircle(topRadius, {
          plane: 'XZ',
          origin: [0, y / 2, 0],
        });
        return {shape: bottom.loftWith(top, {ruled: true})};
      },
    ),
    elements: solidElements([
      [0, -y / 2, 0],
      [0, y / 2, 0],
    ]),
    operation: storedOperation('frustum'),
  }) as unknown as SolidModel;
}
