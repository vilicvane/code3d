import {
  sketchPointResolver,
  type SketchSnapshot,
  type SketchPosition,
} from './sketch.js';
import {
  sketchCurveGeometry,
  sketchCurvePosition,
  sketchCurveTolerance,
  sketchPositiveAngle,
  type SketchCurve,
} from './sketch-curves.js';
import {sketchCurveIntersections} from './sketch-curve-intersections.js';
import {isPointOnSketchCurve} from './sketch-incidence.js';
import {sketchRelativePrecision} from './sketch-precision.js';

/** Evaluation-local boundaries. Neither array order nor a kernel wire is an author ID. */
export type SketchRegion = Readonly<{
  outer: readonly SketchCurve[];
  holes: readonly (readonly SketchCurve[])[];
}>;

type Boundary = {
  curve: SketchCurve;
  label: string;
  cuts: number[];
};
const tau = 2 * Math.PI;
const distance = (a: SketchPosition, b: SketchPosition) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Bounded cells of analytic curves; nested contours alternate material and holes. */
export function sketchRegions(
  layers: readonly SketchSnapshot[],
): readonly SketchRegion[] {
  const resolve = sketchPointResolver(layers);
  const points = new Map(
    layers.flatMap(layer =>
      layer.entities.flatMap(e =>
        e.kind === 'point'
          ? [[JSON.stringify([layer.id, e.id]), e.position] as const]
          : [],
      ),
    ),
  );
  const boundaries: Boundary[] = layers.flatMap(layer =>
    layer.entities.flatMap(entity => {
      if (entity.kind !== 'point' && entity.construction) return [];
      const curve = sketchCurveGeometry(entity, ref => {
        const point = resolve(ref);
        return points.get(JSON.stringify([point.layer, point.id]))!;
      });
      return curve
        ? [{curve, label: `${layer.id}:${entity.id}`, cuts: [0, 1]}]
        : [];
    }),
  );
  for (const [i, a] of boundaries.entries()) {
    for (const b of boundaries.slice(i + 1)) {
      const contacts = sketchCurveIntersections(a.curve, b.curve);
      if (
        overlap(
          a.curve,
          b.curve,
          contacts.map(c => c.parameters[0]),
        )
      )
        throw new Error(
          `Sketch boundaries ${a.label} and ${b.label} overlap. Trim duplicate boundaries before creating faces.`,
        );
      for (const {parameters} of contacts) {
        a.cuts.push(parameters[0]);
        b.cuts.push(parameters[1]);
      }
    }
  }
  const vertices: {
    position: SketchPosition;
    tolerance: number;
    outgoing: number[];
  }[] = [];
  const vertex = (position: SketchPosition, tolerance: number) => {
    const index = vertices.findIndex(
      v => distance(v.position, position) <= Math.min(v.tolerance, tolerance),
    );
    if (index >= 0) return index;
    vertices.push({position, tolerance, outgoing: []});
    return vertices.length - 1;
  };
  const edges: {curve: SketchCurve; from: number; to: number}[] = [];
  for (const {curve, cuts} of boundaries) {
    const tolerance = sketchCurveTolerance(curve);
    const length =
      curve.kind === 'line'
        ? distance(...curve.points)
        : curve.radius *
          (curve.kind === 'circle' ? tau : Math.abs(curve.sweep));
    const parameters = cuts
      .sort((a, b) => a - b)
      .filter(
        (t, i, sorted) => i === 0 || (t - sorted[i - 1]) * length > tolerance,
      );
    for (let i = 1; i < parameters.length; i++) {
      const start = parameters[i - 1],
        end = parameters[i];
      const part: SketchCurve =
        curve.kind === 'line'
          ? {
              kind: 'line',
              points: [
                sketchCurvePosition(curve, start),
                sketchCurvePosition(curve, end),
              ],
            }
          : curve.kind === 'circle' && parameters.length === 2
            ? curve
            : {
                kind: 'arc',
                center: curve.center,
                radius: curve.radius,
                start:
                  (curve.kind === 'circle' ? 0 : curve.start) +
                  start * (curve.kind === 'circle' ? tau : curve.sweep),
                sweep:
                  (end - start) * (curve.kind === 'circle' ? tau : curve.sweep),
              };
      const from = vertex(sketchCurvePosition(part, 0), tolerance);
      const to = vertex(sketchCurvePosition(part, 1), tolerance);
      const edge = edges.length;
      edges.push(
        {curve: part, from, to},
        {curve: reverseCurve(part), from: to, to: from},
      );
      vertices[from].outgoing.push(edge);
      vertices[to].outgoing.push(edge + 1);
    }
  }
  // Tangent order selects the face on the left of each directed edge. Signed
  // curvature disambiguates curves that leave a vertex in the same direction.
  const directions = edges.map(({curve}) => {
    const angle =
      curve.kind === 'line'
        ? Math.atan2(
            curve.points[1][1] - curve.points[0][1],
            curve.points[1][0] - curve.points[0][0],
          )
        : (curve.kind === 'circle' ? 0 : curve.start) +
          (Math.sign(curve.kind === 'circle' ? 1 : curve.sweep) * Math.PI) / 2;
    const normalized = sketchPositiveAngle(angle);
    return {
      angle:
        Math.min(normalized, tau - normalized) < sketchRelativePrecision
          ? 0
          : normalized,
      curvature:
        curve.kind === 'line'
          ? 0
          : Math.sign(curve.kind === 'circle' ? 1 : curve.sweep) / curve.radius,
    };
  });
  for (const {outgoing} of vertices)
    outgoing.sort((a, b) =>
      Math.abs(directions[a].angle - directions[b].angle) >
      sketchRelativePrecision
        ? directions[a].angle - directions[b].angle
        : directions[a].curvature - directions[b].curvature,
    );
  const curvesOf = (cycle: readonly number[]) => cycle.map(e => edges[e].curve);
  const cycles = (selected: ReadonlySet<number>) => {
    const next = new Map(
      [...selected].map(i => {
        const outgoing = vertices[edges[i].to].outgoing;
        let at = outgoing.indexOf(i ^ 1);
        do {
          at = (at + outgoing.length - 1) % outgoing.length;
        } while (!selected.has(outgoing[at]));
        return [i, outgoing[at]];
      }),
    );
    const visited = new Set<number>();
    const result: number[][] = [];
    for (const start of selected) {
      if (visited.has(start)) continue;
      // Split walks at repeated vertices: bridges and dangling tails traverse
      // both directions and enclose no area; touching loops remain separate.
      const path: number[] = [];
      const at = new Map<number, number>();
      let edge = start;
      do {
        at.set(edges[edge].from, path.length);
        path.push(edge);
        visited.add(edge);
        const repeat = at.get(edges[edge].to);
        if (repeat !== undefined) {
          const cycle = path.splice(repeat);
          const curves = curvesOf(cycle);
          if (
            contourArea(curves) >
            Math.max(...curves.map(sketchCurveTolerance)) ** 2
          )
            result.push(cycle);
          for (const e of cycle) at.delete(edges[e].from);
        }
        edge = next.get(edge)!;
      } while (edge !== start);
    }
    return result;
  };
  const contours = cycles(new Set(edges.keys()));
  const loops = contours.map(curvesOf);
  const areas = loops.map(loop => Math.abs(contourArea(loop)));
  const parents = loops.map((loop, i) => {
    const enclosing = loops.flatMap((other, j) =>
      j !== i && areas[j] > areas[i] && containsLoop(other, loop) ? [j] : [],
    );
    return enclosing.sort((a, b) => areas[a] - areas[b])[0];
  });
  const depth = (i: number): number =>
    parents[i] === undefined ? 0 : 1 + depth(parents[i]);
  return loops.flatMap((outer, i) => {
    if (depth(i) % 2) return [];
    const inner = new Set(
      contours.flatMap((cycle, j) => (parents[j] === i ? cycle : [])),
    );
    // Adjacent cells inside a hole share an internal edge. Cancel it before
    // making kernel wires, so the hole has one boundary rather than touching wires.
    const boundary = new Set([...inner].filter(e => !inner.has(e ^ 1)));
    return [
      {
        outer,
        holes: cycles(boundary).map(cycle =>
          curvesOf(cycle).reverse().map(reverseCurve),
        ),
      },
    ];
  });
}

