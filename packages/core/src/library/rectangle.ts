import {sketchRectangle} from 'replicad';
import {planarFaceModel} from './planar-face-model.js';
import {assertPositive} from './validation.js';
import type {FaceModel} from './runtime.js';

/**
 * @code3d.param x {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 * @code3d.param z {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 */
export function rectangle(x: number, z: number): FaceModel;
export function rectangle(x = 10, z = 10): FaceModel {
  assertPositive('x', x);
  assertPositive('z', z);
  return planarFaceModel('rectangle', 'Rectangle', [x, z], () =>
    sketchRectangle(x, z, {plane: 'XZ'}),
  );
}
