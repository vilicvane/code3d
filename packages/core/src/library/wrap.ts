import {
  assembleWire,
  BoundingBox,
  getOC,
  cast,
  type AnyShape,
  type Edge,
  type Face,
  type Wire,
} from 'replicad';
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
import {describeOpenCascadeException} from './open-cascade-error.js';
import {castOwnedShape, shapeSubshapes} from './kernel-shapes.js';
import type {Vec3} from './spatial.js';

/** Geometric accuracy in model units, including geodesics and fitted boundaries. */
export interface WrapOptions {
  tolerance?: number;
}
type UV = readonly [number, number];
type State = readonly [number, number, number, number];
type Bounds = readonly [Vec3, Vec3];
const tuple = (p: {X(): number; Y(): number; Z(): number}): Vec3 => [
  p.X(),
  p.Y(),
  p.Z(),
];
const sum = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (v: Vec3) => Math.hypot(...v);
const distance = (a: Vec3, b: Vec3) => norm(subtract(a, b));

function bounds(shape: AnyShape): Bounds {
  const box = new BoundingBox();
  try {
    getOC().BRepBndLib.AddOptimal(shape.wrapped, box.wrapped, false, false);
    return box.bounds;
  } finally {
    box.delete();
  }
}

/** Inputs have already been expressed in their shared XZ source plane. */
export function wrapFaces(
  profiles: readonly Face[],
  target: Face,
  tolerance: number,
): AnyShape {
  const boxes = profiles.map(bounds);
  if (
    profiles.some(
      (face, i) =>
        face.geomType !== 'PLANE' ||
        Math.max(Math.abs(boxes[i][0][1]), Math.abs(boxes[i][1][1])) >
          tolerance,
    )
  )
    throw new Error('wrap requires coplanar profiles.');
  const region: Bounds = [
    [
      Math.min(...boxes.map(b => b[0][0])),
      0,
      Math.min(...boxes.map(b => b[0][2])),
    ],
    [
      Math.max(...boxes.map(b => b[1][0])),
      0,
      Math.max(...boxes.map(b => b[1][2])),
    ],
  ];
  const candidates = closestCandidates(region, target, tolerance);
  const surface = new SurfaceChart(target, tolerance, candidates[0]);
  const outputs: Face[] = [];
  try {
    const mappings = candidates.map(point => surface.mapping(point));
    // Compare complete local maps, rather than rejecting multiple closest points.
    // The rectangle includes the blank space between disconnected profiles.
    const samples = regionSamples(region);
    const baseline = samples.map(p => mappings[0](p));
    for (const mapping of mappings.slice(1))
      if (
        samples.some(
          (p, i) =>
            distance(surface.point(mapping(p)), surface.point(baseline[i])) >
            tolerance,
        )
      )
        throw new Error(
          'wrap has multiple distinct results within the profile region. Move or rotate the profiles to select one.',
        );
    const map = mappings[0];
    validateRegion(region, map, surface);
    // Validate the whole layout domain against the target trim, including holes
    // in the target beneath whitespace; contours alone cannot establish coverage.
    const rectangle = regionFace(region);
    try {
      const patch = mappedFace(rectangle, map, surface, tolerance);
      try {
        requireCovered(patch, target, tolerance);
      } finally {
        patch.delete();
      }
    } finally {
      rectangle.delete();
    }
    for (const profile of profiles) {
      const patch = mappedFace(profile, map, surface, tolerance);
      try {
        outputs.push(...trimmedFaces(patch, target));
      } finally {
        patch.delete();
      }
    }
    const oc = getOC(),
      builder = new oc.TopoDS_Builder(),
      compound = new oc.TopoDS_Compound();
    try {
      builder.MakeCompound(compound);
      for (const face of outputs) builder.Add(compound, face.wrapped);
      return cast(compound);
    } finally {
      compound.delete();
      builder.delete();
    }
  } catch (error) {
    const detail = describeOpenCascadeException(error);
    if (detail) throw new Error(`wrap: ${detail}`, {cause: error});
    throw error;
  } finally {
    outputs.forEach(face => face.delete());
    surface.delete();
  }
}

