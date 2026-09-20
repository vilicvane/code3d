import {getOC, type Face} from 'replicad';
import type {Geom_Surface} from 'replicad-opencascadejs';
import {
  cross,
  dot,
  perpendicular,
  reject,
  scale,
  subtract,
  unit,
} from './alignment-geometry.js';
import {withNativeScope} from './kernel-scope.js';
import {
  SurfaceGeometry,
  coordinates as tuple,
  distance,
  solveMetric,
  surfaceKnots,
  surfaceRotation,
  type UV,
  type SurfaceMap,
  type Rectangle,
} from './surface-geometry.js';
import {rotateVector, type Vec3} from './spatial.js';

type State = readonly [number, number, number, number];
const sum = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (v: Vec3) => Math.hypot(...v);

/** Rotate a sphere's chart without changing its geometric locus or target trim. */
function regularSurface(face: Face, anchor: Vec3): Geom_Surface {
  const oc = getOC();
  if (face.geomType !== 'SPHERE') return oc.BRep_Tool.Surface(face.wrapped);
  return withNativeScope(scope => {
    const adaptor = scope.own(new oc.BRepAdaptor_Surface(face.wrapped, false));
    const sphere = scope.own(adaptor.Sphere()),
      center = scope.own(sphere.Location());
    const radial = unit(subtract(anchor, tuple(center)));
    const z = scope.own(
      new oc.gp_Dir(
        ...(Math.abs(radial[2]) < 0.9
          ? unit(reject([0, 0, 1], radial))
          : perpendicular(radial)),
      ),
    );
    const x = scope.own(new oc.gp_Dir(...radial));
    const frame = scope.own(new oc.gp_Ax3(center, z, x));
    return new oc.Geom_SphericalSurface(frame, sphere.Radius());
  });
}

/** A smooth native surface chart; geodesic integration uses its exact derivatives. */
export class SurfaceChart extends SurfaceGeometry {
  constructor(
    readonly face: Face,
    readonly tolerance: number,
    anchor: Vec3,
  ) {
    super(regularSurface(face, anchor));
  }
  mapping(anchor: Vec3): (point: UV) => UV {
    const oc = getOC(),
      point = new oc.gp_Pnt(...anchor);
    let uv: UV;
    try {
      const projector = new oc.GeomAPI_ProjectPointOnSurf(
        point,
        this.surface,
        oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
      );
      try {
        if (!projector.IsDone() || !projector.NbPoints())
          throw new Error('wrap could not parameterize the anchor.');
        const {U, V} = projector.LowerDistanceParameters(0, 0);
        uv = [U, V];
      } finally {
        projector.delete();
      }
    } finally {
      point.delete();
    }
    const d = this.differential(uv);
    const rotation = surfaceRotation([0, 1, 0], unit(cross(d.du, d.dv)));
    const x = rotateVector([1, 0, 0], rotation),
      z = rotateVector([0, 0, 1], rotation);
    const velocity = (v: Vec3): UV =>
      solveMetric(d, dot(v, d.du), dot(v, d.dv));
    const vx = velocity(x),
      vz = velocity(z);
    const cache = new Map<string, UV>();
    return p => {
      const key = `${p[0]},${p[1]}`,
        hit = cache.get(key);
      if (hit) return hit;
      const a = p[0] - anchor[0],
        b = p[1] - anchor[2];
      const result = this.integrate([
        uv[0],
        uv[1],
        vx[0] * a + vz[0] * b,
        vx[1] * a + vz[1] * b,
      ]);
      cache.set(key, result);
      return result;
    };
  }
  private derivative(s: State): State {
    const d = this.differential([s[0], s[1]]);
    const acceleration = sum(
      sum(scale(d.uu, s[2] * s[2]), scale(d.uv, 2 * s[2] * s[3])),
      scale(d.vv, s[3] * s[3]),
    );
    const a = dot(acceleration, d.du),
      b = dot(acceleration, d.dv);
    const [u, v] = solveMetric(d, a, b);
    return [s[2], s[3], -u, -v];
  }
  private step(s: State, h: number): State {
    const advance = (v: State, k: State, f: number) =>
      v.map((n, i) => n + f * k[i]) as unknown as State;
    const a = this.derivative(s),
      b = this.derivative(advance(s, a, h / 2)),
      c = this.derivative(advance(s, b, h / 2)),
      d = this.derivative(advance(s, c, h));
    return s.map(
      (n, i) => n + (h * (a[i] + 2 * b[i] + 2 * c[i] + d[i])) / 6,
    ) as unknown as State;
  }
  private integrate(initial: State): UV {
    let s = initial,
      t = 0,
      h = 0.125;
    for (let attempts = 0; t < 1 && attempts < 4096; attempts++) {
      h = Math.min(h, 1 - t);
      const coarse = this.step(s, h),
        fine = this.step(this.step(s, h / 2), h / 2);
      const d = this.differential([fine[0], fine[1]]);
      const error = Math.max(
        distance(
          this.point([coarse[0], coarse[1]]),
          this.point([fine[0], fine[1]]),
        ),
        norm(
          sum(
            scale(d.du, (coarse[2] - fine[2]) * h),
            scale(d.dv, (coarse[3] - fine[3]) * h),
          ),
        ),
      );
      const allowed = (this.tolerance * h) / 32;
      if (error <= allowed) {
        s = fine;
        t += h;
      }
      h *= Math.max(
        0.2,
        Math.min(2, 0.9 * Math.pow(allowed / Math.max(error, 1e-30), 0.2)),
      );
      if (h < 1e-9) break;
    }
    if (t < 1)
      throw new Error(
        'wrap could not converge to a regular geodesic within the requested tolerance.',
      );
    return [s[0], s[1]];
  }
}

