import {
  solveSketchProblem,
  type SketchSolveObjective,
  type SketchSolveProblem,
  type SketchSolveTarget,
  type SketchSolveConstraint,
} from './sketch-solver.js';
import type {SketchPosition} from './sketch.js';
import {
  sketchIncidences,
  sketchIncidenceGeometry,
  sketchIncidencePoints,
  sketchIncidenceCurve,
  sketchIncidenceBoundary,
  type SketchIncidence,
  type SketchIncidenceGeometry,
} from './sketch-incidence.js';
import {
  sketchCurveClosestParameter,
  sketchCurvePosition,
} from './sketch-curves.js';

export type SketchDragContext = Readonly<{
  reference: SketchSolveProblem;
  target: SketchSolveTarget;
  /** Displayed gesture-start geometry, before applying AST coordinate locks. */
  geometry?: SketchIncidenceGeometry;
}>;
export type SketchDragPlan = Readonly<{
  problem: SketchSolveProblem;
  objectives: readonly [SketchSolveObjective, ...SketchSolveObjective[]];
  incidences?: readonly SketchIncidence[];
}>;
export type SketchDragSession = (
  current: SketchSolveProblem,
  target: SketchSolveTarget,
) => SketchDragPlan;
export type SketchDragRule = (
  context: SketchDragContext,
) => SketchDragSession | undefined;

/** Dispatch knows neither point roles nor connected components. */
export function createSketchDragSession(
  context: SketchDragContext,
  rules: readonly SketchDragRule[] = dragRules,
): SketchDragSession {
  for (const rule of rules) {
    const session = rule(context);
    if (session) return session;
  }
  throw new Error('No sketch drag rule matched the gesture.');
}

export function solveSketchDrag(
  current: SketchSolveProblem,
  target: SketchSolveTarget,
  reference: SketchSolveProblem,
  geometry?: SketchDragContext['geometry'],
) {
  const plan = createSketchDragSession({reference, target, geometry})(
    current,
    target,
  );
  const bounds = new Map<SketchIncidence, number>();
  for (;;) {
    const problem = {
      ...plan.problem,
      constraints: [
        ...plan.problem.constraints,
        ...[...bounds].map(([contact, endpoint]) => ({
          kind: 'coincident' as const,
          points: [contact.point, endpoint] as const,
        })),
      ],
    };
    const result = solveDragPlan({...plan, problem});
    const solved = sketchIncidenceGeometry(problem, result);
    const outside = plan.incidences?.flatMap(contact => {
      const endpoint = bounds.has(contact)
        ? undefined
        : sketchIncidenceBoundary(solved, contact);
      return endpoint === undefined ? [] : [{contact, endpoint}];
    })[0];
    if (!outside) return result;
    bounds.set(outside.contact, outside.endpoint);
  }
}

function solveDragPlan(plan: SketchDragPlan) {
  const [primary, ...preferences] = plan.objectives;
  const reached = solveSketchProblem(plan.problem, [primary]);
  if (!preferences.length) return reached;
  // Lexicographic stages, not tiny weights: find the closest feasible mouse
  // target first, then preserve that achieved value while optimizing soft stays.
  // No automatically selected anchor ever becomes a fixed parameter.
  return solveSketchProblem(
    {
      ...plan.problem,
      points: plan.problem.points.map((point, index) => ({
        position: reached.positions[index],
        locked:
          primary.kind === 'point' && primary.point === index
            ? [true, true]
            : point.locked,
      })),
      circles: plan.problem.circles.map((circle, index) => ({
        ...circle,
        radius: reached.radii[index],
        locked:
          circle.locked ||
          (primary.kind === 'radius' &&
            primary.curve === 'circle' &&
            primary.index === index),
      })),
      arcs: plan.problem.arcs.map((arc, index) => ({
        ...arc,
        radius: reached.arcRadii[index],
        locked:
          arc.locked ||
          (primary.kind === 'radius' &&
            primary.curve === 'arc' &&
            primary.index === index),
      })),
    },
    preferences,
  );
}