function regionFace([[x0, , z0], [x1, , z1]]: Bounds): Face {
  const oc = getOC(),
    point = new oc.gp_Pnt(0, 0, 0),
    normal = new oc.gp_Dir(0, -1, 0),
    x = new oc.gp_Dir(1, 0, 0);
  const frame = new oc.gp_Ax3(point, normal, x),
    plane = new oc.gp_Pln(frame);
  try {
    const builder = new oc.BRepBuilderAPI_MakeFace(plane, x0, x1, z0, z1);
    try {
      return castOwnedShape(builder.Face()) as Face;
    } finally {
      builder.delete();
    }
  } finally {
    plane.delete();
    frame.delete();
    x.delete();
    normal.delete();
    point.delete();
  }
}

function regionPrism(region: Bounds, targetBounds: Bounds): AnyShape {
  const oc = getOC(),
    corner = new oc.gp_Pnt(region[0][0], targetBounds[0][1] - 1, region[0][2]);
  try {
    const builder = new oc.BRepPrimAPI_MakeBox(
      corner,
      region[1][0] - region[0][0],
      targetBounds[1][1] - targetBounds[0][1] + 2,
      region[1][2] - region[0][2],
    );
    try {
      return castOwnedShape(builder.Shape());
    } finally {
      builder.delete();
    }
  } finally {
    corner.delete();
  }
}

function closestCandidates(
  region: Bounds,
  target: Face,
  tolerance: number,
): Vec3[] {
  const oc = getOC(),
    box = bounds(target);
  const prism = regionPrism(region, box);
  const rectangle = regionFace(region);
  const builder = new oc.BRepAlgoAPI_Common(target.wrapped, prism.wrapped);
  try {
    builder.Build();
    if (!builder.IsDone())
      throw new Error(
        'wrap could not isolate the target within the profile region.',
      );
    const cropped = castOwnedShape(builder.Shape());
    try {
      const faces = shapeSubshapes(cropped, 'face');
      const empty = !faces.length;
      faces.forEach(face => face.delete());
      if (empty)
        throw new Error(
          'wrap found no target surface beneath the profile region.',
        );
      const [[, y0], [, y1]] = bounds(cropped);
      if (y0 < -tolerance && y1 > tolerance)
        throw new Error(
          'wrap: the profile region crosses the target surface. Move or rotate the profiles outside the surface or tangent to it.',
        );
      const extrema = new oc.BRepExtrema_DistShapeShape();
      try {
        extrema.LoadS1(rectangle.wrapped);
        extrema.LoadS2(cropped.wrapped);
        extrema.SetDeflection(tolerance / 16);
        extrema.Perform();
        if (!extrema.IsDone() || !extrema.NbSolution())
          throw new Error('wrap could not locate the closest target point.');
        const points: Vec3[] = [];
        for (let i = 1; i <= extrema.NbSolution(); i++) {
          const p = extrema.PointOnShape2(i);
          try {
            const value = tuple(p);
            if (!points.some(other => distance(value, other) < tolerance / 16))
              points.push(value);
          } finally {
            p.delete();
          }
        }
        return points;
      } finally {
        extrema.delete();
      }
    } finally {
      cropped.delete();
    }
  } finally {
    builder.delete();
    rectangle.delete();
    prism.delete();
  }
}

/** Rotate a sphere's chart without changing its geometric locus or target trim. */
function regularSurface(face: Face, anchor: Vec3): Geom_Surface {
  const oc = getOC();
  if (face.geomType !== 'SPHERE') return oc.BRep_Tool.Surface(face.wrapped);
  const adaptor = new oc.BRepAdaptor_Surface(face.wrapped, false);
  const sphere = adaptor.Sphere(),
    center = sphere.Location();
  const radial = unit(subtract(anchor, tuple(center)));
  const z = new oc.gp_Dir(
      ...(Math.abs(radial[2]) < 0.9
        ? unit(reject([0, 0, 1], radial))
        : perpendicular(radial)),
    ),
    x = new oc.gp_Dir(...radial);
  const frame = new oc.gp_Ax3(center, z, x);
  try {
    return new oc.Geom_SphericalSurface(frame, sphere.Radius());
  } finally {
    frame.delete();
    x.delete();
    z.delete();
    center.delete();
    sphere.delete();
    adaptor.delete();
  }
}

