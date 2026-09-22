import {sketchEllipse} from 'replicad';
import {planarFaceModel} from './planar-face-model.js';
import {assertPositive} from './validation.js';
import type {FaceModel} from './runtime.js';

/**
 * @code3d.param xRadius {kind: 'length', default: 5, label: 'X radius', constraints: {exclusiveMin: 0}}
 * @code3d.param zRadius {kind: 'length', default: 3, label: 'Z radius', constraints: {exclusiveMin: 0}}
 */
export function ellipse(xRadius: number, zRadius: number): FaceModel;
export function ellipse(xRadius = 5, zRadius = 3): FaceModel {
  assertPositive('xRadius', xRadius);
  assertPositive('zRadius', zRadius);
  return planarFaceModel('ellipse', 'Ellipse', [xRadius, zRadius], () =>
    sketchEllipse(xRadius, zRadius, {plane: 'XZ'}),
  );
}
