import {getOC, type Face} from 'replicad';
import type {Geom_Surface, gp_Pnt, gp_Vec} from 'replicad-opencascadejs';
import {cross, dot, scale, subtract} from './alignment-geometry.js';
import {NativeScope, withNativeScope} from './kernel-scope.js';
import type {Vec3, Quaternion} from './spatial.js';

export type UV = readonly [number, number];
export type SurfaceMap = (point: UV) => UV;
export type Rectangle = readonly [UV, UV];
export const coordinates = (p: {
  X(): number;
  Y(): number;
  Z(): number;
}): Vec3 => [p.X(), p.Y(), p.Z()];
export const distance = (a: Vec3, b: Vec3): number =>
  Math.hypot(...subtract(a, b));

/** The nearest tangent normal determines the minimal rotation of authored directions. */
export function surfaceRotation(from: Vec3, normal: Vec3): Quaternion {
  const cosine = dot(from, normal);
  if (Math.abs(cosine) < 1e-7)
    throw new Error(
      'wrap cannot determine a unique tangent orientation for a perpendicular source plane. Rotate the profiles.',
    );
  const aligned = cosine < 0 ? scale(normal, -1) : normal;
  const axis = cross(from, aligned),
    denominator = Math.sqrt(2 * (1 + Math.abs(cosine)));
  return [
    axis[0] / denominator,
    axis[1] / denominator,
    axis[2] / denominator,
    denominator / 2,
  ];
}

/** Own the supplied surface and reusable native evaluation buffers. */
export class SurfaceGeometry {
  private readonly resources = new NativeScope();
  private readonly pointBuffer: gp_Pnt;
  private readonly derivatives: gp_Vec[];

  constructor(readonly surface: Geom_Surface) {
    this.resources.own(surface);
    try {
      const oc = getOC();
      this.pointBuffer = this.resources.own(new oc.gp_Pnt());
      this.derivatives = Array.from({length: 5}, () =>
        this.resources.own(new oc.gp_Vec()),
      );
    } catch (error) {
      this.delete();
      throw error;
    }
  }

  delete(): void {
    this.resources.delete();
  }

  point(uv: UV): Vec3 {
    this.surface.D0(...uv, this.pointBuffer);
    return coordinates(this.pointBuffer);
  }

  differential(uv: UV) {
    const [u, v, uu, vv, mixed] = this.derivatives;
    this.surface.D2(...uv, this.pointBuffer, u, v, uu, vv, mixed);
    const du = coordinates(u),
      dv = coordinates(v);
    const E = dot(du, du),
      F = dot(du, dv),
      G = dot(dv, dv),
      det = E * G - F * F;
    if (!(det > 1e-12 * E * G) || !Number.isFinite(det))
      throw new Error(
        'Singular surface parameterization. Select a regular surface region.',
      );
    return {
      point: coordinates(this.pointBuffer),
      du,
      dv,
      uu: coordinates(uu),
      vv: coordinates(vv),
      uv: coordinates(mixed),
      E,
      F,
      G,
      det,
    };
  }
}

export type SurfaceDifferential = ReturnType<SurfaceGeometry['differential']>;

export function principalCurvatures(
  d: SurfaceDifferential,
  facing: number,
): UV {
  const normal = scale(cross(d.du, d.dv), facing / Math.sqrt(d.det));
  const e = dot(normal, d.uu),
    f = dot(normal, d.uv),
    g = dot(normal, d.vv);
  const mean = (e * d.G - 2 * f * d.F + g * d.E) / (2 * d.det);
  const gaussian = (e * g - f * f) / d.det;
  const spread = Math.sqrt(Math.max(0, mean * mean - gaussian));
  return [mean - spread, mean + spread];
}

/** Resolve a tangent vector in the surface's non-orthogonal derivative basis. */
export function solveMetric(d: SurfaceDifferential, a: number, b: number): UV {
  return [(d.G * a - d.F * b) / d.det, (d.E * b - d.F * a) / d.det];
}

/** Knot spans seed validation so a narrow spline feature is not skipped by a coarse mesh. */
export function surfaceKnots(
  face: Face,
): readonly [readonly number[], readonly number[]] {
  if (face.geomType !== 'BSPLINE_SURFACE') return [[], []];
  return withNativeScope(scope => {
    const adaptor = scope.own(
      new (getOC().BRepAdaptor_Surface)(face.wrapped, false),
    );
    const spline = scope.own(adaptor.BSpline());
    return [
      Array.from({length: spline.NbUKnots()}, (_, i) => spline.UKnot(i + 1)),
      Array.from({length: spline.NbVKnots()}, (_, i) => spline.VKnot(i + 1)),
    ];
  });
}
