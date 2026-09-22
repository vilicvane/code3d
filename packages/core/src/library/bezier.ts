import {makeBezierCurve} from 'replicad';
import {assertCurvePoints, curveModel} from './curve-model.js';
import {toPoint, type Vec3} from './spatial.js';
import type {EdgeModel} from './runtime.js';

export function bezier(points: readonly Vec3[]): EdgeModel {
  assertCurvePoints('bezier', points, 2);
  return curveModel('bezier', 'Bezier curve', points, () =>
    makeBezierCurve(points.map(toPoint)),
  );
}
