import {sketchCircle} from 'replicad';
import {planarFaceModel} from './planar-face-model.js';
import {assertPositive} from './validation.js';
import type {FaceModel} from './runtime.js';

/** @code3d.param radius {kind: 'length', default: 5, constraints: {exclusiveMin: 0}} */
export function circle(radius: number): FaceModel;
export function circle(radius = 5): FaceModel {
  assertPositive('radius', radius);
  return planarFaceModel('circle', 'Circle', [radius], () =>
    sketchCircle(radius, {plane: 'XZ'}),
  );
}
