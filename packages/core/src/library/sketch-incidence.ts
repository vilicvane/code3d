import type {SketchPosition} from './sketch.js';
import type {SketchSolveProblem, SketchSolveResult} from './sketch-solver.js';
import {
  sketchCurveTolerance,
  sketchArcGeometry,
  sketchCurveClosestParameter,
  sketchCurvePosition,
  type SketchCurve,
} from './sketch-curves.js';

export type SketchIncidenceGeometry = Readonly<{
  points: readonly SketchPosition[];
  lines: SketchSolveProblem['lines'];
  circles: readonly Pick<
    SketchSolveProblem['circles'][number],
    'center' | 'radius'
  >[];
  arcs: readonly Omit<SketchSolveProblem['arcs'][number], 'locked'>[];
}>;
export type SketchIncidence = Readonly<{
  point: number;
  kind: 'line' | 'circle' | 'arc';
  index: number;
}>;

export function sketchIncidenceGeometry(
  problem: SketchSolveProblem,
  result?: SketchSolveResult,
): SketchIncidenceGeometry {
  return {
    points: result?.positions ?? problem.points.map(p => p.position),
    lines: problem.lines,
    circles: problem.circles.map((c, i) => ({
      ...c,
      radius: result ? result.radii[i] : c.radius,
    })),
    arcs: problem.arcs.map((a, i) => ({
      ...a,
      radius: result ? result.arcRadii[i] : a.radius,
    })),
  };
}

export function sketchIncidenceCurve(
  geometry: SketchIncidenceGeometry,
  contact: SketchIncidence,
): SketchCurve {
  if (contact.kind === 'line')
    return {
      kind: 'line',
      points: geometry.lines[contact.index].map(i => geometry.points[i]) as [
        SketchPosition,
        SketchPosition,
      ],
    };
  const curve = (contact.kind === 'circle' ? geometry.circles : geometry.arcs)[
    contact.index
  ];
  const center = geometry.points[curve.center];
  if (contact.kind === 'circle')
    return {kind: 'circle', center, radius: curve.radius};
  const arc = geometry.arcs[contact.index];
  return {
    ...sketchArcGeometry(
      center,
      geometry.points[arc.points[0]],
      geometry.points[arc.points[1]],
      arc.direction,
    ),
    radius: arc.radius,
  };
}

export function sketchIncidencePoints(
  geometry: SketchIncidenceGeometry,
  contact: SketchIncidence,
): readonly number[] {
  return [
    contact.point,
    ...(contact.kind === 'line'
      ? geometry.lines[contact.index]
      : contact.kind === 'circle'
        ? [geometry.circles[contact.index].center]
        : [
            geometry.arcs[contact.index].center,
            ...geometry.arcs[contact.index].points,
          ]),
  ];
}

export function isPointOnSketchCurve(
  point: SketchPosition,
  curve: SketchCurve,
): boolean {
  if (curve.kind === 'line')
    return isPointOnSketchSegment(point, ...curve.points);
  const nearest = sketchCurvePosition(
    curve,
    sketchCurveClosestParameter(curve, point),
  );
  return (
    Math.hypot(point[0] - nearest[0], point[1] - nearest[1]) <=
    sketchCurveTolerance(curve)
  );
}

/** Finite boundary violated by a solution on the underlying unbounded curve. */
export function sketchIncidenceBoundary(
  geometry: SketchIncidenceGeometry,
  contact: SketchIncidence,
): number | undefined {
  if (contact.kind === 'circle') return;
  const curve = sketchIncidenceCurve(geometry, contact);
  const point = geometry.points[contact.point];
  if (isPointOnSketchCurve(point, curve)) return;
  const endpoints =
    contact.kind === 'line'
      ? geometry.lines[contact.index]
      : geometry.arcs[contact.index].points;
  const t = sketchCurveClosestParameter(curve, point);
  if (t === 0 || t === 1) return endpoints[t];
  return;
}

/** Recognition is gesture-local and shares finite geometry/tolerance with trimming. */
export function sketchIncidences(
  geometry: SketchIncidenceGeometry,
): readonly SketchIncidence[] {
  const seen = new Set<string>();
  return (['line', 'circle', 'arc'] as const).flatMap(kind => {
    const curves =
      kind === 'line'
        ? geometry.lines
        : kind === 'circle'
          ? geometry.circles
          : geometry.arcs;
    return curves.flatMap((_, index) =>
      geometry.points.flatMap((position, point): SketchIncidence[] => {
        const contact = {point, kind, index};
        if (sketchIncidencePoints(geometry, contact).slice(1).includes(point))
          return [];
        if (
          !isPointOnSketchCurve(
            position,
            sketchIncidenceCurve(geometry, contact),
          )
        )
          return [];
        const key =
          kind === 'line'
            ? [point, ...[...geometry.lines[index]].sort((a, b) => a - b)].join(
                ':',
              )
            : kind + ':' + point + ':' + index;
        if (seen.has(key)) return [];
        seen.add(key);
        return [contact];
      }),
    );
  });
}

export function lineParameter(
  point: SketchPosition,
  a: SketchPosition,
  b: SketchPosition,
): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  return (
    ((point[0] - a[0]) * (dx / length) + (point[1] - a[1]) * (dy / length)) /
    length
  );
}

export function pointLineDistance(
  point: SketchPosition,
  a: SketchPosition,
  b: SketchPosition,
): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  return Math.abs(
    (point[0] - a[0]) * (dy / length) - (point[1] - a[1]) * (dx / length),
  );
}

export function isPointOnSketchSegment(
  point: SketchPosition,
  a: SketchPosition,
  b: SketchPosition,
): boolean {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!length) return false;
  const tolerance = sketchCurveTolerance({kind: 'line', points: [a, b]});
  const t = lineParameter(point, a, b);
  return (
    t >= -tolerance / length &&
    t <= 1 + tolerance / length &&
    pointLineDistance(point, a, b) <= tolerance
  );
}
