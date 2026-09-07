import type {GcsSystem, ModuleStatic} from '@salusoft89/planegcs';
import type {SketchArcDirection, SketchPosition} from './sketch.js';
import {sketchArcGeometry} from './sketch-curves.js';

/** Evaluation-local numeric indices, never author entity or constraint IDs. */
export type SketchSolveConstraint =
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

let module: ModuleStatic;
export function installSketchSolver(instance: ModuleStatic): void {
  module = instance;
}

type SketchDrag =
  | Readonly<{kind: 'point'; point: number; position: SketchPosition}>
  | Readonly<{
      kind: 'radius';
      curve: 'circle' | 'arc';
      index: number;
      value: number;
    }>;

/** Connectivity is by point identity, not incidental intersections or positions. */
function gestureAnchor(problem: SketchSolveProblem, drag: SketchDrag): number {
  const neighbors = problem.points.map(() => new Set<number>());
  const connect = (points: readonly number[]) => {
    for (const point of points.slice(1)) {
      neighbors[points[0]].add(point);
      neighbors[point].add(points[0]);
    }
  };
  problem.lines.forEach(connect);
  problem.arcs.forEach(arc => connect([arc.center, ...arc.points]));
  for (const constraint of problem.constraints)
    if ('points' in constraint) connect(constraint.points);
  const seed =
    drag.kind === 'point'
      ? drag.point
      : (drag.curve === 'circle' ? problem.circles : problem.arcs)[drag.index]
          .center;
  const related = new Set([seed]);
  for (const point of related)
    for (const neighbor of neighbors[point]) related.add(neighbor);

  // Only a lock in this component replaces the temporary anchor. A normal
  // evaluation never gains an implicit fixed constraint.
  const anchored = problem.points.some(
    (point, index) =>
      related.has(index) &&
      (problem.constraints.some(c => c.kind === 'fixed' && c.point === index) ||
        ((point.locked[0] ||
          problem.constraints.some(c => c.kind === 'x' && c.point === index)) &&
          (point.locked[1] ||
            problem.constraints.some(
              c => c.kind === 'y' && c.point === index,
            )))),
  );
  return anchored
    ? -1
    : problem.points.findIndex(
        (_, index) =>
          related.has(index) && (drag.kind !== 'point' || index !== drag.point),
      );
}

