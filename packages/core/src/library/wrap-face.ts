import {getOC, type Face, type Edge, type Wire, type AnyShape} from 'replicad';
import {castOwnedShape, shapeSubshapes} from './kernel-shapes.js';
import {withNativeScope} from './kernel-scope.js';
import {distance, type UV} from './surface-geometry.js';
import type {SurfaceChart} from './wrap-mapping.js';

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
  return withNativeScope(scope => {
    const oc = getOC(),
      adaptor = scope.own(new oc.BRepAdaptor_Curve(edge.wrapped));
    const first = adaptor.FirstParameter(),
      last = adaptor.LastParameter();
    const straight = adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line;
    const point = scope.own(new oc.gp_Pnt());
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
    fit(0, 1, 0);
    const poles = pieces.flatMap(({curve}, i) => (i ? curve.slice(1) : curve));
    const array = scope.own(
      new oc.NCollection_Array1_gp_Pnt2d(1, poles.length),
    );
    const knots = scope.own(
      new oc.NCollection_Array1_double(1, pieces.length + 1),
    );
    const multiplicities = scope.own(
      new oc.NCollection_Array1_int(1, pieces.length + 1),
    );
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
    const curve = scope.own(
      new oc.Geom2d_BSplineCurve(array, knots, multiplicities, 3, false),
    );
    const builder = scope.own(
      new oc.BRepBuilderAPI_MakeEdge(curve, chart.surface),
    );
    if (!builder.IsDone())
      throw new Error('wrap could not construct a mapped edge.');
    const result = scope.own(castOwnedShape(builder.Edge()) as Edge);
    if (edge.orientation === 'backward') {
      result.wrapped.Reverse();
      area = -area;
    }
    return {edge: scope.release(result), area};
  });
}
export function mappedFace(
  profile: Face,
  map: (p: UV) => UV,
  chart: SurfaceChart,
  tolerance: number,
): Face {
  return withNativeScope(scope => {
    const oc = getOC();
    const wires = shapeSubshapes(profile, 'wire').map(w => scope.own(w));
    const outer = scope.own(
      castOwnedShape(oc.BRepTools.OuterWire(profile.wrapped)) as Wire,
    );
    wires.sort(
      (a, b) =>
        Number(b.wrapped.IsSame(outer.wrapped)) -
        Number(a.wrapped.IsSame(outer.wrapped)),
    );
    const mapped = wires.map((wire, index) =>
      scope.own(
        withNativeScope(wireScope => {
          const edges = shapeSubshapes(wire, 'edge').map(e => wireScope.own(e));
          const builder = wireScope.own(new oc.BRepBuilderAPI_MakeWire());
          let area = 0;
          for (const edge of edges) {
            const result = mappedEdge(edge, map, chart, tolerance);
            wireScope.own(result.edge);
            area += result.area;
            builder.Add(result.edge.wrapped);
          }
          if (!builder.IsDone())
            throw new Error(
              'wrap could not connect the mapped boundary edges.',
            );
          const result = wireScope.own(castOwnedShape(builder.Wire()) as Wire);
          if (area > 0 !== (index === 0)) result.wrapped.Reverse();
          if (
            !oc.BRepLib.BuildCurves3d(
              result.wrapped,
              tolerance / 8,
              oc.GeomAbs_Shape.GeomAbs_C1,
              14,
              0,
            )
          )
            throw new Error(
              'wrap could not reconstruct the 3D boundary curves.',
            );
          return wireScope.release(result);
        }),
      ),
    );
    const builder = scope.own(
      new oc.BRepBuilderAPI_MakeFace(chart.surface, mapped[0].wrapped, true),
    );
    for (const wire of mapped.slice(1)) builder.Add(wire.wrapped);
    if (!builder.IsDone())
      throw new Error('wrap could not build the curved face.');
    const face = scope.own(castOwnedShape(builder.Face()) as Face);
    if (face.orientation !== chart.face.orientation) face.wrapped.Reverse();
    const check = scope.own(
      new oc.BRepCheck_Analyzer(face.wrapped, true, false, false),
    );
    if (!check.IsValid())
      throw new Error('wrap produced an invalid or intersecting boundary.');
    return scope.release(face);
  });
}
export function trimmedFaces(patch: Face, target: Face): Face[] {
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
export function requireCovered(
  patch: Face,
  target: Face,
  tolerance: number,
): void {
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