type PointPolicy = Readonly<{
  anchors: readonly number[];
  translate: readonly number[];
  arcs: readonly number[];
}>;

const radiusRule: SketchDragRule = ({reference, target}) => {
  if (target.kind !== 'radius') return;
  const curve = (target.curve === 'arc' ? reference.arcs : reference.circles)[
    target.index
  ];
  return (current, updated) => {
    const next = updated as typeof target;
    const suggestions = new Map<number, SketchPosition[]>();
    const dimension = reference.constraints.find(
      c =>
        c.kind === 'radius' && c.curve === next.curve && c.index === next.index,
    );
    const radius = curve.locked
      ? curve.radius
      : dimension?.kind === 'radius'
        ? dimension.value
        : next.value;
    const center = reference.points[curve.center].position;
    if (next.curve === 'arc') {
      const arc = reference.arcs[next.index];
      for (const point of arc.points)
        suggest(
          suggestions,
          point,
          radialPosition(center, reference.points[point].position, radius),
        );
    }
    for (const c of reference.constraints)
      if (
        c.kind === 'pointOnCircle' &&
        c.curve === next.curve &&
        c.index === next.index
      )
        suggest(
          suggestions,
          c.points[0],
          radialPosition(
            center,
            reference.points[c.points[0]].position,
            radius,
          ),
        );
    return {
      problem: seed(
        current,
        suggestions,
        next.curve === 'arc' ? new Map([[next.index, radius]]) : new Map(),
      ),
      objectives: [
        {...next, weight: 1},
        anchor(reference, curve.center),
        ...[...suggestions].map(([point, positions]) => ({
          ...anchor(reference, point),
          position: positions[0],
        })),
      ],
    };
  };
};

const centerRule: SketchDragRule = context => {
  if (context.target.kind !== 'point') return;
  const scope = connected(neighbors(context.reference), context.target.point);
  const policy = translationPolicy(
    context.reference,
    context.target.point,
    scope,
  );
  if (policy) return pointSession(context, [policy]);
  return;
};

const junctionRule: SketchDragRule = context => {
  const {reference, target} = context;
  if (
    target.kind !== 'point' ||
    reference.points[target.point].locked.some(Boolean)
  )
    return;
  // This rule, not the dispatcher, defines an unconstrained articulation point.
  if (
    reference.constraints.some(
      c =>
        !(c.kind === 'pointOnCircle' && c.points[1] === target.point) &&
        constraintPoints(reference, c).includes(target.point),
    )
  )
    return;
  const scope = connected(neighbors(reference), target.point);
  const remaining = new Set([...scope].filter(p => p !== target.point));
  const graph = neighbors(reference, target.point);
  const parts: Set<number>[] = [];
  for (const point of remaining) {
    const part = connected(graph, point);
    for (const member of part) remaining.delete(member);
    part.add(target.point);
    parts.push(part);
  }
  if (parts.length < 2) return;
  return pointSession(
    context,
    parts.map(
      part =>
        translationPolicy(reference, target.point, part) ??
        endpointPolicy(reference, target.point, part),
    ),
  );
};

const endpointRule: SketchDragRule = context => {
  if (context.target.kind !== 'point') return;
  const scope = connected(neighbors(context.reference), context.target.point);
  return pointSession(context, [
    endpointPolicy(context.reference, context.target.point, scope),
  ]);
};

const motionRules: readonly SketchDragRule[] = [
  radiusRule,
  centerRule,
  junctionRule,
  endpointRule,
];

