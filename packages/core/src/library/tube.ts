import {basicFaceExtrusion, makeFace, sketchCircle, Vector} from 'replicad';
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
 * A concentric, constant-section tube, open at both ends and centered on Y.
 * @code3d.param outerRadius {kind: 'length', default: 5, label: 'Outer radius', constraints: {exclusiveMin: 0}}
 * @code3d.param innerRadius {kind: 'length', default: 3, label: 'Inner radius', constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 */
export function tube(
  outerRadius: number,
  innerRadius: number,
  y: number,
): SolidModel;
export function tube(outerRadius = 5, innerRadius = 3, y = 10): SolidModel {
  assertPositive('outerRadius', outerRadius);
  assertPositive('innerRadius', innerRadius);
  assertPositive('y', y);
  if (innerRadius >= outerRadius) {
    throw new Error('innerRadius must be smaller than outerRadius.');
  }
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Tube',
    geometry: evaluateSolidGeometry(
      'tube',
      [outerRadius, innerRadius, y],
      [],
      () => {
        const outer = sketchCircle(outerRadius, {
          plane: 'XZ',
          origin: [0, -y / 2, 0],
        });
        const inner = sketchCircle(innerRadius, {
          plane: 'XZ',
          origin: [0, -y / 2, 0],
        });
        // Hole wires run opposite to the outer boundary.
        inner.wire.wrapped.Reverse();
        const section = makeFace(outer.wire, [inner.wire]);
        const direction = new Vector([0, y, 0]);
        try {
          return {shape: basicFaceExtrusion(section, direction)};
        } finally {
          direction.delete();
          section.delete();
          inner.delete();
          outer.delete();
        }
      },
    ),
    elements: solidElements([
      [0, -y / 2, 0],
      [0, y / 2, 0],
    ]),
    operation: storedOperation('tube'),
  }) as unknown as SolidModel;
}
