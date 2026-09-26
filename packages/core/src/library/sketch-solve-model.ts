import type {SketchArcDirection, SketchPosition} from './sketch.js';

/** Evaluation-local numeric indices, never author entity or constraint IDs. */
export type SketchSolveConstraint =
  | Readonly<{
      kind: 'equalLength';
      points: readonly [number, number, number, number];
    }>
  | Readonly<{
      kind: 'equalRadius';
      curves: readonly [SketchSolveCurve, SketchSolveCurve];
    }>
  | Readonly<{
      kind: 'tangent';
      curves: readonly [SketchSolveCurve, SketchSolveCurve];
      mode: 'external' | 'internal';
    }>
  | Readonly<{
      kind: 'parallel';
      points: readonly [number, number, number, number];
    }>
  | Readonly<{
      kind: 'perpendicular';
      points: readonly [number, number, number, number];
    }>
  | Readonly<{
      kind: 'lineAngle';
      points: readonly [number, number, number, number];
      value: number;
    }>
  | Readonly<{
      kind: 'pointOn';
      point: number;
      curve: SketchSolveCurve;
    }>
  | Readonly<{kind: 'sweep'; index: number; value: number}>
  | Readonly<{
      kind: 'radius';
      curve: 'circle' | 'arc';
      index: number;
      value: number;
    }>
  | Readonly<{kind: 'fixed'; point: number; position: SketchPosition}>
  | Readonly<{kind: 'x' | 'y'; point: number; value: number}>
  | Readonly<{kind: 'midpoint'; points: readonly [number, number, number]}>
  | Readonly<{
      kind: 'horizontal' | 'vertical' | 'coincident';
      points: readonly [number, number];
    }>
  | Readonly<{
      kind: 'length' | 'angle';
      points: readonly [number, number];
      value: number;
    }>;

export type SketchSolveCurve = Readonly<{
  kind: 'line' | 'circle' | 'arc';
  index: number;
}>;

export type SketchSolveProblem = Readonly<{
  points: readonly Readonly<{
    position: SketchPosition;
    locked: readonly [boolean, boolean];
  }>[];
  lines: readonly (readonly [number, number])[];
  circles: readonly Readonly<{
    center: number;
    radius: number;
    locked: boolean;
  }>[];
  arcs: readonly Readonly<{
    center: number;
    radius: number;
    locked: boolean;
    points: readonly [number, number];
    direction: SketchArcDirection;
  }>[];
  constraints: readonly SketchSolveConstraint[];
}>;

export type SketchSolveResult = Readonly<{
  positions: readonly SketchPosition[];
  radii: readonly number[];
  arcRadii: readonly number[];
  degreesOfFreedom: number;
  redundant: readonly number[];
}>;

export class SketchConstraintError extends Error {
  constructor(
    readonly constraints: readonly number[],
    message: string,
  ) {
    super(message);
    this.name = 'SketchConstraintError';
  }
}

export type SketchSolveTarget =
  | Readonly<{kind: 'point'; point: number; position: SketchPosition}>
  | Readonly<{
      kind: 'radius';
      curve: 'circle' | 'arc';
      index: number;
      value: number;
    }>;

export type SketchSolveObjective = SketchSolveTarget &
  Readonly<{weight: number}>;

/** A relation's contact with a finite curve. Sources always refer to authors. */
export type SketchContact = Readonly<{
  point: number;
  curve: SketchSolveCurve;
  sources: readonly number[];
  structural: boolean;
}>;

export type SketchContactBoundary = Readonly<{
  contact: SketchContact;
  endpoint: number;
}>;

export type SketchTangentContact = Readonly<{
  point: number;
  shared: boolean;
}>;

export function sketchCurvePoints(
  problem: Readonly<{
    lines: SketchSolveProblem['lines'];
    circles: readonly Readonly<{center: number}>[];
    arcs: readonly Readonly<{
      center: number;
      points: readonly [number, number];
    }>[];
  }>,
  curve: SketchSolveCurve,
): readonly number[] {
  return curve.kind === 'line'
    ? problem.lines[curve.index]
    : curve.kind === 'circle'
      ? [problem.circles[curve.index].center]
      : [problem.arcs[curve.index].center, ...problem.arcs[curve.index].points];
}

/** Geometry dependencies of a relation, derived from its single typed targets. */
export function sketchConstraintPoints(
  problem: SketchSolveProblem,
  constraint: SketchSolveConstraint,
): readonly number[] {
  if (constraint.kind === 'pointOn')
    return [constraint.point, ...sketchCurvePoints(problem, constraint.curve)];
  if ('curves' in constraint)
    return constraint.curves.flatMap(curve =>
      sketchCurvePoints(problem, curve),
    );
  if ('points' in constraint) return constraint.points;
  if ('point' in constraint) return [constraint.point];
  return sketchCurvePoints(problem, {
    kind: constraint.kind === 'sweep' ? 'arc' : constraint.curve,
    index: constraint.index,
  });
}