/** This rule supplies geometric connections; the dispatcher still knows no roles. */
const incidenceRule: SketchDragRule = ({reference, target, geometry}) => {
  const original = geometry ?? sketchIncidenceGeometry(reference);
  const contacts = sketchIncidences(original);
  if (!contacts.length) return;
  const constraints = contacts.map((contact): SketchSolveConstraint =>
    contact.kind === 'line'
      ? {
          kind: 'pointOnLine',
          points: [contact.point, ...original.lines[contact.index]],
        }
      : {
          kind: 'pointOnCircle',
          points: [
            contact.point,
            (contact.kind === 'circle' ? original.circles : original.arcs)[
              contact.index
            ].center,
          ],
          curve: contact.kind,
          index: contact.index,
        },
  );
  const session = createSketchDragSession(
    {
      reference: {
        ...reference,
        constraints: [...reference.constraints, ...constraints],
      },
      target,
    },
    motionRules,
  );
  return (current, updated) => {
    // A polar seed follows the requested angle, including an exact half-turn,
    // where a distance equation's local derivative alone cannot pick a branch.
    const suggestions = new Map<number, SketchPosition[]>();
    const currentGeometry = sketchIncidenceGeometry(current);
    for (const contact of contacts) {
      if (
        contact.kind === 'line' ||
        updated.kind !== 'point' ||
        contact.point !== updated.point
      )
        continue;
      const curve = sketchIncidenceCurve(currentGeometry, contact);
      if (
        curve.kind !== 'line' &&
        updated.position.every((v, i) => v === curve.center[i])
      )
        continue;
      const t = sketchCurveClosestParameter(curve, updated.position);
      // Finite endpoints already have authoritative coordinates. Re-evaluating
      // sin/cos would introduce a new seed such as cos(pi/2) instead of exact 0.
      const position =
        contact.kind === 'arc' && (t === 0 || t === 1)
          ? currentGeometry.points[
              currentGeometry.arcs[contact.index].points[t]
            ]
          : sketchCurvePosition(curve, t);
      suggest(suggestions, contact.point, position);
    }
    const plan = session(
      {
        ...seed(current, suggestions, new Map()),
        constraints: [...current.constraints, ...constraints],
      },
      updated,
    );
    // An interior point can slide without moving either end. Both endpoints
    // are soft references, so they can yield when the point moves off the line.
    const preferences =
      updated.kind === 'point'
        ? new Set(
            contacts
              .filter(c => c.point === updated.point)
              .flatMap(c => sketchIncidencePoints(original, c).slice(1)),
          )
        : new Set<number>();
    // Incidence leaves a tangential freedom. Keep followers near their
    // gesture-start positions instead of accepting an arbitrary slide.
    for (const {point} of contacts) preferences.add(point);
    const present = new Set(
      plan.objectives.filter(o => o.kind === 'point').map(o => o.point),
    );
    return {
      ...plan,
      incidences: contacts,
      objectives: [
        ...plan.objectives,
        ...[...preferences]
          .filter(p => !present.has(p))
          .map(p => anchor(reference, p)),
      ],
    };
  };
};

const dragRules: readonly SketchDragRule[] = [incidenceRule, ...motionRules];

function pointSession(
  context: SketchDragContext,
  policies: readonly PointPolicy[],
): SketchDragSession {
  const {reference} = context;
  const anchors = [...new Set(policies.flatMap(p => p.anchors))];
  return (current, updated) => {
    const target = updated as Extract<SketchSolveTarget, {kind: 'point'}>;
    const suggestions = new Map<number, SketchPosition[]>();
    const radii = new Map<number, number>();
    const from = reference.points[target.point].position;
    for (const policy of policies) {
      for (const point of policy.translate)
        suggest(
          suggestions,
          point,
          reference.points[point].position.map(
            (v, axis) => v + target.position[axis] - from[axis],
          ) as [number, number],
        );
      for (const index of policy.arcs) {
        const arc = reference.arcs[index];
        const center = reference.points[arc.center].position;
        const dimension = reference.constraints.find(
          c => c.kind === 'radius' && c.curve === 'arc' && c.index === index,
        );
        const radius = arc.locked
          ? arc.radius
          : dimension?.kind === 'radius'
            ? dimension.value
            : Math.hypot(
                target.position[0] - center[0],
                target.position[1] - center[1],
              );
        if (radius === 0) continue;
        radii.set(index, radius);
        const sweep = reference.constraints.some(
          c => c.kind === 'sweep' && c.index === index,
        );
        const turn =
          Math.atan2(
            target.position[1] - center[1],
            target.position[0] - center[0],
          ) - Math.atan2(from[1] - center[1], from[0] - center[0]);
        for (const point of arc.points) {
          let position =
            point === target.point
              ? target.position
              : reference.points[point].position;
          if (sweep && point !== target.point) {
            const [x, y] = [position[0] - center[0], position[1] - center[1]];
            position = [
              center[0] + x * Math.cos(turn) - y * Math.sin(turn),
              center[1] + x * Math.sin(turn) + y * Math.cos(turn),
            ];
          }
          suggest(suggestions, point, radialPosition(center, position, radius));
        }
      }
    }
    return {
      problem: seed(current, suggestions, radii),
      objectives: [
        {...target, weight: 1},
        ...anchors.map(point => anchor(reference, point)),
        ...[...new Set(policies.flatMap(p => p.translate))]
          .filter(p => p !== target.point)
          .map(p => ({
            ...anchor(reference, p),
            position: suggestions.get(p)![0],
          })),
      ],
    };
  };
}

