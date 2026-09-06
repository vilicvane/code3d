import type {GcsSystem, ModuleStatic} from '@salusoft89/planegcs';
import type {SketchPosition} from './sketch.js';

/** Evaluation-local numeric indices, never author entity or constraint IDs. */
export type SketchSolveConstraint =
  | Readonly<{kind: 'fixed'; point: number; position: SketchPosition}>
  | Readonly<{kind: 'x' | 'y'; point: number; value: number}>
  | Readonly<{
      kind: 'horizontal' | 'vertical' | 'coincident';
      points: readonly [number, number];
    }>
  | Readonly<{
      kind: 'length' | 'angle';
      points: readonly [number, number];
      value: number;
    }>;

export type SketchSolveProblem = Readonly<{
  points: readonly Readonly<{
    position: SketchPosition;
    locked: readonly [boolean, boolean];
  }>[];
  constraints: readonly SketchSolveConstraint[];
}>;

export type SketchSolveResult = Readonly<{
  positions: readonly SketchPosition[];
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

let module: ModuleStatic;
export function installSketchSolver(instance: ModuleStatic): void {
  module = instance;
}

/** A fresh native system per solve: no previous solution or native handles escape. */
export function solveSketchProblem(
  problem: SketchSolveProblem,
  drag?: Readonly<{point: number; position: SketchPosition}>,
): SketchSolveResult {
  const {constraints} = problem;
  // A gesture may use a temporary anchor, but normal evaluation must not gain
  // an implicit fixed constraint. Coordinate constraints can also fix a point.
  const anchored = problem.points.some(
    (point, index) =>
      constraints.some(c => c.kind === 'fixed' && c.point === index) ||
      ((point.locked[0] ||
        constraints.some(c => c.kind === 'x' && c.point === index)) &&
        (point.locked[1] ||
          constraints.some(c => c.kind === 'y' && c.point === index))),
  );
  const anchor =
    drag && !anchored
      ? problem.points.findIndex((_, index) => index !== drag.point)
      : -1;
  const points = problem.points.map((point, index) => ({
    ...point,
    locked: index === anchor ? ([true, true] as const) : point.locked,
  }));
  if (!points.length)
    return {positions: [], degreesOfFreedom: 0, redundant: []};
  // Unconstrained values and edits do not need a native modeling kernel.
  if (!constraints.length)
    return {
      positions: points.map((p, index) =>
        drag?.point === index
          ? [
              p.locked[0] ? p.position[0] : drag.position[0],
              p.locked[1] ? p.position[1] : drag.position[1],
            ]
          : p.position,
      ),
      degreesOfFreedom: points.reduce(
        (sum, p) => sum + Number(!p.locked[0]) + Number(!p.locked[1]),
        0,
      ),
      redundant: [],
    };
  const origin = points[0].position;
  const scale =
    Math.max(
      ...points.flatMap(p =>
        p.position.map((v, axis) => Math.abs(v - origin[axis])),
      ),
      ...constraints.flatMap(c => (c.kind === 'length' ? [c.value] : [])),
    ) || 1;
  const normalized = (p: SketchPosition): SketchPosition => [
    (p[0] - origin[0]) / scale,
    (p[1] - origin[1]) / scale,
  ];
  const gcs = new module.GcsSystem();
  const geometries: {delete(): void}[] = [];
  try {
    gcs.set_debug_mode(0);
    gcs.set_max_iterations(100);
    gcs.set_covergence_threshold(1e-10);
    const indices = points.map(p =>
      normalized(p.position).map((v, axis) =>
        gcs.push_p_param(v, p.locked[axis]),
      ),
    );
    const nativePoints = indices.map(([x, y]) => {
      const point = gcs.make_point(x, y);
      geometries.push(point);
      return point;
    });
    const constant = (value: number) => gcs.push_p_param(value, true);
    const coordinate = (
      point: number,
      axis: number,
      value: number,
      tag: number,
    ) => {
      const method =
        axis === 0
          ? 'add_constraint_coordinate_x'
          : 'add_constraint_coordinate_y';
      gcs[method](
        nativePoints[point],
        constant((value - origin[axis]) / scale),
        tag,
        true,
        1,
      );
    };
    constraints.forEach((constraint, index) => {
      const tag = index + 1;
      if (constraint.kind === 'fixed') {
        coordinate(constraint.point, 0, constraint.position[0], tag);
        coordinate(constraint.point, 1, constraint.position[1], tag);
      } else if (constraint.kind === 'x' || constraint.kind === 'y') {
        coordinate(
          constraint.point,
          constraint.kind === 'x' ? 0 : 1,
          constraint.value,
          tag,
        );
      } else if ('points' in constraint) {
        const [a, b] = constraint.points.map(i => nativePoints[i]);
        switch (constraint.kind) {
          case 'horizontal':
            gcs.add_constraint_horizontal_pp(a, b, tag, true, 1);
            break;
          case 'vertical':
            gcs.add_constraint_vertical_pp(a, b, tag, true, 1);
            break;
          case 'coincident':
            gcs.add_constraint_p2p_coincident(a, b, tag, true, 1);
            break;
          case 'length':
            gcs.add_constraint_p2p_distance(
              a,
              b,
              constant(constraint.value / scale),
              tag,
              true,
              1,
            );
            break;
          case 'angle':
            gcs.add_constraint_p2p_angle(
              a,
              b,
              constant((constraint.value * Math.PI) / 180),
              tag,
              true,
              1,
            );
            break;
        }
      }
    });
    if (drag) {
      // Negative tags are PlaneGCS soft objectives; they neither change DOF nor
      // weaken persistent constraints. The gesture is not part of the model.
      for (const axis of [0, 1])
        if (!points[drag.point].locked[axis])
          coordinate(drag.point, axis, drag.position[axis], -1);
    }
    const status = gcs.solve_system(2);
    const conflicting = constraintIndices(gcs, 'get_conflicting');
    if (status > 1 || conflicting.length)
      throw new SketchConstraintError(
        conflicting,
        `Could not satisfy sketch constraints${conflicting.length ? ` (${conflicting.map(i => i + 1).join(', ')})` : ''}. The constraints may conflict or need a different current geometry.`,
      );
    gcs.apply_solution();
    const positions = indices.map(([x, y], index): SketchPosition => [
      points[index].locked[0]
        ? points[index].position[0]
        : gcs.get_p_param(x) * scale + origin[0],
      points[index].locked[1]
        ? points[index].position[1]
        : gcs.get_p_param(y) * scale + origin[1],
    ]);
    if (!positions.every(p => p.every(Number.isFinite)))
      throw new SketchConstraintError(
        [],
        'The sketch solver returned non-finite coordinates.',
      );
    // PlaneGCS can return Converged after removing redundant equations even
    // when the applied solution satisfies every authored constraint. Neither
    // Success nor Converged alone is our acceptance criterion: verify all hard
    // equations independently, in normalized geometry units.
    const unsatisfied = constraints.flatMap((c, i) =>
      residual(c, positions, scale) <= 1e-7 ? [] : [i],
    );
    if (unsatisfied.length)
      throw new SketchConstraintError(
        unsatisfied,
        `Sketch constraints ${unsatisfied.map(i => i + 1).join(', ')} did not converge to a valid solution.`,
      );
    return {
      positions,
      degreesOfFreedom: gcs.dof(),
      redundant: constraintIndices(gcs, 'get_redundant'),
    };
  } finally {
    for (const geometry of geometries) geometry.delete();
    gcs.clear_data();
    gcs.delete();
  }
}

function residual(
  c: SketchSolveConstraint,
  positions: readonly SketchPosition[],
  scale: number,
): number {
  switch (c.kind) {
    case 'fixed':
      return Math.hypot(
        ...positions[c.point].map((v, i) => (v - c.position[i]) / scale),
      );
    case 'x':
    case 'y':
      return (
        Math.abs(positions[c.point][c.kind === 'x' ? 0 : 1] - c.value) / scale
      );
    default: {
      const [a, b] = c.points.map(i => positions[i]);
      const dx = (b[0] - a[0]) / scale,
        dy = (b[1] - a[1]) / scale;
      switch (c.kind) {
        case 'horizontal':
          return Math.abs(dy);
        case 'vertical':
          return Math.abs(dx);
        case 'coincident':
          return Math.hypot(dx, dy);
        case 'length':
          return Math.abs(Math.hypot(dx, dy) - c.value / scale);
        case 'angle': {
          const difference = Math.atan2(dy, dx) - (c.value * Math.PI) / 180;
          return Math.abs(
            Math.atan2(Math.sin(difference), Math.cos(difference)),
          );
        }
      }
    }
  }
}

function constraintIndices(
  gcs: GcsSystem,
  method: 'get_conflicting' | 'get_redundant',
): number[] {
  const vector = gcs[method]();
  try {
    return [
      ...new Set(
        Array.from({length: vector.size()}, (_, i) => vector.get(i) - 1).filter(
          i => i >= 0,
        ),
      ),
    ];
  } finally {
    vector.delete();
  }
}
