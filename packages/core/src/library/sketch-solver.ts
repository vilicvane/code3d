import {
  SketchConstraintError,
  sketchConstraintPoints,
  type SketchSolveConstraint,
  type SketchSolveCurve,
  type SketchSolveProblem,
  type SketchSolveResult,
  type SketchSolveObjective,
  type SketchTangentContact,
  type SketchContact,
  type SketchContactBoundary,
} from './sketch-solve-model.js';
import type {GcsSystem} from '@salusoft89/planegcs/dist/planegcs_dist/gcs_system.js';
// Upstream ships this declaration alongside sources, but omits it from dist.
import type {ModuleStatic} from '@salusoft89/planegcs/planegcs_dist/planegcs.js';
import type {SketchPosition} from './sketch.js';
import {sketchArcGeometry} from './sketch-curves.js';
import {
  pointLineDistance,
  solveSketchIncidenceBounds,
  sketchIncidenceGeometry,
  sketchIncidenceCurve,
} from './sketch-incidence.js';
import {SketchPrecision} from './sketch-precision.js';
import {
  SketchContactAnalysis,
  SketchParameterAnalysis,
} from './sketch-solve-analysis.js';

let module: ModuleStatic;
export function installSketchSolver(instance: ModuleStatic): void {
  module = instance;
}

/** A fresh native system per solve: no previous solution or native handles escape. */
export function solveSketchProblem(
  problem: SketchSolveProblem,
  objectives: readonly SketchSolveObjective[] = [],
  preferredGeometry: SketchSolveProblem = problem,
): SketchSolveResult {
  problem = initializeTangencyGeometry(problem);
  const tangencies = new Map<SketchSolveConstraint, SketchTangentContact>();
  const relations = new SketchContactAnalysis(problem);
  const contacts: SketchContact[] = [...relations.contacts];
  const points = [...problem.points];
  const geometry = sketchIncidenceGeometry(problem);
  for (const [constraintIndex, c] of problem.constraints.entries()) {
    if (c.kind !== 'tangent') continue;
    const shared = relations.sharedPoint(c.curves);
    if (shared !== undefined) {
      tangencies.set(c, {point: shared, shared: true});
      contacts.push(
        ...c.curves.map(curve => ({
          curve,
          point: shared,
          sources: [constraintIndex],
          structural: false,
        })),
      );
      continue;
    }
    const point = points.length;
    const [first, second] = c.curves.map(curve =>
      sketchIncidenceCurve(geometry, curve),
    );
    let position: SketchPosition;
    if (first.kind === 'line' || second.kind === 'line') {
      const line =
        first.kind === 'line'
          ? first
          : (second as typeof first & {kind: 'line'});
      const circle =
        first.kind !== 'line'
          ? first
          : (second as Exclude<typeof first, {kind: 'line'}>);
      const [a, b] = line.points;
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t =
        ((circle.center[0] - a[0]) * dx + (circle.center[1] - a[1]) * dy) /
        (dx * dx + dy * dy);
      position = [a[0] + t * dx, a[1] + t * dy];
    } else {
      const dx = second.center[0] - first.center[0],
        dy = second.center[1] - first.center[1];
      const distance = Math.hypot(dx, dy);
      if (!distance)
        throw new SketchConstraintError(
          [constraintIndex],
          `Sketch tangent constraint ${constraintIndex + 1} cannot keep coincident circular centers.`,
        );
      const sign =
        c.mode === 'internal' && first.radius < second.radius ? -1 : 1;
      position = [
        first.center[0] + (sign * first.radius * dx) / distance,
        first.center[1] + (sign * first.radius * dy) / distance,
      ];
    }
    points.push({position, locked: [false, false]});
    tangencies.set(c, {point, shared: false});
    contacts.push(
      ...c.curves.map(curve => ({
        curve,
        point,
        sources: [constraintIndex],
        structural: false,
      })),
    );
  }
  const prepared = {...problem, points};
  const preferred = {
    ...preferredGeometry,
    points: [
      ...preferredGeometry.points,
      ...points.slice(problem.points.length),
    ],
  };
  let authoredMetadata:
    Pick<SketchSolveResult, 'degreesOfFreedom' | 'redundant'> | undefined;
  const result = solveSketchIncidenceBounds(prepared, contacts, bounds => {
    const solved = solveSketchNative(
      prepared,
      objectives,
      preferred,
      tangencies,
      bounds,
    );
    authoredMetadata ??= {
      degreesOfFreedom: solved.degreesOfFreedom,
      redundant: solved.redundant,
    };
    return solved;
  });
  return {
    ...result,
    positions: result.positions.slice(0, problem.points.length),
    ...authoredMetadata!,
  };
}

