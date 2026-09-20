import {cast, getOC, type Face, type Shape3D} from 'replicad';
import {cross, scale} from './alignment-geometry.js';
import {castOwnedShape3D} from './kernel-shapes.js';
import {withNativeScope} from './kernel-scope.js';
import {
  SurfaceGeometry,
  principalCurvatures,
  distance,
  type UV,
} from './surface-geometry.js';
import {
  faceTriangles,
  knotTriangles,
  centroid,
  subdivide,
  type Triangle,
} from './surface-domain.js';
import {describeOpenCascadeException} from './open-cascade-error.js';
import type {Vec3} from './spatial.js';
import {
  transferShapeTopology,
  type TopologyInput,
  type ShapeTopology,
} from './topology.js';

/** Offset a face and close its outer and inner boundaries with side walls. */
export function thickenWithTopology(
  source: TopologyInput,
  thickness: number,
): {shape: Shape3D; topology: ShapeTopology} {
  try {
    return withNativeScope(scope => {
      requireRegularOffset(source.shape as Face, thickness);
      const oc = getOC(),
        builder = scope.own(new oc.BRepOffsetAPI_MakeThickSolid());
      builder.MakeThickSolidBySimple(source.shape.wrapped, thickness);
      if (!builder.IsDone())
        throw new Error('The surface offset could not be constructed.');
      const raw = scope.own(castOwnedShape3D(builder.Shape()));
      const solid = scope.own(oc.TopoDS.Solid(raw.wrapped));
      // MakeSimpleOffset closes its shell without orienting it as a solid.
      if (!oc.BRepLib.OrientClosedSolid(solid))
        throw new Error('The offset did not form a closed solid.');
      const shape = scope.own(cast(solid).asShape3D());
      const check = scope.own(
        new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false),
      );
      if (!check.IsValid())
        throw new Error('The offset is invalid. Reduce the thickness.');
      const properties = scope.own(new oc.GProp_GProps());
      oc.BRepGProp.VolumeProperties(
        shape.wrapped,
        properties,
        false,
        false,
        false,
      );
      if (!(Number.isFinite(properties.Mass()) && properties.Mass() > 0))
        throw new Error(
          'The offset has no positive volume. Reduce the thickness.',
        );
      const topology = transferShapeTopology([source], shape, builder);
      return {shape: scope.release(shape), topology};
    });
  } catch (error) {
    const detail =
      describeOpenCascadeException(error) ??
      (error instanceof Error ? error.message : String(error));
    throw new Error(`thicken: ${detail}`, {cause: error});
  }
}

/** Validate the trimmed face, including small spline spans, before native offsetting. */
function requireRegularOffset(face: Face, thickness: number): void {
  if (face.geomType === 'PLANE') return;
  withNativeScope(scope => {
    const geometry = scope.own(
      new SurfaceGeometry(getOC().BRep_Tool.Surface(face.wrapped)),
    );
    const facing = face.orientation === 'forward' ? 1 : -1;
    const tolerance = Math.max(
      1e-7,
      Math.min(0.001, Math.abs(thickness) * 0.001),
    );
    const triangles = knotTriangles(face, faceTriangles(face, tolerance));
    let visits = 0;
    const evaluate = (uv: UV) => {
      const d = geometry.differential(uv),
        normal = scale(cross(d.du, d.dv), facing / Math.sqrt(d.det));
      const margin = Math.min(
        ...principalCurvatures(d, facing).map(k => 1 - thickness * k),
      );
      if (!(margin > 1e-7))
        throw new Error(
          'Thickness reaches or crosses a curvature centre. Reduce the thickness.',
        );
      return {
        point: d.point,
        offset: d.point.map(
          (n, i) => n + thickness * normal[i],
        ) as unknown as Vec3,
        margin,
      };
    };
    function visit(triangle: Triangle, depth: number): void {
      if (++visits > 65536)
        throw new Error(
          'Could not resolve offset regularity within the validation budget. Reduce the thickness.',
        );
      const children = subdivide(triangle);
      // Interior barycentric samples stay in the triangulated trim and avoid UV poles.
      const middle = evaluate(centroid(triangle)),
        samples = children.slice(0, 3).map(t => evaluate(centroid(t)));
      const average = (key: 'point' | 'offset') =>
        samples[0][key].map(
          (_, i) => samples.reduce((sum, s) => sum + s[key][i], 0) / 3,
        ) as unknown as Vec3;
      const error = Math.max(
        distance(middle.point, average('point')),
        distance(middle.offset, average('offset')),
      );
      const margins = [middle.margin, ...samples.map(s => s.margin)];
      const spread = Math.max(...margins) - Math.min(...margins);
      if (error > tolerance / 4 || spread > Math.min(...margins) * 0.1) {
        if (depth >= 12)
          throw new Error(
            'Could not converge while checking offset regularity. Reduce the thickness.',
          );
        for (const child of children) visit(child, depth + 1);
      }
    }
    for (const triangle of triangles) visit(triangle, 0);
  });
}
