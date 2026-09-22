import {makeVertex} from 'replicad';
import {assertFiniteVector} from './validation.js';
import {origin, translation, toPoint, type Vec3} from './spatial.js';
import {
  ModelObject,
  evaluateModelGeometry,
  storedOperation,
  type VertexModel,
} from './runtime.js';

/**
 * @code3d.param x {kind: 'length', label: 'X'}
 * @code3d.param y {kind: 'length', label: 'Y'}
 * @code3d.param z {kind: 'length', label: 'Z'}
 */
export function point([x, y, z]: Vec3 = origin): VertexModel {
  const position: Vec3 = [x, y, z];
  assertFiniteVector('point', position);
  const geometry = evaluateModelGeometry('point', [position], [], () => ({
    shape: makeVertex(toPoint(position)),
  }));
  return ModelObject.create<{}, 'vertex'>({
    kind: 'vertex',
    name: 'Point',
    geometry,
    geometryAnchor: {kind: 'point', transform: translation(position)},
    operation: storedOperation('point'),
  }) as unknown as VertexModel;
}