/** Native equations include solve-local tangent contacts but no persistent auxiliary geometry. */
function solveSketchNative(
  problem: SketchSolveProblem,
  objectives: readonly SketchSolveObjective[],
  preferredGeometry: SketchSolveProblem,
  tangencies: ReadonlyMap<SketchSolveConstraint, SketchTangentContact>,
  bounds: readonly SketchContactBoundary[],
): SketchSolveResult {
  const authored = preferredGeometry;
  const precision = new SketchPrecision(problem);
  problem = initializeArcEndpoints(problem, precision);
  const {constraints, points} = problem;
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
      positions: points.map((p, index) => {
        const targets = objectives
          .filter(o => o.kind === 'point')
          .filter(o => o.point === index);
        return p.position.map((value, axis) =>
          p.locked[axis]
            ? value
            : leastSquaresTarget(
                value,
                targets.map(o => ({
                  value: o.position[axis],
                  weight: o.weight,
                })),
              ),
        ) as [number, number];
      }),
      radii: problem.circles.map((circle, index) =>
        circle.locked
          ? circle.radius
          : leastSquaresTarget(
              circle.radius,
              objectives
                .filter(o => o.kind === 'radius')
                .filter(o => o.curve === 'circle' && o.index === index),
            ),
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
  const {origin, scale} = precision;
  const normalized = (p: SketchPosition): SketchPosition => [
    (p[0] - origin[0]) / scale,
    (p[1] - origin[1]) / scale,
  ];
  const gcs = new module.GcsSystem();
  const geometries: {delete(): void}[] = [];
  try {
    gcs.set_debug_mode(0);
    gcs.set_max_iterations(100);
    gcs.set_covergence_threshold(precision.convergence);
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
    const nativeLine = (points: readonly [number, number]) => {
      const [a, b] = points.map(i => indices[i]);
      const line = gcs.make_line(a[0], a[1], b[0], b[1]);
      geometries.push(line);
      return line;
    };
    const curveRadiusIndex = (curve: SketchSolveCurve) =>
      (curve.kind === 'circle' ? radiusIndices : arcRadiusIndices)[curve.index];
    const circularGeometry = (curve: SketchSolveCurve) =>
      (curve.kind === 'circle' ? problem.circles : problem.arcs)[curve.index];
    const constantTags = new Set<number>();
    const activeTags = new Set<number>();
    const auxiliarySources = new Map<number, readonly number[]>();
    const auxiliaryTag = (source: number | readonly number[]) => {
      const tag = constraints.length + auxiliarySources.size + 1;
      auxiliarySources.set(
        tag - 1,
        typeof source === 'number' ? [source - 1] : source,
      );
      return tag;
    };
    const sourceIndices = (indices: readonly number[]) => [
      ...new Set(
        indices.flatMap(index => auxiliarySources.get(index) ?? [index]),
      ),
    ];
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
      if (
        Math.abs(actual - expected) / normalization >
        precision.nativeAcceptance
      )
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
    const parameters = new SketchParameterAnalysis(problem);
    const knownCoordinate = (index: number, axis: number) =>
      parameters.coordinate(index, axis)?.value;
    const knownPosition = (index: number) => parameters.position(index);
    const knownRadius = (kind: 'circle' | 'arc', index: number) =>
      parameters.structuralRadius({kind, index})?.value;
    const coordinate = (
      point: number,
      axis: number,
      value: number,
      tag: number,
      weight = 1,
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
        weight,
      );
    };
    constraints.forEach((constraint, index) => {
      const tag = index + 1;
      if (constraint.kind === 'equalRadius') {
        const [a, b] = constraint.curves;
        const first = knownRadius(a.kind as 'circle' | 'arc', a.index);
        const second = knownRadius(b.kind as 'circle' | 'arc', b.index);
        if (first !== undefined && second !== undefined)
          checkConstant(first, second, tag);
        else
          gcs.add_constraint_equal(
            curveRadiusIndex(a),
            curveRadiusIndex(b),
            tag,
            true,
            0,
            1,
          );
      } else if (constraint.kind === 'tangent') {
        const contact = tangencies.get(constraint)!;
        const [first, second] = constraint.curves;
        const p = nativePoints[contact.point];
        if (first.kind === 'line' || second.kind === 'line') {
          const line = first.kind === 'line' ? first : second;
          const circle = first.kind !== 'line' ? first : second;
          const [a, b] = problem.lines[line.index];
          const center = circularGeometry(circle).center;
          if (!contact.shared) {
            const native = nativeLine([a, b]);
            if (circle.kind === 'circle')
              gcs.add_constraint_tangent_lc(
                native,
                nativeCircles[circle.index],
                tag,
                true,
                1,
              );
            else
              gcs.add_constraint_tangent_la(
                native,
                nativeArcs[circle.index],
                tag,
                true,
                1,
              );
            gcs.add_constraint_point_on_line_ppp(
              p,
              nativePoints[a],
              nativePoints[b],
              auxiliaryTag(tag),
              true,
              1,
            );
          }
          // A shared authored contact already belongs to both curves. Using
          // its radial perpendicular directly avoids the double root of a
          // tangent-distance equation plus a separate point-on-circle equation.
          gcs.add_constraint_perpendicular_pppp(
            nativePoints[a],
            nativePoints[b],
            nativePoints[center],
            p,
            contact.shared ? tag : auxiliaryTag(tag),
            true,
            1,
          );
        } else {
          const a = circularGeometry(first),
            b = circularGeometry(second);
          const r1 = curveRadiusIndex(first),
            r2 = curveRadiusIndex(second);
          if (contact.shared) {
            // Both radial lengths already follow from authored membership.
            // Match oriented radii directly; a center-distance equation would
            // recreate their double root at tangency. Opposite radial directions
            // encode external contact, equal directions encode internal contact.
            const center = points[a.center].position,
              position = points[contact.point].position;
            const angle = gcs.push_p_param(
              Math.atan2(position[1] - center[1], position[0] - center[0]),
              false,
            );
            gcs.add_constraint_p2p_angle(
              nativePoints[a.center],
              p,
              angle,
              auxiliaryTag(tag),
              true,
              1,
            );
            gcs.add_constraint_p2p_angle(
              constraint.mode === 'external' ? p : nativePoints[b.center],
              constraint.mode === 'external' ? nativePoints[b.center] : p,
              angle,
              tag,
              true,
              1,
            );
            return;
          }
          const distance = gcs.push_p_param(
            (constraint.mode === 'external'
              ? a.radius + b.radius
              : Math.abs(a.radius - b.radius)) / scale,
            false,
          );
          if (constraint.mode === 'external')
            gcs.add_constraint_difference(
              r1,
              distance,
              r2,
              auxiliaryTag(tag),
              true,
              1,
            );
          else
            gcs.add_constraint_difference(
              a.radius >= b.radius ? r2 : r1,
              a.radius >= b.radius ? r1 : r2,
              distance,
              auxiliaryTag(tag),
              true,
              1,
            );
          gcs.add_constraint_p2p_distance(
            nativePoints[a.center],
            nativePoints[b.center],
            distance,
            tag,
            true,
            1,
          );
          gcs.add_constraint_p2p_distance(
            nativePoints[a.center],
            p,
            r1,
            auxiliaryTag(tag),
            true,
            1,
          );
          // A support-line equation would also admit the opposite point on
          // the first circle. Share an oriented angle to retain the contact
          // branch even when a drag seed moves a center past the old contact.
          const ca = points[a.center].position,
            cb = points[b.center].position;
          const angle = gcs.push_p_param(
            Math.atan2(cb[1] - ca[1], cb[0] - ca[0]),
            false,
          );
          gcs.add_constraint_p2p_angle(
            nativePoints[a.center],
            nativePoints[b.center],
            angle,
            auxiliaryTag(tag),
            true,
            1,
          );
          const reversed =
            constraint.mode === 'internal' && a.radius < b.radius;
          gcs.add_constraint_p2p_angle(
            reversed ? p : nativePoints[a.center],
            reversed ? nativePoints[a.center] : p,
            angle,
            auxiliaryTag(tag),
            true,
            1,
          );
        }
      } else if (constraint.kind === 'sweep') {
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
      } else if (constraint.kind === 'pointOn') {
        const {point, curve} = constraint;
        if (curve.kind === 'line') {
          const [a, b] = problem.lines[curve.index];
          const known = [point, a, b].map(knownPosition);
          if (known.every(p => p !== undefined)) {
            checkConstant(
              pointLineDistance(known[0], known[1], known[2]),
              0,
              tag,
            );
            return;
          }
          gcs.add_constraint_point_on_line_ppp(
            nativePoints[point],
            nativePoints[a],
            nativePoints[b],
            tag,
            true,
            1,
          );
        } else {
          const center = circularGeometry(curve).center;
          const a = knownPosition(point),
            b = knownPosition(center);
          const radius = knownRadius(curve.kind, curve.index);
          if (a && b && radius !== undefined) {
            checkConstant(Math.hypot(a[0] - b[0], a[1] - b[1]), radius, tag);
            return;
          }
          gcs.add_constraint_p2p_distance(
            nativePoints[point],
            nativePoints[center],
            curveRadiusIndex(curve),
            tag,
            true,
            1,
          );
        }
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
      } else if (
        constraint.kind === 'parallel' ||
        constraint.kind === 'perpendicular' ||
        constraint.kind === 'equalLength' ||
        constraint.kind === 'lineAngle'
      ) {
        if (constraint.points.every(i => knownPosition(i))) {
          checkConstant(
            residual(
              constraint,
              points.map((p, i) => knownPosition(i) ?? p.position),
              [],
              [],
              problem,
              scale,
            ),
            0,
            tag,
            1,
          );
          return;
        }
        const [a, b, c, d] = constraint.points.map(i => nativePoints[i]);
        if (
          constraint.kind === 'parallel' ||
          constraint.kind === 'equalLength'
        ) {
          const [ia, ib, ic, id] = constraint.points;
          const first = nativeLine([ia, ib]);
          const second = nativeLine([ic, id]);
          if (constraint.kind === 'parallel')
            gcs.add_constraint_parallel(first, second, tag, true, 1);
          else gcs.add_constraint_equal_length(first, second, tag, true, 1);
        } else if (constraint.kind === 'perpendicular') {
          gcs.add_constraint_perpendicular_pppp(a, b, c, d, tag, true, 1);
        } else {
          gcs.add_constraint_l2l_angle_pppp(
            a,
            b,
            c,
            d,
            constant((constraint.value * Math.PI) / 180),
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
    for (const {contact, endpoint} of bounds)
      gcs.add_constraint_p2p_coincident(
        nativePoints[contact.point],
        nativePoints[endpoint],
        auxiliaryTag(contact.sources),
        true,
        1,
      );
    // ArcRules introduce an underdetermined radius/angle system. PlaneGCS
    // sorts its parameters by native address; DogLeg's FullPivLU step then
    // chooses free variables based on allocation history. BFGS initializes
    // arcs without that basic-solution pivot choice or new reference locks.
    // Non-arc systems retain the established DogLeg initialization.
    const hardAlgorithm = problem.arcs.length ? 0 : 2;
    const solve = (algorithm = hardAlgorithm) => {
      const status = gcs.solve_system(algorithm);
      const conflicting = sourceIndices(
        constraintIndices(gcs, 'get_conflicting'),
      );
      if (status > 1 || conflicting.length)
        throw new SketchConstraintError(
          conflicting,
          `Could not satisfy sketch constraints${conflicting.length ? ` (${conflicting.map(i => i + 1).join(', ')})` : ''}. The constraints may conflict or need a different current geometry.`,
        );
      gcs.apply_solution();
    };
    const redundant: number[] = [];
    if (objectives.length) {
      // Diagnose the actual model before adding soft objectives. PlaneGCS 1.2
      // otherwise includes negative tags in its redundancy consistency solve.
      // Remove only constraints proved fully redundant, retaining every author
      // equation for the independent final residual check below.
      for (;;) {
        solve();
        const found = constraintIndices(gcs, 'get_redundant');
        if (!found.length) break;
        redundant.push(...found);
        for (const index of found) gcs.clear_by_id(index + 1);
      }
    }
    for (const objective of objectives) {
      // Negative tags are PlaneGCS soft objectives; they neither change DOF nor
      // weaken persistent constraints. The gesture is not part of the model.
      if (objective.kind === 'radius') {
        if (knownRadius(objective.curve, objective.index) === undefined) {
          const args = [
            constant(objective.value / scale),
            -1,
            true,
            objective.weight,
          ] as const;
          if (objective.curve === 'arc')
            gcs.add_constraint_arc_radius(nativeArcs[objective.index], ...args);
          else
            gcs.add_constraint_circle_radius(
              nativeCircles[objective.index],
              ...args,
            );
        }
      } else
        for (const axis of [0, 1])
          if (knownCoordinate(objective.point, axis) === undefined)
            coordinate(
              objective.point,
              axis,
              objective.position[axis],
              -1,
              objective.weight,
            );
    }
    // BFGS also accepts a least-squares optimum in soft-only subsystems left
    // by equal-coordinate reduction; their residuals need not all vanish.
    solve(objectives.length ? 0 : hardAlgorithm);
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
      residual(
        c,
        positions,
        radii,
        arcRadii,
        problem,
        scale,
        positions[tangencies.get(c)?.point ?? -1],
      ) <= precision.nativeAcceptance
        ? []
        : [i],
    );
    for (const {contact, endpoint} of bounds)
      if (
        Math.hypot(
          ...positions[contact.point].map(
            (v, axis) => v - positions[endpoint][axis],
          ),
        ) /
          scale >
        precision.nativeAcceptance
      )
        unsatisfied.push(...contact.sources);
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
            precision.nativeAcceptance,
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
      ...cleanSolution(
        problem,
        {positions, radii, arcRadii},
        authored,
        objectives,
        precision,
        tangencies,
        bounds,
      ),
      degreesOfFreedom: gcs.dof(),
      redundant: [
        ...new Set([
          ...constraintIndices(gcs, 'get_redundant').filter(
            i => !auxiliarySources.has(i),
          ),
          ...redundant.filter(i => !auxiliarySources.has(i)),
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

type Geometry = Pick<SketchSolveResult, 'positions' | 'radii' | 'arcRadii'>;

/**
 * Remove numerical tails only within local feature scale, then independently
 * check the complete hard system. Exact input/gesture values take precedence;
 * close points never acquire shared identity through this numeric operation.
 */
function cleanSolution(
  problem: SketchSolveProblem,
  result: Geometry,
  authored: SketchSolveProblem,
  objectives: readonly SketchSolveObjective[],
  precision: SketchPrecision,
  tangencies: ReadonlyMap<SketchSolveConstraint, SketchTangentContact>,
  bounds: readonly SketchContactBoundary[],
): Geometry {
  const {pointScales} = precision;
  const parameters = new SketchParameterAnalysis(problem);
  const coordinate = (index: number, axis: number, value: number) => {
    if (problem.points[index].locked[axis]) return value;
    const exact = parameters.coordinate(index, axis);
    if (exact) return exact.value;
    return precision.clean(value, pointScales[index], [
      ...objectives
        .filter(o => o.kind === 'point')
        .filter(o => o.point === index)
        .map(o => o.position[axis]),
      authored.points[index].position[axis],
    ]);
  };
  const radius = (curve: 'circle' | 'arc', index: number, value: number) => {
    const entities = curve === 'circle' ? problem.circles : problem.arcs;
    if (entities[index].locked) return value;
    const known = parameters.seedRadius({kind: curve, index});
    if (known) return known.value;
    return precision.clean(value, value, [
      (curve === 'circle' ? authored.circles : authored.arcs)[index].radius,
    ]);
  };
  const candidate: Geometry = {
    positions: result.positions.map(
      (p, i) =>
        p.map((value, axis) => coordinate(i, axis, value)) as [number, number],
    ),
    radii: result.radii.map((value, i) => radius('circle', i, value)),
    arcRadii: result.arcRadii.map((value, i) => radius('arc', i, value)),
  };
  // A stricter threshold than native solve acceptance prevents cleanup from
  // consuming its tolerance budget. Use each equation's own geometry scale.
  const valid =
    problem.constraints.every(c => {
      const scale =
        c.kind === 'length' || c.kind === 'radius'
          ? c.value
          : c.kind === 'sweep'
            ? problem.arcs[c.index].radius
            : Math.min(
                ...sketchConstraintPoints(problem, c).map(i => pointScales[i]),
              );
      return (
        residual(
          c,
          candidate.positions,
          candidate.radii,
          candidate.arcRadii,
          problem,
          scale,
          candidate.positions[tangencies.get(c)?.point ?? -1],
        ) <= precision.relative
      );
    }) &&
    bounds.every(
      ({contact, endpoint}) =>
        Math.hypot(
          ...candidate.positions[contact.point].map(
            (v, axis) => v - candidate.positions[endpoint][axis],
          ),
        ) <=
        precision.tolerance(
          Math.min(pointScales[contact.point], pointScales[endpoint]),
        ),
    ) &&
    problem.arcs.every(
      (arc, i) =>
        candidate.positions[arc.points[0]].some(
          (v, axis) => v !== candidate.positions[arc.points[1]][axis],
        ) &&
        arc.points.every(
          index =>
            Math.abs(
              Math.hypot(
                ...candidate.positions[index].map(
                  (v, axis) => v - candidate.positions[arc.center][axis],
                ),
              ) - candidate.arcRadii[i],
            ) <= precision.tolerance(arc.radius, candidate.arcRadii[i]),
        ),
    ) &&
    problem.lines.every(([a, b]) =>
      candidate.positions[a].some(
        (v, axis) => v !== candidate.positions[b][axis],
      ),
    );
  return valid ? candidate : result;
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
  precision: SketchPrecision,
): SketchSolveProblem {
  if (!problem.arcs.length) return problem;
  const parameters = new SketchParameterAnalysis(problem);
  // An explicit radius already determines this scalar. Start there rather than
  // projecting satisfied endpoints to conflicting data and asking an
  // underconstrained solve to shrink them again (which can translate the arc).
  // Keep locked values and all equations: contradictory dimensions still fail.
  const arcs = problem.arcs.map((arc, index) => {
    const radius = parameters.seedRadius({kind: 'arc', index});
    return !arc.locked && radius ? {...arc, radius: radius.value} : arc;
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
      // Already valid current geometry is a seed, not an instruction to
      // re-project rounded solver output on every forward compilation.
      if (Math.abs(length - arc.radius) <= precision.tolerance(arc.radius))
        continue;
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
        if (!targets.length || parameters.coordinate(index, axis) !== undefined)
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

/** Choose a nonsingular seed from authored dimensions, without adding locks or
 * selecting a different tangent mode. Initial concentric circles are ordinary
 * editable geometry; only centers that cannot separate are incompatible. */
function initializeTangencyGeometry(
  problem: SketchSolveProblem,
): SketchSolveProblem {
  if (!problem.constraints.some(c => c.kind === 'tangent')) return problem;
  const parameters = new SketchParameterAnalysis(problem);
  const knownCoordinate = (index: number, axis: number) =>
    parameters.coordinate(index, axis)?.value;
  const points = problem.points.map((p, index) => ({
    ...p,
    position: p.position.map(
      (value, axis) => knownCoordinate(index, axis) ?? value,
    ) as [number, number],
  }));
  const circles = problem.circles.map((c, index) => ({
    ...c,
    radius: parameters.seedRadius({kind: 'circle', index})?.value ?? c.radius,
  }));
  const arcs = problem.arcs.map((c, index) => ({
    ...c,
    radius: parameters.seedRadius({kind: 'arc', index})?.value ?? c.radius,
  }));
  const circular = (curve: SketchSolveCurve) =>
    (curve.kind === 'circle' ? circles : arcs)[curve.index];
  const moveSeed = (index: number, offset: SketchPosition) => {
    const moved = offset.map((value, axis) =>
      knownCoordinate(index, axis) === undefined ? value : 0,
    );
    for (const axis of [0, 1]) points[index].position[axis] += moved[axis];
    const endpoints = new Set(
      arcs.filter(arc => arc.center === index).flatMap(arc => [...arc.points]),
    );
    for (const endpoint of endpoints)
      for (const axis of [0, 1])
        if (knownCoordinate(endpoint, axis) === undefined)
          points[endpoint].position[axis] += moved[axis];
  };
  for (const [index, c] of problem.constraints.entries()) {
    if (c.kind !== 'tangent') continue;
    const line = c.curves.find(curve => curve.kind === 'line');
    if (line) {
      const curve = circular(c.curves.find(curve => curve.kind !== 'line')!);
      const endpoints = problem.lines[line.index];
      const [a, b] = endpoints.map(point => points[point].position);
      if (pointLineDistance(points[curve.center].position, a, b)) continue;
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy);
      const normal: SketchPosition = [-dy / length, dx / length];
      const freeNormal = normal.map((value, axis) =>
        knownCoordinate(curve.center, axis) === undefined ? value : 0,
      );
      const squared = freeNormal.reduce((sum, value) => sum + value * value, 0);
      if (!endpoints.includes(curve.center) && squared) {
        moveSeed(curve.center, [
          (freeNormal[0] * curve.radius) / squared,
          (freeNormal[1] * curve.radius) / squared,
        ]);
      } else {
        // Native distance is singular at zero offset. Move free line axes as
        // a seed; authored orientation and length remain ordinary equations.
        for (const endpoint of endpoints)
          if (endpoint !== curve.center)
            moveSeed(endpoint, [
              -normal[0] * curve.radius,
              -normal[1] * curve.radius,
            ]);
      }
      continue;
    }
    const [a, b] = c.curves.map(circular);
    if (
      points[a.center].position.some(
        (v, axis) => v !== points[b.center].position[axis],
      )
    )
      continue;
    let distance =
      c.mode === 'external'
        ? a.radius + b.radius
        : Math.abs(a.radius - b.radius);
    if (!distance) {
      const free = c.curves.find(curve => !parameters.seedRadius(curve));
      if (free) {
        circular(free).radius *= 1.25;
        distance = Math.abs(a.radius - b.radius);
      }
    }
    const axis = [0, 1].find(
      axis =>
        knownCoordinate(b.center, axis) === undefined ||
        knownCoordinate(a.center, axis) === undefined,
    );
    if (a.center === b.center || axis === undefined || !distance)
      throw new SketchConstraintError(
        [index],
        `Sketch tangent constraint ${index + 1} cannot keep coincident circular centers.`,
      );
    const center =
      knownCoordinate(b.center, axis) === undefined ? b.center : a.center;
    const sign = center === b.center ? 1 : -1;
    // Free arc endpoints follow a moved seed center, retaining their angular
    // branch; shared endpoints receive this translation only once.
    moveSeed(center, axis === 0 ? [sign * distance, 0] : [0, sign * distance]);
  }
  return {...problem, points, circles, arcs};
}

function residual(
  c: SketchSolveConstraint,
  positions: readonly SketchPosition[],
  radii: readonly number[],
  arcRadii: readonly number[],
  problem: SketchSolveProblem,
  scale: number,
  contact?: SketchPosition,
): number {
  switch (c.kind) {
    case 'equalRadius': {
      const [a, b] = c.curves.map(
        curve => (curve.kind === 'circle' ? radii : arcRadii)[curve.index],
      );
      return Math.abs(a - b) / scale;
    }
    case 'tangent': {
      const [first, second] = c.curves;
      const circular = (curve: SketchSolveCurve) => ({
        center:
          positions[
            (curve.kind === 'circle' ? problem.circles : problem.arcs)[
              curve.index
            ].center
          ],
        radius: (curve.kind === 'circle' ? radii : arcRadii)[curve.index],
      });
      if (first.kind === 'line' || second.kind === 'line') {
        const line = first.kind === 'line' ? first : second;
        const circle = circular(first.kind !== 'line' ? first : second);
        const [a, b] = problem.lines[line.index].map(i => positions[i]);
        const radial: SketchPosition = [
          contact![0] - circle.center[0],
          contact![1] - circle.center[1],
        ];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return Math.max(
          Math.max(
            Math.abs(pointLineDistance(circle.center, a, b) - circle.radius),
            pointLineDistance(contact!, a, b),
            Math.abs(Math.hypot(...radial) - circle.radius),
          ) / scale,
          Math.abs((b[0] - a[0]) * radial[0] + (b[1] - a[1]) * radial[1]) /
            (length * circle.radius),
        );
      }
      const a = circular(first),
        b = circular(second);
      const distance = Math.hypot(
        b.center[0] - a.center[0],
        b.center[1] - a.center[1],
      );
      if (!distance || a.radius <= 0 || b.radius <= 0) return Infinity;
      return (
        Math.max(
          Math.abs(
            distance -
              (c.mode === 'external'
                ? a.radius + b.radius
                : Math.abs(a.radius - b.radius)),
          ),
          ...[a, b].map(circle =>
            Math.abs(
              Math.hypot(
                contact![0] - circle.center[0],
                contact![1] - circle.center[1],
              ) - circle.radius,
            ),
          ),
        ) / scale
      );
    }
    case 'equalLength': {
      const [a, b, d, e] = c.points.map(i => positions[i]);
      return (
        Math.abs(
          Math.hypot(b[0] - a[0], b[1] - a[1]) -
            Math.hypot(e[0] - d[0], e[1] - d[1]),
        ) / scale
      );
    }
    case 'parallel':
    case 'perpendicular':
    case 'lineAngle': {
      const [a, b, d, e] = c.points.map(i => positions[i]);
      const x1 = b[0] - a[0],
        y1 = b[1] - a[1];
      const x2 = e[0] - d[0],
        y2 = e[1] - d[1];
      const length = Math.hypot(x1, y1) * Math.hypot(x2, y2);
      if (!length) return Infinity;
      if (c.kind === 'parallel') return Math.abs(x1 * y2 - y1 * x2) / length;
      if (c.kind === 'perpendicular')
        return Math.abs(x1 * x2 + y1 * y2) / length;
      const difference =
        Math.atan2(y2, x2) - Math.atan2(y1, x1) - (c.value * Math.PI) / 180;
      return Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference)));
    }
    case 'pointOn': {
      const p = positions[c.point];
      if (c.curve.kind === 'line') {
        const [a, b] = problem.lines[c.curve.index].map(i => positions[i]);
        return pointLineDistance(p, a, b) / scale;
      }
      const curve = (
        c.curve.kind === 'circle' ? problem.circles : problem.arcs
      )[c.curve.index];
      const center = positions[curve.center];
      const radius = (c.curve.kind === 'circle' ? radii : arcRadii)[
        c.curve.index
      ];
      return (
        Math.abs(Math.hypot(p[0] - center[0], p[1] - center[1]) - radius) /
        scale
      );
    }
    case 'sweep': {
      const arc = problem.arcs[c.index];
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

/** Native scale weights multiply residuals, so their squares weight the mean. */
function leastSquaresTarget(
  current: number,
  targets: readonly Readonly<{value: number; weight: number}>[],
): number {
  if (!targets.length) return current;
  const total = targets.reduce((sum, target) => sum + target.weight ** 2, 0);
  return (
    targets.reduce(
      (sum, target) => sum + target.value * target.weight ** 2,
      0,
    ) / total
  );
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