/** Adjacent cells share vertices/edges; test a boundary point off that contact. */
function containsLoop(
  outer: readonly SketchCurve[],
  inner: readonly SketchCurve[],
): boolean {
  for (const curve of inner) {
    const p = sketchCurvePosition(curve, 0.5);
    if (!outer.some(edge => isPointOnSketchCurve(p, edge)))
      return contourContains(outer, p);
  }
  return false;
}

function reverseCurve(curve: SketchCurve): SketchCurve {
  if (curve.kind === 'line')
    return {...curve, points: [curve.points[1], curve.points[0]]};
  if (curve.kind === 'arc')
    return {...curve, start: curve.start + curve.sweep, sweep: -curve.sweep};
  // A full circular hole needs an explicit clockwise traversal too.
  return {
    kind: 'arc',
    center: curve.center,
    radius: curve.radius,
    start: 0,
    sweep: -tau,
  };
}

function overlap(
  a: SketchCurve,
  b: SketchCurve,
  intersections: readonly number[],
): boolean {
  if (a.kind === 'line' || b.kind === 'line') {
    if (a.kind !== 'line' || b.kind !== 'line' || intersections.length < 2)
      return false;
  } else if (
    distance(a.center, b.center) >
      Math.min(sketchCurveTolerance(a), sketchCurveTolerance(b)) ||
    Math.abs(a.radius - b.radius) >
      Math.min(sketchCurveTolerance(a), sketchCurveTolerance(b))
  )
    return false;
  const cuts = [0, ...intersections, 1].sort((a, b) => a - b);
  return cuts
    .slice(1)
    .some(
      (end, i) =>
        end > cuts[i] &&
        isPointOnSketchCurve(sketchCurvePosition(a, (cuts[i] + end) / 2), b),
    );
}

