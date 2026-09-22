import {sketchPolysides} from 'replicad';
import {planarFaceModel} from './planar-face-model.js';
import {assertPositive} from './validation.js';
import {origin, toPoint} from './spatial.js';
import type {FaceModel} from './runtime.js';

/**
 * @code3d.param radius {kind: 'length', default: 5, constraints: {exclusiveMin: 0}}
 * @code3d.param sides {kind: 'count', default: 6, constraints: {min: 3}}
 * @code3d.param rotation {kind: 'angle', default: 0}
 */
export function regularPolygon(
  radius: number,
  sides: number,
  rotation?: number,
): FaceModel;
export function regularPolygon(radius = 5, sides = 6, rotation = 0): FaceModel {
  assertPositive('radius', radius);
  if (!Number.isInteger(sides) || sides < 3) {
    throw new Error('sides must be an integer greater than or equal to 3.');
  }
  if (!Number.isFinite(rotation)) {
    throw new Error('rotation must be a finite number.');
  }
  return planarFaceModel(
    'regularPolygon',
    `${sides}-sided polygon`,
    [radius, sides, rotation],
    () => sketchPolysides(radius, sides, 0, {plane: 'XZ'}),
    face =>
      rotation === 0 ? face : face.rotate(rotation, toPoint(origin), [0, 1, 0]),
  );
}