/** Check the entire finite layout, refining each candidate's map in model units. */
export function validatedMapping(
  region: Rectangle,
  candidates: readonly Vec3[],
  chart: SurfaceChart,
): SurfaceMap {
  const maps = candidates.map(p => chart.mapping(p));
  const knots = surfaceKnots(chart.face);
  const evaluated = new Map<string, {uv: UV; uvs: UV[]; points: Vec3[]}>();
  const minimum = [Infinity, Infinity],
    maximum = [-Infinity, -Infinity];
  const periods = [
    chart.surface.IsUPeriodic() ? chart.surface.UPeriod() : Infinity,
    chart.surface.IsVPeriodic() ? chart.surface.VPeriod() : Infinity,
  ];
  const at = (p: UV) => {
    const key = `${p[0]},${p[1]}`;
    const hit = evaluated.get(key);
    if (hit) return hit;
    const uvs = maps.map(map => map(p)),
      points = uvs.map(uv => chart.point(uv));
    if (points.some(point => distance(point, points[0]) > chart.tolerance))
      throw new Error(
        'wrap has multiple distinct results within the profile region. Move or rotate the profiles to select one.',
      );
    for (let axis = 0; axis < 2; axis++) {
      minimum[axis] = Math.min(minimum[axis], uvs[0][axis]);
      maximum[axis] = Math.max(maximum[axis], uvs[0][axis]);
      if (maximum[axis] - minimum[axis] >= periods[axis] - 1e-8)
        throw new Error(
          'wrap overlaps itself around a periodic surface. Reduce the profile region.',
        );
    }
    const sample = {uv: uvs[0], uvs, points};
    evaluated.set(key, sample);
    return sample;
  };
  let cells = 0,
    orientation = 0;
  function visit([[x0, z0], [x1, z1]]: Rectangle, depth: number): void {
    if (++cells > 16384)
      throw new Error(
        'wrap could not resolve the profile region within its validation budget. Reduce the region or relax tolerance.',
      );
    const xm = (x0 + x1) / 2,
      zm = (z0 + z1) / 2;
    const coordinates: readonly UV[] = [
      [x0, z0],
      [xm, z0],
      [x1, z0],
      [x0, zm],
      [xm, zm],
      [x1, zm],
      [x0, z1],
      [xm, z1],
      [x1, z1],
    ];
    const samples = coordinates.map(at);
    let error = 0;
    for (let m = 0; m < maps.length; m++) {
      for (const [mid, a, b] of [
        [1, 0, 2],
        [3, 0, 6],
        [5, 2, 8],
        [7, 6, 8],
        [4, 0, 8],
        [4, 2, 6],
      ]) {
        const u = samples[a].uvs[m],
          v = samples[b].uvs[m];
        const interpolated = chart.point([
          (u[0] + v[0]) / 2,
          (u[1] + v[1]) / 2,
        ]);
        error = Math.max(error, distance(samples[mid].points[m], interpolated));
      }
    }
    // UV triangle area times the native metric estimates the local Jacobian.
    // All stencil points belong to this cell; no probe steps outside the source region.
    const metric = Math.sqrt(chart.differential(samples[4].uv).det);
    for (const [a, b, c] of [
      [0, 1, 4],
      [0, 4, 3],
      [1, 2, 5],
      [1, 5, 4],
      [3, 4, 7],
      [3, 7, 6],
      [4, 5, 8],
      [4, 8, 7],
    ]) {
      const u = samples[a].uv,
        v = samples[b].uv,
        w = samples[c].uv;
      const jacobian =
        (((v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0])) *
          metric *
          4) /
        ((x1 - x0) * (z1 - z0));
      if (!orientation) orientation = Math.sign(jacobian);
      if (!(orientation * jacobian > 1e-5))
        throw new Error(
          'wrap folds or collapses within the profile region. Reduce the region or move the profiles.',
        );
    }
    // Do not let an entire narrow spline span fall between the sample lines.
    const unresolvedSpan = maps.some((_, m) =>
      [0, 1].some(axis => {
        const values = samples.map(sample => sample.uvs[m][axis]);
        const low = Math.min(...values),
          high = Math.max(...values);
        return knots[axis].slice(1).some((end, i) => {
          const start = knots[axis][i];
          return (
            start >= low &&
            end <= high &&
            !values.some(value => value > start && value < end)
          );
        });
      }),
    );
    if (depth < 2 || error > chart.tolerance / 2 || unresolvedSpan) {
      if (depth >= 12)
        throw new Error(
          'wrap could not converge while validating the profile region. Reduce the region or relax tolerance.',
        );
      visit(
        [
          [x0, z0],
          [xm, zm],
        ],
        depth + 1,
      );
      visit(
        [
          [xm, z0],
          [x1, zm],
        ],
        depth + 1,
      );
      visit(
        [
          [x0, zm],
          [xm, z1],
        ],
        depth + 1,
      );
      visit(
        [
          [xm, zm],
          [x1, z1],
        ],
        depth + 1,
      );
    }
  }
  visit(region, 0);
  return maps[0];
}