/** Green's theorem, translated near the contour to avoid large-offset cancellation. */
export function contourArea(curves: readonly SketchCurve[]): number {
  if (!curves.length) return 0;
  const origin = sketchCurvePosition(curves[0], 0);
  return curves.reduce((area, curve) => {
    if (curve.kind === 'line') {
      const [a, b] = curve.points.map(p => [
        p[0] - origin[0],
        p[1] - origin[1],
      ]);
      return area + (a[0] * b[1] - b[0] * a[1]) / 2;
    }
    if (curve.kind === 'circle') return area + Math.PI * curve.radius ** 2;
    const [x, y] = [curve.center[0] - origin[0], curve.center[1] - origin[1]];
    const a = curve.start,
      b = a + curve.sweep,
      r = curve.radius;
    return (
      area +
      (r * (x * (Math.sin(b) - Math.sin(a)) - y * (Math.cos(b) - Math.cos(a))) +
        r * r * curve.sweep) /
        2
    );
  }, 0);
}

/** Analytic horizontal ray crossings, with half-open, Y-monotone curve pieces. */
function contourContains(
  curves: readonly SketchCurve[],
  point: SketchPosition,
): boolean {
  let crossings = 0;
  for (const curve of curves) {
    if (curve.kind === 'line') {
      const [a, b] = curve.points;
      if (
        a[1] > point[1] !== b[1] > point[1] &&
        a[0] + ((point[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]) > point[0]
      )
        crossings++;
      continue;
    }
    const start = curve.kind === 'circle' ? 0 : curve.start;
    const sweep = curve.kind === 'circle' ? tau : curve.sweep;
    const cuts = [
      0,
      1,
      ...[Math.PI / 2, (3 * Math.PI) / 2]
        .map(
          a =>
            sketchPositiveAngle(Math.sign(sweep) * (a - start)) /
            Math.abs(sweep),
        )
        .filter(t => t > 0 && t < 1),
    ].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const a = sketchCurvePosition(curve, cuts[i - 1]),
        b = sketchCurvePosition(curve, cuts[i]);
      if (a[1] > point[1] === b[1] > point[1]) continue;
      const dy = point[1] - curve.center[1];
      const x =
        curve.center[0] +
        Math.sign(Math.cos(start + (sweep * (cuts[i - 1] + cuts[i])) / 2)) *
          Math.sqrt(Math.max(0, (curve.radius - dy) * (curve.radius + dy)));
      if (x > point[0]) crossings++;
    }
  }
  return crossings % 2 === 1;
}
