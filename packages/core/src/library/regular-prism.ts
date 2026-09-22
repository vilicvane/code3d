import {sketchPolysides} from 'replicad';
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
 * @code3d.param sides {kind: 'count', default: 6, constraints: {min: 3}}
 * @code3d.param rotation {kind: 'angle', default: 0}
 */
export function regularPrism(
  radius: number,
  y: number,
  sides: number,
  rotation?: number,
): SolidModel;
export function regularPrism(
  radius = 5,
  y = 10,
  sides = 6,
  rotation = 0,
): SolidModel {
  assertPositive('radius', radius);
  assertPositive('y', y);
  if (!Number.isInteger(sides) || sides < 3) {
    throw new Error('sides must be an integer greater than or equal to 3.');
  }
  if (!Number.isFinite(rotation)) {
    throw new Error('rotation must be a finite number.');
  }
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: `${sides}-sided prism`,
    geometry: evaluateSolidGeometry(
      'regular-prism',
      [radius, y, sides, rotation],
      [],
      () => {
        const sketch = sketchPolysides(radius, sides, 0, {
          plane: 'XZ',
          origin: [0, -y / 2, 0],
        });
        let shape = sketch.extrude(y, {
          extrusionDirection: [0, 1, 0],
        });
        if (rotation !== 0) {
          shape = shape.rotate(rotation, [0, 0, 0], [0, 1, 0]);
        }
        return {shape};
      },
    ),
    elements: solidElements([
      [0, -y / 2, 0],
      [0, y / 2, 0],
    ]),
    operation: storedOperation('regularPrism'),
  }) as unknown as SolidModel;
}
