import type {SketchPosition} from './sketch.js';
import {
  SketchConstraintError,
  type SketchContact,
  type SketchContactBoundary,
  type SketchSolveCurve,
  type SketchSolveProblem,
  type SketchSolveResult,
} from './sketch-solve-model.js';
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
/** Solve finite domains with revisable endpoint equalities. The native kernel
 * supplies local equality solves, not inequality multipliers: failed active sets
 * branch on implicated boundaries, never on authored constraints. Every state
 * starts from the same geometry, so memoization does not discard another seed.
 * The normal path adds one bound per solve. Search is finite (three states per
 * contact), with a quadratic work budget before reporting local nonconvergence. */
export function solveSketchIncidenceBounds(
  original: SketchSolveProblem,
  contacts: readonly SketchContact[],
  solve: (bounds: readonly SketchContactBoundary[]) => SketchSolveResult,
): SketchSolveResult {
  const domains = contacts.filter(
    contact => !contact.structural && contact.curve.kind !== 'circle',
  );
  type ActiveSet = ReadonlyMap<number, 0 | 1>;
  // Generators retain a parent state and materialize one child at a time.
  // Budget state width as well as visits, bounding queued maps and memo keys,
  // rather than allocating a combinatorial frontier before the next solve.
  const pending: Iterator<ActiveSet>[] = [[new Map<number, 0 | 1>()].values()];
  const visited = new Set<string>();
  const endpoints = (contact: SketchContact) =>
    contact.curve.kind === 'line'
      ? original.lines[contact.curve.index]
      : original.arcs[contact.curve.index].points;
  let failure: SketchConstraintError | undefined;
  const sources = new Set<number>();
  const budget = 4 * (domains.length + 1) ** 2;
  let work = 0;
  let exhausted = false;
  while (pending.length) {
    const candidate = pending.at(-1)!.next();
    if (candidate.done) {
      pending.pop();
      continue;
    }
    const active = candidate.value;
    work += 1 + active.size;
    if (work > budget) {
      exhausted = true;
      break;
    }
    const key = [...active]
      .sort(([a], [b]) => a - b)
      .map(([index, end]) => `${index}:${end}`)
      .join(',');
    if (visited.has(key)) continue;
    visited.add(key);
    const bounds = [...active].map(([index, end]) => ({
      contact: domains[index],
      endpoint: endpoints(domains[index])[end],
    }));
    let result: SketchSolveResult;
    try {
      result = solve(bounds);
    } catch (error) {
      if (!(error instanceof SketchConstraintError) || !active.size)
        throw error;
      failure = error;
      error.constraints.forEach(source => sources.add(source));
      const implicated = [...active.keys()].filter(index =>
        domains[index].sources.some(source =>
          error.constraints.includes(source),
        ),
      );
      // Author diagnostics prioritize candidates; they are not a complete
      // conflict core. Other boundaries remain searchable, and author equations
      // are never removed.
      const competing = [
        ...implicated,
        ...[...active.keys()].filter(index => !implicated.includes(index)),
      ];
      pending.push(
        (function* () {
          for (const index of competing) {
            const released = new Map(active);
            released.delete(index);
            yield released;
          }
          for (const index of competing) {
            const replaced = new Map(active);
            replaced.set(index, active.get(index) === 0 ? 1 : 0);
            yield replaced;
          }
        })(),
      );
      continue;
    }
    const geometry = sketchIncidenceGeometry(original, result);
    const outside = domains.flatMap((contact, index) => {
      const endpoint = sketchIncidenceBoundary(geometry, contact);
      return endpoint === undefined
        ? []
        : [{index, end: endpoints(contact).indexOf(endpoint) as 0 | 1}];
    });
    if (!outside.length) return result;
    for (const {index} of outside)
      domains[index].sources.forEach(source => sources.add(source));
    pending.push(
      (function* () {
        for (const {index, end} of outside) {
          const nearest = new Map(active);
          nearest.set(index, end);
          yield nearest;
        }
        for (const {index, end} of outside) {
          const alternate = new Map(active);
          alternate.set(index, end === 0 ? 1 : 0);
          yield alternate;
        }
      })(),
    );
  }
  const constraints = [...sources].sort((a, b) => a - b);
  throw new SketchConstraintError(
    constraints.length ? constraints : (failure?.constraints ?? []),
    exhausted
      ? 'Sketch finite curve boundaries did not converge within the active-set work budget.'
      : 'Sketch constraints did not converge within their finite curve boundaries.',
  );
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
  curveRef: SketchSolveCurve,
): SketchCurve {
  if (curveRef.kind === 'line')
    return {
      kind: 'line',
      points: geometry.lines[curveRef.index].map(i => geometry.points[i]) as [
        SketchPosition,
        SketchPosition,
      ],
    };
  const curve = (curveRef.kind === 'circle' ? geometry.circles : geometry.arcs)[
    curveRef.index
  ];
  const center = geometry.points[curve.center];
  if (curveRef.kind === 'circle')
    return {kind: 'circle', center, radius: curve.radius};
  const arc = geometry.arcs[curveRef.index];
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
  contact: SketchContact,
): number | undefined {
  if (contact.curve.kind === 'circle') return;
  const curve = sketchIncidenceCurve(geometry, contact.curve);
  const point = geometry.points[contact.point];
  if (isPointOnSketchCurve(point, curve)) return;
  const endpoints =
    contact.curve.kind === 'line'
      ? geometry.lines[contact.curve.index]
      : geometry.arcs[contact.curve.index].points;
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