function translationPolicy(
  problem: SketchSolveProblem,
  point: number,
  scope: ReadonlySet<number>,
): PointPolicy | undefined {
  if ([...scope].some(i => problem.points[i].locked.some(Boolean))) return;
  const curves = problem.arcs.filter(
    a => a.center === point && a.points.every(p => scope.has(p)),
  );
  const owned = new Set([point, ...curves.flatMap(a => [...a.points])]);
  for (const c of problem.constraints)
    if (c.kind === 'pointOnCircle' && c.points[1] === point)
      owned.add(c.points[0]);
  const rectangle = rectanglePoints(problem, point, scope);
  const isCenter =
    curves.length > 0 ||
    problem.circles.some(c => c.center === point) ||
    !!rectangle;
  if (!isCenter) return;
  if (rectangle) for (const p of rectangle) owned.add(p);
  if ([...scope].some(p => !owned.has(p))) return;
  const relevant = problem.constraints.filter(
    c =>
      !(c.kind === 'pointOnCircle' && c.points[1] === point) &&
      constraintPoints(problem, c).some(p => scope.has(p)),
  );
  if (rectangle) {
    if (
      relevant.some(
        c =>
          c.kind !== 'horizontal' &&
          c.kind !== 'vertical' &&
          !(c.kind === 'midpoint' && c.points[0] === point),
      )
    )
      return;
  } else if (relevant.length) return;
  return {anchors: [], translate: [...owned], arcs: []};
}

function endpointPolicy(
  problem: SketchSolveProblem,
  point: number,
  scope: ReadonlySet<number>,
): PointPolicy {
  const arcs = problem.arcs.flatMap((a, index) =>
    a.points.includes(point) &&
    scope.has(a.center) &&
    a.points.every(p => scope.has(p))
      ? [index]
      : [],
  );
  const controls = new Set(arcs.map(i => problem.arcs[i].center));
  for (const c of problem.constraints)
    if (c.kind === 'pointOnCircle' && c.points[0] === point)
      controls.add(c.points[1]);
  for (const c of problem.constraints)
    if (
      c.kind === 'midpoint' &&
      c.points[0] !== point &&
      rectanglePoints(problem, c.points[0], scope)
    )
      controls.add(c.points[0]);
  controls.delete(point);
  if (controls.size) return {anchors: [...controls], translate: [], arcs};
  const graph = neighbors(problem);
  const distance = new Map([[point, 0]]);
  for (const [p, d] of distance)
    for (const next of graph[p])
      if (scope.has(next) && !distance.has(next)) distance.set(next, d + 1);
  let farthest = -1,
    max = 0;
  for (const p of scope)
    if ((distance.get(p) ?? 0) > max) {
      farthest = p;
      max = distance.get(p)!;
    }
  return {anchors: farthest < 0 ? [] : [farthest], translate: [], arcs};
}

