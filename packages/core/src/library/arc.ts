import {makeThreePointArc} from 'replicad';
import {assertCurvePoints, curveModel} from './curve-model.js';
import {toPoint, type Vec3} from './spatial.js';
import type {EdgeModel} from './runtime.js';

export function arc(start: Vec3, middle: Vec3, end: Vec3): EdgeModel {
  assertCurvePoints('arc', [start, middle, end], 3);
  return curveModel('arc', 'Arc', [start, middle, end], () =>
    makeThreePointArc(toPoint(start), toPoint(middle), toPoint(end)),
  );
}
