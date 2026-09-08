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

/** Evaluation-local boundaries. Neither array order nor a kernel wire is an author ID. */
export type SketchRegion = Readonly<{
  outer: readonly SketchCurve[];
  holes: readonly (readonly SketchCurve[])[];
}>;

type Boundary = {
  curve: SketchCurve;
  label: string;
  ends?: readonly [number, number];
};
const tau = 2 * Math.PI;
const distance = (a: SketchPosition, b: SketchPosition) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Closed, non-intersecting contours; nested contours alternate material and holes. */
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
      const curve = sketchCurveGeometry(entity, ref => {
        const point = resolve(ref);
        return points.get(JSON.stringify([point.layer, point.id]))!;
      });
      return curve ? [{curve, label: `${layer.id}:${entity.id}`}] : [];
    }),
  );
  const vertices: {
    position: SketchPosition;
    tolerance: number;
    edges: number[];
  }[] = [];
  const vertex = (position: SketchPosition, tolerance: number) => {
    const index = vertices.findIndex(
      v => distance(v.position, position) <= Math.min(v.tolerance, tolerance),
    );
    if (index >= 0) return index;
    vertices.push({position, tolerance, edges: []});
    return vertices.length - 1;
  };
  for (const [i, boundary] of boundaries.entries()) {
    const {curve} = boundary;
    if (curve.kind === 'circle') continue;
    const tolerance = sketchCurveTolerance(curve);
    const ends = [
      vertex(sketchCurvePosition(curve, 0), tolerance),
      vertex(sketchCurvePosition(curve, 1), tolerance),
    ] as const;
    if (ends[0] === ends[1])
      throw new Error(`Sketch boundary ${boundary.label} is degenerate.`);
    boundary.ends = ends;
    ends.forEach(v => vertices[v].edges.push(i));
  }
  for (let i = 0; i < boundaries.length; i++) {
    const a = boundaries[i];
    for (const b of boundaries.slice(i + 1)) {
      const contacts = sketchCurveIntersections(a.curve, b.curve);
      if (
        overlap(
          a.curve,
          b.curve,
          contacts.map(c => c.parameters[0]),
        ) ||
        contacts.some(c =>
          c.parameters.some((_, j) => {
            const curve = j === 0 ? a.curve : b.curve;
            return (
              curve.kind === 'circle' ||
              (distance(c.position, sketchCurvePosition(curve, 0)) >
                sketchCurveTolerance(curve) &&
                distance(c.position, sketchCurvePosition(curve, 1)) >
                  sketchCurveTolerance(curve))
            );
          }),
        )
      )
        throw new Error(
          `Sketch boundaries ${a.label} and ${b.label} intersect or overlap. Trim them into separate closed contours before creating faces.`,
        );
    }
  }
  for (const v of vertices) {
    if (v.edges.length !== 2)
      throw new Error(
        `Sketch has an ${v.edges.length === 1 ? 'open' : 'ambiguous branching'} contour at [${v.position.join(', ')}]. Faces require closed, non-branching boundaries.`,
      );
  }
  const visited = new Set<number>();
  const loops: SketchCurve[][] = [];
  for (const [start, boundary] of boundaries.entries()) {
    if (visited.has(start)) continue;
    if (!boundary.ends) {
      visited.add(start);
      loops.push([boundary.curve]);
      continue;
    }
    const curves: SketchCurve[] = [];
    let edge = start,
      from = boundary.ends[0];
    do {
      const current = boundaries[edge];
      const forward = current.ends![0] === from;
      curves.push(forward ? current.curve : reverseCurve(current.curve));
      visited.add(edge);
      from = current.ends![forward ? 1 : 0];
      edge = vertices[from].edges.find(e => e !== edge)!;
    } while (edge !== start);
    const area = contourArea(curves);
    if (Math.abs(area) <= Math.max(...curves.map(sketchCurveTolerance)) ** 2)
      throw new Error('Sketch contour has no finite area.');
    loops.push(area < 0 ? curves.reverse().map(reverseCurve) : curves);
  }
  const areas = loops.map(loop => Math.abs(contourArea(loop)));
  const parents = loops.map((loop, i) => {
    const p = sketchCurvePosition(loop[0], 0);
    const enclosing = loops.flatMap((other, j) =>
      j !== i && areas[j] > areas[i] && contourContains(other, p) ? [j] : [],
    );
    return enclosing.sort((a, b) => areas[a] - areas[b])[0];
  });
  const depth = (i: number): number =>
    parents[i] === undefined ? 0 : 1 + depth(parents[i]);
  return loops.flatMap((outer, i) =>
    depth(i) % 2
      ? []
      : [
          {
            outer,
            holes: loops
              .filter((_, j) => parents[j] === i)
              .map(loop => [...loop].reverse().map(reverseCurve)),
          },
        ],
  );
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