/** A fresh native system per solve: no previous solution or native handles escape. */
export function solveSketchProblem(
  problem: SketchSolveProblem,
  drag?: SketchDrag,
): SketchSolveResult {
  problem = initializeArcEndpoints(problem);
  const {constraints} = problem;
  const anchor = drag ? gestureAnchor(problem, drag) : -1;
  const points = problem.points.map((point, index) => ({
    ...point,
    locked: index === anchor ? ([true, true] as const) : point.locked,
  }));
  if (!points.length)
    return {
      positions: [],
      radii: [],
      arcRadii: [],
      degreesOfFreedom: 0,
      redundant: [],
    };
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
        drag?.kind === 'radius' &&
        drag.curve === 'circle' &&
        drag.index === index &&
        !circle.locked
          ? drag.value
          : circle.radius,
      ),
      arcRadii: [],
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
      ...problem.arcs.map(a => a.radius),
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
    const arcAngleIndices: number[][] = [];
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
      const curve = sketchArcGeometry(center, start, end, arc.direction);
      // Unwrap on the authored directed branch, including major arcs. These
      // parameters are solve-local; persisted endpoints reconstruct the branch.
      const angles = [curve.start, curve.start + curve.sweep].map(angle =>
        gcs.push_p_param(angle, false),
      );
      arcAngleIndices.push(angles);
      const radiusIndex = gcs.push_p_param(arc.radius / scale, arc.locked);
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
    const checkConstant = (
      actual: number,
      expected: number,
      tag: number,
      normalization = scale,
    ) => {
      if (Math.abs(actual - expected) / normalization > 1e-7)
        throw new SketchConstraintError(
          [tag - 1],
          `Could not satisfy sketch constraints (${tag}). A locked geometry parameter contradicts the constraint.`,
        );
      constantTags.add(tag);
    };
    // ArcRules also determine dimensions from known point coordinates. Such
    // dimensions are constant equations just like a locked circle radius;
    // sending them again to native redundancy analysis can falsely conflict
    // with an unreachable mouse target even though all hard equations hold.
    const knownCoordinate = (
      index: number,
      axis: number,
    ): number | undefined => {
      if (points[index].locked[axis]) return points[index].position[axis];
      const fixed = constraints.find(
        c => c.kind === 'fixed' && c.point === index,
      );
      if (fixed?.kind === 'fixed') return fixed.position[axis];
      const coordinate = constraints.find(
        c => c.kind === (axis === 0 ? 'x' : 'y') && c.point === index,
      );
      return coordinate && 'value' in coordinate ? coordinate.value : undefined;
    };
    const knownPosition = (index: number): SketchPosition | undefined => {
      const x = knownCoordinate(index, 0),
        y = knownCoordinate(index, 1);
      return x !== undefined && y !== undefined ? [x, y] : undefined;
    };
    const knownRadius = (
      kind: 'circle' | 'arc',
      index: number,
    ): number | undefined => {
      const curve = (kind === 'circle' ? problem.circles : problem.arcs)[index];
      if (curve.locked) return curve.radius;
      if (kind === 'circle') return undefined;
      const arc = problem.arcs[index];
      const center = knownPosition(arc.center);
      const endpoint =
        knownPosition(arc.points[0]) ?? knownPosition(arc.points[1]);
      return center && endpoint
        ? Math.hypot(endpoint[0] - center[0], endpoint[1] - center[1])
        : undefined;
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
      if (constraint.kind === 'sweep') {
        const arc = problem.arcs[constraint.index];
        const center = knownPosition(arc.center),
          a = knownPosition(arc.points[0]),
          b = knownPosition(arc.points[1]);
        if (center && a && b) {
          checkConstant(
            Math.abs(sketchArcGeometry(center, a, b, arc.direction).sweep),
            (constraint.value * Math.PI) / 180,
            tag,
            1,
          );
          return;
        }
        const [start, end] = arcAngleIndices[constraint.index];
        const sign =
          problem.arcs[constraint.index].direction === 'ccw' ? 1 : -1;
        gcs.add_constraint_difference(
          start,
          end,
          constant((sign * constraint.value * Math.PI) / 180),
          tag,
          true,
          1,
        );
      } else if (constraint.kind === 'radius') {
        const known = knownRadius(constraint.curve, constraint.index);
        if (known !== undefined) checkConstant(known, constraint.value, tag);
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
        if (knownRadius(drag.curve, drag.index) === undefined) {
          const args = [constant(drag.value / scale), -1, true, 1] as const;
          if (drag.curve === 'arc')
            gcs.add_constraint_arc_radius(nativeArcs[drag.index], ...args);
          else
            gcs.add_constraint_circle_radius(
              nativeCircles[drag.index],
              ...args,
            );
        }
      } else
        for (const axis of [0, 1])
          if (knownCoordinate(drag.point, axis) === undefined)
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
    const arcRadii = arcRadiusIndices.map((index, i) =>
      problem.arcs[i].locked
        ? problem.arcs[i].radius
        : gcs.get_p_param(index) * scale,
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
      residual(c, positions, radii, arcRadii, problem.arcs, scale) <= 1e-7
        ? []
        : [i],
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
      arcRadii,
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

/**
 * Radius is current geometry, not a fixed dimension. Seed free endpoint axes
 * along their authored directions before solving structural and authored
 * equations together. Shared endpoints average simultaneous proposals, the
 * least-squares starting position, rather than giving the last arc ownership.
 * No initialization objective or lock enters the solver or model DOF.
 */
function initializeArcEndpoints(
  problem: SketchSolveProblem,
): SketchSolveProblem {
  if (!problem.arcs.length) return problem;
  // An explicit radius already determines this scalar. Start there rather than
  // projecting satisfied endpoints to conflicting data and asking an
  // underconstrained solve to shrink them again (which can translate the arc).
  // Keep locked values and all equations: contradictory dimensions still fail.
  const arcs = problem.arcs.map((arc, index) => {
    const dimension = problem.constraints.find(
      c => c.kind === 'radius' && c.curve === 'arc' && c.index === index,
    );
    return !arc.locked && dimension?.kind === 'radius'
      ? {...arc, radius: dimension.value}
      : arc;
  });
  const proposals = problem.points.map(() => [] as SketchPosition[]);
  for (const arc of arcs) {
    const center = problem.points[arc.center].position;
    for (const index of arc.points) {
      const point = problem.points[index].position;
      const dx = point[0] - center[0],
        dy = point[1] - center[1];
      const length = Math.hypot(dx, dy);
      if (!length)
        throw new Error(
          'Sketch arcs require a nonzero radius and distinct endpoints; use circle for a full circle.',
        );
      proposals[index].push([
        center[0] + (dx / length) * arc.radius,
        center[1] + (dy / length) * arc.radius,
      ]);
    }
  }
  return {
    ...problem,
    arcs,
    points: problem.points.map((point, index) => {
      const coordinate = (axis: 0 | 1) => {
        const value = point.position[axis];
        const targets = proposals[index];
        if (
          !targets.length ||
          point.locked[axis] ||
          problem.constraints.some(
            c =>
              (c.kind === 'fixed' || c.kind === 'x' || c.kind === 'y') &&
              c.point === index &&
              (c.kind === 'fixed' || c.kind === (axis === 0 ? 'x' : 'y')),
          )
        )
          return value;
        return targets.reduce(
          (sum, p) => sum + (p[axis] - value) / targets.length,
          value,
        );
      };
      return {...point, position: [coordinate(0), coordinate(1)]};
    }),
  };
}

function residual(
  c: SketchSolveConstraint,
  positions: readonly SketchPosition[],
  radii: readonly number[],
  arcRadii: readonly number[],
  arcs: SketchSolveProblem['arcs'],
  scale: number,
): number {
  switch (c.kind) {
    case 'sweep': {
      const arc = arcs[c.index];
      const curve = sketchArcGeometry(
        positions[arc.center],
        positions[arc.points[0]],
        positions[arc.points[1]],
        arc.direction,
      );
      return Math.abs(Math.abs(curve.sweep) - (c.value * Math.PI) / 180);
    }
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
