import {
  solveSketchProblem,
  type SketchSolveObjective,
  type SketchSolveProblem,
  type SketchSolveTarget,
  type SketchSolveConstraint,
  type SketchSolveResult,
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
  stages: readonly [SketchDragStage, ...SketchDragStage[]];
  incidences?: readonly SketchIncidence[];
}>;
/** Targets may depend on the feasible geometry reached by earlier stages. */
export type SketchDragStage = (
  current: SketchSolveProblem,
) => readonly SketchSolveObjective[];
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
    const result = solveSketchDragPlan({...plan, problem});
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

/** Each stage keeps the preceding stage's chosen parameter values, not all
 * equivalent optima. These locks belong to this solve, never the next frame. */
export function solveSketchDragPlan(plan: SketchDragPlan): SketchSolveResult {
  let problem = plan.problem;
  let result: SketchSolveResult | undefined;
  for (const stage of plan.stages) {
    const objectives = stage(problem);
    if (result && !objectives.length) continue;
    // Stage output is an iterative seed, not a new authored exact value.
    // Otherwise cleanup can undo a later hard solve to restore an earlier tail.
    const solved = solveSketchProblem(problem, objectives, plan.problem);
    result = solved;
    const points = new Set(
      objectives.filter(o => o.kind === 'point').map(o => o.point),
    );
    const radii = objectives.filter(o => o.kind === 'radius');
    problem = {
      ...problem,
      points: problem.points.map((point, index) => ({
        position: solved.positions[index],
        locked: points.has(index) ? [true, true] : point.locked,
      })),
      circles: problem.circles.map((circle, index) => ({
        ...circle,
        radius: solved.radii[index],
        locked:
          circle.locked ||
          radii.some(o => o.curve === 'circle' && o.index === index),
      })),
      arcs: problem.arcs.map((arc, index) => ({
        ...arc,
        radius: solved.arcRadii[index],
        locked:
          arc.locked || radii.some(o => o.curve === 'arc' && o.index === index),
      })),
    };
  }
  return result!;
}

type PointPolicy = Readonly<
  | {
      kind: 'translation';
      points: readonly number[];
      radii: readonly SketchSolveObjective[];
      exterior: readonly SketchSolveObjective[];
    }
  | {
      kind: 'endpoint';
      anchors: readonly number[];
    }
>;

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
      stages: [
        () => [{...next, weight: 1}],
        () => [
          anchor(reference, curve.center),
          ...[...suggestions].map(([point, positions]) => ({
            ...anchor(reference, point),
            position: positions[0],
          })),
        ],
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
    const stages: [SketchDragStage, ...SketchDragStage[]] = [...plan.stages];
    const last = stages.at(-1)!;
    stages[stages.length - 1] = current => {
      const objectives = last(current);
      const present = new Set(
        objectives.filter(o => o.kind === 'point').map(o => o.point),
      );
      if (updated.kind === 'point') present.add(updated.point);
      return [
        ...objectives,
        ...[...preferences]
          .filter(
            p => !present.has(p) && !current.points[p].locked.every(Boolean),
          )
          .map(p => anchor(reference, p)),
      ];
    };
    return {
      ...plan,
      incidences: contacts,
      stages,
    };
  };
};

const dragRules: readonly SketchDragRule[] = [incidenceRule, ...motionRules];

