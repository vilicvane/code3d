import {makeLine} from 'replicad';
import {assertCurvePoints, curveModel} from './curve-model.js';
import {origin, toPoint, type Vec3} from './spatial.js';
import type {EdgeModel} from './runtime.js';

/**
 * @code3d.param x {kind: 'length', label: 'End X'}
 * @code3d.param y {kind: 'length', label: 'End Y'}
 * @code3d.param z {kind: 'length', label: 'End Z'}
 */
export function line([x, y, z]: Vec3): EdgeModel;
/**
 * @code3d.param startX {kind: 'length', label: 'Start X'}
 * @code3d.param startY {kind: 'length', label: 'Start Y'}
 * @code3d.param startZ {kind: 'length', label: 'Start Z'}
 * @code3d.param endX {kind: 'length', label: 'End X'}
 * @code3d.param endY {kind: 'length', label: 'End Y'}
 * @code3d.param endZ {kind: 'length', label: 'End Z'}
 */
export function line(
  [startX, startY, startZ]: Vec3,
  [endX, endY, endZ]: Vec3,
): EdgeModel;
export function line(startOrEnd: Vec3, end?: Vec3): EdgeModel {
  const start = end ? startOrEnd : origin;
  end ??= startOrEnd;
  assertCurvePoints('line', [start, end], 2);
  return curveModel('line', 'Line', [start, end], () =>
    makeLine(toPoint(start), toPoint(end)),
  );
}
