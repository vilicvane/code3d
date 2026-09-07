import type {GcsSystem, ModuleStatic} from '@salusoft89/planegcs';
import type {SketchPosition} from './sketch.js';

/** Evaluation-local numeric indices, never author entity or constraint IDs. */
export type SketchSolveConstraint =
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

export type SketchSolveProblem = Readonly<{
  points: readonly Readonly<{
    position: SketchPosition;
    locked: readonly [boolean, boolean];
  }>[];
  circles: readonly Readonly<{
    center: number;
    radius: number;
    locked: boolean;
  }>[];
  arcs: readonly Readonly<{
    center: number;
    points: readonly [number, number];
  }>[];
  constraints: readonly SketchSolveConstraint[];
}>;

export type SketchSolveResult = Readonly<{
  positions: readonly SketchPosition[];
  radii: readonly number[];
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
  drag?:
    | Readonly<{kind: 'point'; point: number; position: SketchPosition}>
    | Readonly<{kind: 'radius'; circle: number; value: number}>,
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
      ? problem.points.findIndex(
          (_, index) => drag.kind !== 'point' || index !== drag.point,
        )
      : -1;
  const points = problem.points.map((point, index) => ({
    ...point,
    locked: index === anchor ? ([true, true] as const) : point.locked,
  }));
  if (!points.length)
    return {positions: [], radii: [], degreesOfFreedom: 0, redundant: []};
  // Unconstrained values and edits do not need a native modeling kernel.
  if (!constraints.length && !problem.arcs.length)
    return {
      positions: points.map((p, index) =>
        drag?.kind === 'point' && drag.point === index
          ? [
              p.locked[0] ? p.position[0] : drag.position[0],
              p.locked[1] ? p.position[1] : drag.position[1],
            ]
          : p.position,
      ),
      radii: problem.circles.map((circle, index) =>
        drag?.kind === 'radius' && drag.circle === index && !circle.locked
          ? drag.value
          : circle.radius,
      ),
      degreesOfFreedom:
        problem.circles.filter(c => !c.locked).length +
        points.reduce(
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
      ...problem.circles.map(c => c.radius),
      ...constraints.flatMap(c =>
        c.kind === 'length' || c.kind === 'radius' ? [c.value] : [],
      ),
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
    const radiusIndices = problem.circles.map(c =>
      gcs.push_p_param(c.radius / scale, c.locked),
    );
    const nativeCircles = problem.circles.map((circle, i) => {
      const [x, y] = indices[circle.center];
      const geometry = gcs.make_circle(x, y, radiusIndices[i]);
      geometries.push(geometry);
      return geometry;
    });
    const arcRadiusIndices: number[] = [];
    const nativeArcs = problem.arcs.map(arc => {
      const center = points[arc.center].position;
      const [start, end] = arc.points.map(i => points[i].position);
      const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
      if (
        radius === 0 ||
        Math.hypot(end[0] - center[0], end[1] - center[1]) === 0 ||
        Math.hypot(end[0] - start[0], end[1] - start[1]) === 0
      )
        throw new Error(
          'Sketch arcs require a nonzero radius and distinct endpoints; use circle for a full circle.',
        );
      const angles = [start, end].map(p =>
        gcs.push_p_param(Math.atan2(p[1] - center[1], p[0] - center[0]), false),
      );
      const radiusIndex = gcs.push_p_param(radius / scale, false);
      arcRadiusIndices.push(radiusIndex);
      const [cx, cy] = indices[arc.center],
        [sx, sy] = indices[arc.points[0]],
        [ex, ey] = indices[arc.points[1]];
      const geometry = gcs.make_arc(
        cx,
        cy,
        sx,
        sy,
        ex,
        ey,
        angles[0],
        angles[1],
        radiusIndex,
      );
      geometries.push(geometry);
      // Structural equations, not authored constraints or persistent angles.
      gcs.add_constraint_arc_rules(geometry, 0, true, 1);
      return geometry;
    });
    const constant = (value: number) => gcs.push_p_param(value, true);
    const constantTags = new Set<number>();
    const activeTags = new Set<number>();
    // A locked parameter equation has no unknowns. Check it directly instead
    // of passing a zero-Jacobian row to native redundancy analysis: that
    // analysis also solves the mouse objective and can mistake an already
    // satisfied constant row for a conflict when a different axis cannot move.
    const checkConstant = (actual: number, expected: number, tag: number) => {
      if (Math.abs(actual - expected) / scale > 1e-7)
        throw new SketchConstraintError(
          [tag - 1],
          `Could not satisfy sketch constraints (${tag}). A locked geometry parameter contradicts the constraint.`,
        );
      constantTags.add(tag);
    };
    const coordinate = (
      point: number,
      axis: number,
      value: number,
      tag: number,
    ) => {
      if (points[point].locked[axis]) {
        checkConstant(points[point].position[axis], value, tag);
        return;
      }
      activeTags.add(tag);
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
      if (constraint.kind === 'radius') {
        const circle =
          constraint.curve === 'circle'
            ? problem.circles[constraint.index]
            : undefined;
        if (circle?.locked) checkConstant(circle.radius, constraint.value, tag);
        else {
          activeTags.add(tag);
          const args = [
            constant(constraint.value / scale),
            tag,
            true,
            1,
          ] as const;
          if (constraint.curve === 'arc')
            gcs.add_constraint_arc_radius(
              nativeArcs[constraint.index],
              ...args,
            );
          else
            gcs.add_constraint_circle_radius(
              nativeCircles[constraint.index],
              ...args,
            );
        }
      } else if (constraint.kind === 'fixed') {
        coordinate(constraint.point, 0, constraint.position[0], tag);
        coordinate(constraint.point, 1, constraint.position[1], tag);
      } else if (constraint.kind === 'x' || constraint.kind === 'y') {
        coordinate(
          constraint.point,
          constraint.kind === 'x' ? 0 : 1,
          constraint.value,
          tag,
        );
      } else if (constraint.kind === 'midpoint') {
        const [m, a, b] = constraint.points;
        // M - A = B - M, independently on each axis. Shared free difference
        // parameters keep these equations linear, even when A and B coincide.
        // Native point symmetry uses a line/bisector and is singular there.
        for (const axis of [0, 1]) {
          const difference = gcs.push_p_param(
            (points[m].position[axis] - points[a].position[axis]) / scale,
            false,
          );
          // PlaneGCS difference is second - first, not first - second.
          gcs.add_constraint_difference(
            indices[a][axis],
            indices[m][axis],
            difference,
            tag,
            true,
            1,
          );
          gcs.add_constraint_difference(
            indices[m][axis],
            indices[b][axis],
            difference,
            tag,
            true,
            1,
          );
        }
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
      if (drag.kind === 'radius') {
        if (!problem.circles[drag.circle].locked)
          gcs.add_constraint_circle_radius(
            nativeCircles[drag.circle],
            constant(drag.value / scale),
            -1,
            true,
            1,
          );
      } else
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
    const radii = radiusIndices.map((index, i) =>
      problem.circles[i].locked
        ? problem.circles[i].radius
        : gcs.get_p_param(index) * scale,
    );
    const arcRadii = arcRadiusIndices.map(
      index => gcs.get_p_param(index) * scale,
    );
    if (
      !positions.every(p => p.every(Number.isFinite)) ||
      !radii.every(Number.isFinite) ||
      !arcRadii.every(Number.isFinite)
    )
      throw new SketchConstraintError(
        [],
        'The sketch solver returned non-finite geometry parameters.',
      );
    // PlaneGCS can return Converged after removing redundant equations even
    // when the applied solution satisfies every authored constraint. Neither
    // Success nor Converged alone is our acceptance criterion: verify all hard
    // equations independently, in normalized geometry units.
    const unsatisfied = constraints.flatMap((c, i) =>
      residual(c, positions, radii, arcRadii, scale) <= 1e-7 ? [] : [i],
    );
    for (const [i, arc] of problem.arcs.entries()) {
      const center = positions[arc.center];
      if (
        arcRadii[i] <= 0 ||
        arc.points.some(
          point =>
            Math.abs(
              Math.hypot(
                positions[point][0] - center[0],
                positions[point][1] - center[1],
              ) - arcRadii[i],
            ) /
              scale >
            1e-7,
        )
      )
        throw new SketchConstraintError(
          [],
          'The sketch solver did not satisfy the arc geometry.',
        );
    }
    if (unsatisfied.length)
      throw new SketchConstraintError(
        unsatisfied,
        `Sketch constraints ${unsatisfied.map(i => i + 1).join(', ')} did not converge to a valid solution.`,
      );
    return {
      positions,
      radii,
      degreesOfFreedom: gcs.dof(),
      redundant: [
        ...new Set([
          ...constraintIndices(gcs, 'get_redundant'),
          ...[...constantTags]
            .filter(tag => !activeTags.has(tag))
            .map(tag => tag - 1),
        ]),
      ].sort((a, b) => a - b),
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
  radii: readonly number[],
  arcRadii: readonly number[],
  scale: number,
): number {
  switch (c.kind) {
    case 'radius':
      return (
        Math.abs((c.curve === 'circle' ? radii : arcRadii)[c.index] - c.value) /
        scale
      );
    case 'fixed':
      return Math.hypot(
        ...positions[c.point].map((v, i) => (v - c.position[i]) / scale),
      );
    case 'x':
    case 'y':
      return (
        Math.abs(positions[c.point][c.kind === 'x' ? 0 : 1] - c.value) / scale
      );
    case 'midpoint': {
      const [m, a, b] = c.points.map(i => positions[i]);
      return Math.hypot(
        ...m.map(
          (v, axis) => ((v - a[axis]) / scale + (v - b[axis]) / scale) / 2,
        ),
      );
    }
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