function pointSession(
  context: SketchDragContext,
  policies: readonly PointPolicy[],
): SketchDragSession {
  const {reference} = context;
  const translations = policies.filter(p => p.kind === 'translation');
  const endpoints = policies.filter(p => p.kind === 'endpoint');
  // An endpoint can also be another curve's center. Its incident arcs retain
  // their center preference regardless of the point's other motion roles.
  const arcs = reference.arcs.flatMap((arc, index) =>
    context.target.kind === 'point' && arc.points.includes(context.target.point)
      ? [index]
      : [],
  );
  const centers = new Set(arcs.map(index => reference.arcs[index].center));
  const anchors = [...new Set(endpoints.flatMap(p => p.anchors))].filter(
    point => !centers.has(point),
  );
  const translated = [...new Set(translations.flatMap(p => p.points))];
  const preservedRadii = translations.flatMap(p => p.radii);
  return (current, updated) => {
    const target = updated as Extract<SketchSolveTarget, {kind: 'point'}>;
    const suggestions = new Map<number, SketchPosition[]>();
    const radii = new Map<number, number>();
    const from = reference.points[target.point].position;
    for (const index of arcs) {
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
      // A mouse target at the center has no radial direction. For a fixed
      // radius keep the current endpoint direction as the seed; the mouse
      // objective still participates in the constrained solve.
      const direction = target.position.every((v, axis) => v === center[axis])
        ? current.points[target.point].position
        : target.position;
      const turn =
        Math.atan2(direction[1] - center[1], direction[0] - center[0]) -
        Math.atan2(from[1] - center[1], from[0] - center[0]);
      for (const point of arc.points) {
        let position =
          point === target.point ? direction : reference.points[point].position;
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
    // Seed a center's followers from the same proposed position as the center.
    // Mixing a projected arc endpoint with a raw mouse translation distorts
    // the attached arc before its translation stage can preserve its shape.
    const endpoint = suggestions.get(target.point);
    const destination = endpoint ? averagePosition(endpoint) : target.position;
    for (const point of translated) {
      if (point === target.point && endpoint) continue;
      suggest(
        suggestions,
        point,
        reference.points[point].position.map(
          (v, axis) => v + destination[axis] - from[axis],
        ) as [number, number],
      );
    }
    const stages: [SketchDragStage, ...SketchDragStage[]] = [
      () => [{...target, weight: 1}],
      reached => [
        ...anchors.map(point => anchor(reference, point)),
        ...translated
          .filter(p => p !== target.point)
          .map(p => ({
            ...anchor(reference, p),
            position: reference.points[p].position.map(
              (v, axis) =>
                v - from[axis] + reached.points[target.point].position[axis],
            ) as [number, number],
          })),
      ],
      ...(translations.length
        ? [() => translations.flatMap(p => p.exterior)]
        : []),
    ];
    // A center's radii take precedence over following the mouse. A shared
    // endpoint still retains its incident centers before these radius goals.
    if (preservedRadii.length) stages.unshift(() => preservedRadii);
    if (centers.size)
      stages.unshift(() => [...centers].map(point => anchor(reference, point)));
    return {problem: seed(current, suggestions, radii), stages};
  };
}

function translationPolicy(
  problem: SketchSolveProblem,
  point: number,
  scope: ReadonlySet<number>,
): PointPolicy | undefined {
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
  const radii = (['circle', 'arc'] as const).flatMap(curve =>
    (curve === 'circle' ? problem.circles : problem.arcs).flatMap((c, index) =>
      scope.has(c.center)
        ? [{kind: 'radius' as const, curve, index, value: c.radius, weight: 1}]
        : [],
    ),
  );
  const ownRadius = (o: Extract<SketchSolveObjective, {kind: 'radius'}>) =>
    (o.curve === 'circle' ? problem.circles : problem.arcs)[o.index].center ===
    point;
  return {
    kind: 'translation',
    points: [...owned],
    radii: radii.filter(ownRadius),
    exterior: [
      ...[...scope].filter(p => !owned.has(p)).map(p => anchor(problem, p)),
      ...radii.filter(o => !ownRadius(o)),
    ],
  };
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
  if (controls.size) return {kind: 'endpoint', anchors: [...controls]};
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
  return {kind: 'endpoint', anchors: farthest < 0 ? [] : [farthest]};
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
  // Rescale the actual direction: atan2 -> sin/cos would turn an exact
  // horizontal/vertical coordinate into a tail that is then kept as a seed.
  const dx = position[0] - center[0],
    dy = position[1] - center[1];
  const length = Math.hypot(dx, dy);
  return [
    center[0] + (dx / length) * radius,
    center[1] + (dy / length) * radius,
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
      const position = averagePosition(values);
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
            : position[axis],
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

function averagePosition(values: readonly SketchPosition[]): SketchPosition {
  return [0, 1].map(
    axis => values.reduce((sum, value) => sum + value[axis], 0) / values.length,
  ) as [number, number];
}