/** Recognize the actual four-edge/midpoint structure, not tool creation history. */
function rectanglePoints(
  problem: SketchSolveProblem,
  center: number,
  scope: ReadonlySet<number>,
): readonly number[] | undefined {
  const midpoint = problem.constraints.find(
    c => c.kind === 'midpoint' && c.points[0] === center,
  );
  if (midpoint?.kind !== 'midpoint') return;
  const lines = problem.lines.filter(
    line => line.every(p => scope.has(p)) && !line.includes(center),
  );
  const corners = new Set(lines.flatMap(line => [...line]));
  if (
    lines.length !== 4 ||
    corners.size !== 4 ||
    !midpoint.points.slice(1).every(p => corners.has(p))
  )
    return;
  if (
    [...corners].some(p => lines.filter(line => line.includes(p)).length !== 2)
  )
    return;
  if (
    !lines.every(line =>
      problem.constraints.some(
        c =>
          (c.kind === 'horizontal' || c.kind === 'vertical') &&
          c.points.every(p => line.includes(p)),
      ),
    )
  )
    return;
  return [...corners];
}

function constraintPoints(
  problem: SketchSolveProblem,
  c: SketchSolveProblem['constraints'][number],
): readonly number[] {
  if ('points' in c) return c.points;
  if ('point' in c) return [c.point];
  if (c.kind === 'sweep' || c.curve === 'arc') {
    const arc = problem.arcs[c.index];
    return [arc.center, ...arc.points];
  }
  return [problem.circles[c.index].center];
}

function neighbors(problem: SketchSolveProblem, excluded = -1): Set<number>[] {
  const graph = problem.points.map(() => new Set<number>());
  const connect = (vertices: readonly number[]) => {
    const included = vertices.filter(p => p !== excluded);
    for (const a of included)
      for (const b of included) if (a !== b) graph[a].add(b);
  };
  problem.lines.forEach(connect);
  problem.arcs.forEach(a => connect([a.center, ...a.points]));
  problem.constraints.forEach(c => connect(constraintPoints(problem, c)));
  return graph;
}

function connected(
  graph: readonly ReadonlySet<number>[],
  start: number,
): Set<number> {
  const result = new Set([start]);
  for (const point of result) for (const next of graph[point]) result.add(next);
  return result;
}

function anchor(
  problem: SketchSolveProblem,
  point: number,
): SketchSolveObjective {
  return {
    kind: 'point',
    point,
    position: problem.points[point].position,
    weight: 1,
  };
}

function suggest(
  suggestions: Map<number, SketchPosition[]>,
  point: number,
  position: SketchPosition,
): void {
  const values = suggestions.get(point) ?? [];
  values.push(position);
  suggestions.set(point, values);
}

function radialPosition(
  center: SketchPosition,
  position: SketchPosition,
  radius: number,
): SketchPosition {
  const angle = Math.atan2(position[1] - center[1], position[0] - center[0]);
  return [
    center[0] + radius * Math.cos(angle),
    center[1] + radius * Math.sin(angle),
  ];
}

function seed(
  problem: SketchSolveProblem,
  suggestions: ReadonlyMap<number, readonly SketchPosition[]>,
  radii: ReadonlyMap<number, number>,
): SketchSolveProblem {
  return {
    ...problem,
    points: problem.points.map((p, index) => {
      const values = suggestions.get(index);
      if (!values) return p;
      return {
        ...p,
        position: p.position.map((v, axis) =>
          p.locked[axis] ||
          problem.constraints.some(
            c =>
              'point' in c &&
              c.point === index &&
              (c.kind === 'fixed' || c.kind === (axis === 0 ? 'x' : 'y')),
          )
            ? v
            : values.reduce((sum, value) => sum + value[axis], 0) /
              values.length,
        ) as [number, number],
      };
    }),
    arcs: problem.arcs.map((arc, index) =>
      arc.locked || !radii.has(index)
        ? arc
        : {...arc, radius: radii.get(index)!},
    ),
  };
}
