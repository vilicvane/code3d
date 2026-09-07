import {
  solveSketchProblem,
  type SketchSolveObjective,
  type SketchSolveProblem,
  type SketchSolveTarget,
} from './sketch-solver.js';
import type {SketchPosition} from './sketch.js';

export type SketchDragContext = Readonly<{
  reference: SketchSolveProblem;
  target: SketchSolveTarget;
}>;
export type SketchDragPlan = Readonly<{
  problem: SketchSolveProblem;
  objectives: readonly [SketchSolveObjective, ...SketchSolveObjective[]];
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
) {
  const plan = createSketchDragSession({reference, target})(current, target);
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
    if (next.curve === 'arc') {
      const arc = reference.arcs[next.index];
      const center = reference.points[arc.center].position;
      for (const point of arc.points)
        suggest(
          suggestions,
          point,
          radialPosition(center, reference.points[point].position, next.value),
        );
    }
    return {
      problem: seed(
        current,
        suggestions,
        next.curve === 'arc' ? new Map([[next.index, next.value]]) : new Map(),
      ),
      objectives: [{...next, weight: 1}, anchor(reference, curve.center)],
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
    reference.constraints.some(c =>
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

const dragRules: readonly SketchDragRule[] = [
  radiusRule,
  centerRule,
  junctionRule,
  endpointRule,
];

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
  const rectangle = rectanglePoints(problem, point, scope);
  const isCenter =
    curves.length > 0 ||
    problem.circles.some(c => c.center === point) ||
    !!rectangle;
  if (!isCenter) return;
  if (rectangle) for (const p of rectangle) owned.add(p);
  if ([...scope].some(p => !owned.has(p))) return;
  const relevant = problem.constraints.filter(c =>
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
