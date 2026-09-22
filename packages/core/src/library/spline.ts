import {makeBSplineApproximation} from 'replicad';
import {assertCurvePoints, curveModel} from './curve-model.js';
import {toPoint, type Vec3} from './spatial.js';
import type {EdgeModel} from './runtime.js';

export function spline(points: readonly Vec3[]): EdgeModel {
  assertCurvePoints('spline', points, 2);
  return curveModel('spline', 'Spline', points, () =>
    makeBSplineApproximation(points.map(toPoint)),
  );
}