/** A smooth native surface chart; geodesic integration uses its exact derivatives. */
class SurfaceChart {
  readonly surface: Geom_Surface;
  private readonly pointBuffer = new (getOC().gp_Pnt)();
  private readonly derivatives = Array.from(
    {length: 5},
    () => new (getOC().gp_Vec)(),
  );
  constructor(
    readonly face: Face,
    readonly tolerance: number,
    anchor: Vec3,
  ) {
    this.surface = regularSurface(face, anchor);
  }
  delete(): void {
    this.surface.delete();
    this.pointBuffer.delete();
    this.derivatives.forEach(v => v.delete());
  }
  point(uv: UV): Vec3 {
    this.surface.D0(...uv, this.pointBuffer);
    return tuple(this.pointBuffer);
  }
  differential(uv: UV) {
    const [u, v, uu, vv, uvDerivative] = this.derivatives;
    this.surface.D2(...uv, this.pointBuffer, u, v, uu, vv, uvDerivative);
    const du = tuple(u),
      dv = tuple(v),
      E = dot(du, du),
      F = dot(du, dv),
      G = dot(dv, dv),
      det = E * G - F * F;
    if (!(det > 1e-12 * E * G) || !Number.isFinite(det))
      throw new Error(
        'wrap reached a singular surface parameterization. Select a regular surface region.',
      );
    return {
      du,
      dv,
      uu: tuple(uu),
      vv: tuple(vv),
      uv: tuple(uvDerivative),
      E,
      F,
      G,
      det,
    };
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
    let normal = unit(cross(d.du, d.dv));
    if (Math.abs(normal[1]) < 1e-7)
      throw new Error(
        'wrap cannot determine a unique tangent orientation for a perpendicular source plane. Rotate the profiles.',
      );
    if (normal[1] < 0) normal = scale(normal, -1);
    // Minimal rotation from the source normal to the tangent normal preserves
    // the authored orientation; no surface UV axis leaks into the API.
    const axis = cross([0, 1, 0], normal);
    const tangent = (v: Vec3) =>
      sum(
        sum(v, cross(axis, v)),
        scale(cross(axis, cross(axis, v)), 1 / (1 + normal[1])),
      );
    const x = tangent([1, 0, 0]),
      z = tangent([0, 0, 1]);
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
/** Resolve a tangent vector in the surface's non-orthogonal derivative basis. */
function solveMetric(
  d: {E: number; F: number; G: number; det: number},
  a: number,
  b: number,
): UV {
  return [(d.G * a - d.F * b) / d.det, (d.E * b - d.F * a) / d.det];
}

function regionSamples([[x0, , z0], [x1, , z1]]: Bounds): UV[] {
  return Array.from({length: 9}, (_, i) =>
    Array.from(
      {length: 9},
      (_, j) => [x0 + ((x1 - x0) * i) / 8, z0 + ((z1 - z0) * j) / 8] as UV,
    ),
  ).flat();
}
function validateRegion(
  region: Bounds,
  map: (p: UV) => UV,
  chart: SurfaceChart,
): void {
  const samples = regionSamples(region),
    uvs = samples.map(map);
  const h =
    Math.min(region[1][0] - region[0][0], region[1][2] - region[0][2]) * 1e-4;
  let orientation = 0;
  for (const p of samples) {
    const uv = map(p),
      a = map([p[0] + h, p[1]]),
      b = map([p[0], p[1] + h]);
    const jacobian =
      ((a[0] - uv[0]) * (b[1] - uv[1]) - (a[1] - uv[1]) * (b[0] - uv[0])) /
      (h * h);
    const d = chart.differential(uv),
      area = jacobian * Math.sqrt(d.det);
    if (!orientation) orientation = Math.sign(area);
    if (!(orientation * area > 1e-5))
      throw new Error(
        'wrap folds or collapses within the profile region. Reduce the region or move the profiles.',
      );
  }
  const s = chart.surface;
  for (const [axis, period] of [
    [0, s.IsUPeriodic() ? s.UPeriod() : Infinity],
    [1, s.IsVPeriodic() ? s.VPeriod() : Infinity],
  ])
    if (
      Math.max(...uvs.map(p => p[axis])) - Math.min(...uvs.map(p => p[axis])) >=
      period - 1e-8
    )
      throw new Error(
        'wrap overlaps itself around a periodic surface. Reduce the profile region.',
      );
}

type Cubic = readonly [UV, UV, UV, UV];
function bezier(c: Cubic, t: number): UV {
  const k = [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
  return [
    c.reduce((s, p, i) => s + k[i] * p[0], 0),
    c.reduce((s, p, i) => s + k[i] * p[1], 0),
  ];
}
/** Interpolating cubic segments, checked in 3D model units before B-spline assembly. */
function mappedEdge(
  edge: Edge,
  map: (p: UV) => UV,
  chart: SurfaceChart,
  tolerance: number,
): {edge: Edge; area: number} {
  const oc = getOC(),
    adaptor = new oc.BRepAdaptor_Curve(edge.wrapped);
  const first = adaptor.FirstParameter(),
    last = adaptor.LastParameter();
  const straight = adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line;
  const point = new oc.gp_Pnt();
  const evaluate = (t: number): UV => {
    adaptor.D0(first + (last - first) * t, point);
    return map([point.X(), point.Z()]);
  };
  const pieces: {curve: Cubic; end: number}[] = [];
  let area = 0;
  function fit(a: number, b: number, depth: number): void {
    const p = evaluate(a),
      q = evaluate(b),
      r = evaluate(a + (b - a) / 3),
      s = evaluate(a + ((b - a) * 2) / 3);
    const controls = [0, 1].map(i => {
      const A = 27 * r[i] - 8 * p[i] - q[i],
        B = 27 * s[i] - p[i] - 8 * q[i];
      return [(2 * A - B) / 18, (2 * B - A) / 18];
    });
    const curve: Cubic = [
      p,
      [controls[0][0], controls[1][0]],
      [controls[0][1], controls[1][1]],
      q,
    ];
    const error = Math.max(
      ...[0.125, 0.25, 0.5, 0.75, 0.875].map(t =>
        distance(
          chart.point(evaluate(a + (b - a) * t)),
          chart.point(bezier(curve, t)),
        ),
      ),
    );
    if (error > tolerance / 8 || (depth < 2 && !straight)) {
      if (depth >= 16)
        throw new Error(
          'wrap could not fit a boundary within the requested tolerance.',
        );
      fit(a, (a + b) / 2, depth + 1);
      fit((a + b) / 2, b, depth + 1);
    } else {
      pieces.push({curve, end: b});
      let previous = p;
      for (let i = 1; i <= 8; i++) {
        const next = bezier(curve, i / 8);
        area += previous[0] * next[1] - next[0] * previous[1];
        previous = next;
      }
    }
  }
  try {
    fit(0, 1, 0);
    const poles = pieces.flatMap(({curve}, i) => (i ? curve.slice(1) : curve));
    const array = new oc.NCollection_Array1_gp_Pnt2d(1, poles.length),
      knots = new oc.NCollection_Array1_double(1, pieces.length + 1),
      multiplicities = new oc.NCollection_Array1_int(1, pieces.length + 1);
    try {
      poles.forEach((p, i) => {
        const value = new oc.gp_Pnt2d(...p);
        try {
          array.SetValue(i + 1, value);
        } finally {
          value.delete();
        }
      });
      [0, ...pieces.map(p => p.end)].forEach((v, i) => {
        knots.SetValue(i + 1, v);
        multiplicities.SetValue(i + 1, i === 0 || i === pieces.length ? 4 : 3);
      });
      const curve = new oc.Geom2d_BSplineCurve(
        array,
        knots,
        multiplicities,
        3,
        false,
      );
      try {
        const builder = new oc.BRepBuilderAPI_MakeEdge(curve, chart.surface);
        try {
          if (!builder.IsDone())
            throw new Error('wrap could not construct a mapped edge.');
          let result = castOwnedShape(builder.Edge()) as Edge;
          if (edge.orientation === 'backward') {
            const reversed = castOwnedShape(result.wrapped.Reversed()) as Edge;
            result.delete();
            result = reversed;
            area = -area;
          }
          return {edge: result, area};
        } finally {
          builder.delete();
        }
      } finally {
        curve.delete();
      }
    } finally {
      array.delete();
      knots.delete();
      multiplicities.delete();
    }
  } finally {
    point.delete();
    adaptor.delete();
  }
}
function mappedFace(
  profile: Face,
  map: (p: UV) => UV,
  chart: SurfaceChart,
  tolerance: number,
): Face {
  const oc = getOC(),
    wires = shapeSubshapes(profile, 'wire'),
    outer = profile.clone().outerWire(),
    mapped: Wire[] = [];
  try {
    wires.sort(
      (a, b) =>
        Number(b.wrapped.IsSame(outer.wrapped)) -
        Number(a.wrapped.IsSame(outer.wrapped)),
    );
    for (let index = 0; index < wires.length; index++) {
      const edges = shapeSubshapes(wires[index], 'edge'),
        mappedEdges: Edge[] = [];
      let area = 0;
      try {
        for (const edge of edges) {
          const result = mappedEdge(edge, map, chart, tolerance);
          mappedEdges.push(result.edge);
          area += result.area;
        }
        let wire = assembleWire(mappedEdges);
        if (area > 0 !== (index === 0)) {
          const reversed = castOwnedShape(wire.wrapped.Reversed()) as Wire;
          wire.delete();
          wire = reversed;
        }
        if (
          !oc.BRepLib.BuildCurves3d(
            wire.wrapped,
            tolerance / 8,
            getOC().GeomAbs_Shape.GeomAbs_C1,
            14,
            0,
          )
        ) {
          wire.delete();
          throw new Error('wrap could not reconstruct the 3D boundary curves.');
        }
        mapped.push(wire);
      } finally {
        edges.forEach(e => e.delete());
        mappedEdges.forEach(e => e.delete());
      }
    }
    const builder = new oc.BRepBuilderAPI_MakeFace(
      chart.surface,
      mapped[0].wrapped,
      true,
    );
    try {
      for (const wire of mapped.slice(1)) builder.Add(wire.wrapped);
      if (!builder.IsDone())
        throw new Error('wrap could not build the curved face.');
      let face = castOwnedShape(builder.Face()) as Face;
      if (face.orientation !== chart.face.orientation) {
        const reversed = castOwnedShape(face.wrapped.Reversed()) as Face;
        face.delete();
        face = reversed;
      }
      const check = new oc.BRepCheck_Analyzer(face.wrapped, true, false, false);
      try {
        if (!check.IsValid()) {
          face.delete();
          throw new Error('wrap produced an invalid or intersecting boundary.');
        }
      } finally {
        check.delete();
      }
      return face;
    } finally {
      builder.delete();
    }
  } finally {
    outer.delete();
    wires.forEach(w => w.delete());
    mapped.forEach(w => w.delete());
  }
}
function trimmedFaces(patch: Face, target: Face): Face[] {
  const builder = new (getOC().BRepAlgoAPI_Common)(
    patch.wrapped,
    target.wrapped,
  );
  try {
    builder.Build();
    if (!builder.IsDone())
      throw new Error(
        'wrap could not intersect its result with the target surface.',
      );
    const result = castOwnedShape(builder.Shape());
    try {
      return shapeSubshapes(result, 'face');
    } finally {
      result.delete();
    }
  } finally {
    builder.delete();
  }
}
function requireCovered(patch: Face, target: Face, tolerance: number): void {
  const faces = trimmedFaces(patch, target);
  try {
    const area = surfaceArea(patch);
    const covered = faces.reduce((s, f) => s + surfaceArea(f), 0);
    if (
      !faces.length ||
      Math.abs(area - covered) > Math.max(tolerance * tolerance, area * 1e-6)
    )
      throw new Error(
        'wrap leaves the selected target face or crosses its trimmed boundary. Reduce or reposition the profile region.',
      );
  } finally {
    faces.forEach(f => f.delete());
  }
}

function surfaceArea(shape: AnyShape): number {
  const oc = getOC(),
    properties = new oc.GProp_GProps();
  try {
    oc.BRepGProp.SurfaceProperties(shape.wrapped, properties, false, false);
    return properties.Mass();
  } finally {
    properties.delete();
  }
}
