import type {SketchPosition} from './sketch.js';
import {
  SketchConstraintError,
  type SketchSolveConstraint,
  type SketchSolveProblem,
  type SketchSolveResult,
} from './sketch-solver.js';
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
  /** Original author constraint for diagnostics from an active finite boundary. */
  constraintIndex?: number;
}>;

/** Support equations for authored point-on relations. */
export function sketchIncidenceConstraints(
  geometry: SketchIncidenceGeometry,
  contacts: readonly SketchIncidence[],
): SketchSolveConstraint[] {
  return contacts.map(contact =>
    contact.kind === 'line'
      ? {
          kind: 'pointOnLine',
          points: [contact.point, ...geometry.lines[contact.index]],
        }
      : {
          kind: 'pointOnCircle',
          points: [
            contact.point,
            (contact.kind === 'circle' ? geometry.circles : geometry.arcs)[
              contact.index
            ].center,
          ],
          curve: contact.kind,
          index: contact.index,
        },
  );
}

/** Keep solved contacts on finite segments and directed arcs. */
export function solveSketchIncidenceBounds(
  original: SketchSolveProblem,
  contacts: readonly SketchIncidence[],
  solve: (problem: SketchSolveProblem) => SketchSolveResult,
): SketchSolveResult {
  const bounds = new Map<SketchIncidence, number>();
  for (;;) {
    const problem = {
      ...original,
      constraints: [
        ...original.constraints,
        ...[...bounds].map(([contact, endpoint]) => ({
          kind: 'coincident' as const,
          points: [contact.point, endpoint] as const,
        })),
      ],
    };
    let result: SketchSolveResult;
    try {
      result = solve(problem);
    } catch (error) {
      // Boundary equations belong to the original relation; no auxiliary
      // constraint index may escape into source diagnostics.
      if (error instanceof SketchConstraintError && bounds.size) {
        const active = [...bounds.keys()];
        const constraints = [
          ...new Set(
            error.constraints
              .map((index: number) =>
                index < original.constraints.length
                  ? index
                  : active[index - original.constraints.length]
                      ?.constraintIndex,
              )
              .filter((index): index is number => index !== undefined),
          ),
        ];
        throw new SketchConstraintError(
          constraints,
          `Could not satisfy sketch constraints${constraints.length ? ` (${constraints.map(index => index + 1).join(', ')})` : ''} within their finite curve boundaries.`,
        );
      }
      throw error;
    }
    const solved = sketchIncidenceGeometry(problem, result);
    const outside = contacts.flatMap(contact => {
      const endpoint = bounds.has(contact)
        ? undefined
        : sketchIncidenceBoundary(solved, contact);
      return endpoint === undefined ? [] : [{contact, endpoint}];
    })[0];
    if (!outside) return result;
    bounds.set(outside.contact, outside.endpoint);
  }
}

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
