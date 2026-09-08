import {sketchRelativePrecision} from './sketch-precision.js';
import type {
  SketchArcDirection,
  SketchEntitySnapshot,
  SketchPointAddress,
  SketchPosition,
} from './sketch.js';

/** Analytic geometry only. Parameters are evaluation-local, never entity identity. */
export type SketchCurve =
  | Readonly<{kind: 'line'; points: readonly [SketchPosition, SketchPosition]}>
  | Readonly<{kind: 'circle'; center: SketchPosition; radius: number}>
  | Readonly<{
      kind: 'arc';
      center: SketchPosition;
      radius: number;
      start: number;
      sweep: number;
    }>;

const tau = Math.PI * 2;
export const sketchPositiveAngle = (angle: number) =>
  ((angle % tau) + tau) % tau;

export function sketchArcGeometry(
  center: SketchPosition,
  start: SketchPosition,
  end: SketchPosition,
  direction: SketchArcDirection,
): Extract<SketchCurve, {kind: 'arc'}> {
  const angle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
  const sign = direction === 'ccw' ? 1 : -1;
  return {
    kind: 'arc',
    center,
    radius: Math.hypot(start[0] - center[0], start[1] - center[1]),
    start: angle,
    sweep: sign * sketchPositiveAngle(sign * (endAngle - angle)),
  };
}

export function sketchCurveGeometry<E extends SketchEntitySnapshot>(
  entity: E,
  point: (address: SketchPointAddress) => SketchPosition,
): E extends {kind: 'point'}
  ? undefined
  : Extract<SketchCurve, {kind: E['kind']}>;
export function sketchCurveGeometry(
  entity: SketchEntitySnapshot,
  point: (address: SketchPointAddress) => SketchPosition,
): SketchCurve | undefined {
  switch (entity.kind) {
    case 'point':
      return undefined;
    case 'line':
      return {
        kind: 'line',
        points: [point(entity.points[0]), point(entity.points[1])],
      };
    case 'circle':
      return {
        kind: 'circle',
        center: point(entity.center),
        radius: entity.radius,
      };
    case 'arc':
      return {
        ...sketchArcGeometry(
          point(entity.center),
          point(entity.points[0]),
          point(entity.points[1]),
          entity.direction,
        ),
        radius: entity.radius,
      };
  }
}

export function sketchCurvePosition(
  curve: SketchCurve,
  t: number,
): SketchPosition {
  if (curve.kind === 'line') {
    const [a, b] = curve.points;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }
  const angle =
    curve.kind === 'circle' ? t * tau : curve.start + t * curve.sweep;
  return [
    curve.center[0] + curve.radius * Math.cos(angle),
    curve.center[1] + curve.radius * Math.sin(angle),
  ];
}

/** Nearest point on the finite curve, including arc endpoints (not its full circle). */
export function sketchCurveClosestParameter(
  curve: SketchCurve,
  position: SketchPosition,
): number {
  if (curve.kind === 'line') {
    const [a, b] = curve.points,
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    return Math.max(
      0,
      Math.min(
        1,
        ((position[0] - a[0]) * dx + (position[1] - a[1]) * dy) /
          (dx * dx + dy * dy) || 0,
      ),
    );
  }
  const angle = Math.atan2(
    position[1] - curve.center[1],
    position[0] - curve.center[0],
  );
  if (curve.kind === 'circle') return sketchPositiveAngle(angle) / tau;
  const sign = Math.sign(curve.sweep),
    sweep = Math.abs(curve.sweep);
  const distance = sketchPositiveAngle(sign * (angle - curve.start));
  if (distance <= sweep) return sweep ? distance / sweep : 0;
  return distance - sweep < tau - distance ? 1 : 0;
}

export function sketchCurveBounds(
  curve: SketchCurve,
): readonly SketchPosition[] {
  if (curve.kind === 'line') return curve.points;
  const candidates = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].filter(
    angle =>
      curve.kind === 'circle' ||
      sketchPositiveAngle(Math.sign(curve.sweep) * (angle - curve.start)) <=
        Math.abs(curve.sweep),
  );
  return [
    ...(curve.kind === 'arc'
      ? [sketchCurvePosition(curve, 0), sketchCurvePosition(curve, 1)]
      : []),
    ...candidates.map((angle): SketchPosition => [
      curve.center[0] + curve.radius * Math.cos(angle),
      curve.center[1] + curve.radius * Math.sin(angle),
    ]),
  ];
}

export function sketchCurveTolerance(curve: SketchCurve): number {
  const size =
    curve.kind === 'line'
      ? Math.hypot(
          curve.points[1][0] - curve.points[0][0],
          curve.points[1][1] - curve.points[0][1],
        )
      : curve.radius;
  return Math.max(
    size * sketchRelativePrecision,
    Number.EPSILON *
      16 *
      Math.max(...sketchCurveBounds(curve).flatMap(p => p.map(Math.abs))),
  );
}
