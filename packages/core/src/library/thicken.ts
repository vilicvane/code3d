import {cast, getOC, type Face, type Shape3D} from 'replicad';
import {cross, dot, scale} from './alignment-geometry.js';
import type {Vec3} from './spatial.js';
import {castOwnedShape3D} from './kernel-shapes.js';
import {describeOpenCascadeException} from './open-cascade-error.js';
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
  const oc = getOC(),
    builder = new oc.BRepOffsetAPI_MakeThickSolid();
  let shape: Shape3D | undefined;
  try {
    requireRegularOffset(source.shape as Face, thickness);
    builder.MakeThickSolidBySimple(source.shape.wrapped, thickness);
    if (!builder.IsDone())
      throw new Error('The surface offset could not be constructed.');
    shape = castOwnedShape3D(builder.Shape());
    const solid = oc.TopoDS.Solid(shape.wrapped);
    try {
      // MakeSimpleOffset closes its shell without orienting it as a solid.
      // Normalize that native result before signed volume and boolean operations.
      if (!oc.BRepLib.OrientClosedSolid(solid))
        throw new Error('The offset did not form a closed solid.');
      const oriented = cast(solid).asShape3D();
      shape.delete();
      shape = oriented;
    } finally {
      solid.delete();
    }
    const check = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false);
    try {
      if (!check.IsValid())
        throw new Error('The offset is invalid. Reduce the thickness.');
    } finally {
      check.delete();
    }
    const properties = new oc.GProp_GProps();
    try {
      oc.BRepGProp.VolumeProperties(
        shape.wrapped,
        properties,
        false,
        false,
        false,
      );
      if (!(properties.Mass() > 0))
        throw new Error(
          'The offset has no positive volume. Reduce the thickness.',
        );
    } finally {
      properties.delete();
    }
    return {shape, topology: transferShapeTopology([source], shape, builder)};
  } catch (error) {
    shape?.delete();
    const detail =
      describeOpenCascadeException(error) ??
      (error instanceof Error ? error.message : String(error));
    throw new Error(`thicken: ${detail}`, {cause: error});
  } finally {
    builder.delete();
  }
}

/** OCCT's simple offset can accept a folded offset past a curvature centre. */
function requireRegularOffset(face: Face, thickness: number): void {
  if (face.geomType === 'PLANE') return;
  const oc = getOC(),
    surface = oc.BRep_Tool.Surface(face.wrapped),
    point = new oc.gp_Pnt();
  const derivatives = Array.from({length: 5}, () => new oc.gp_Vec());
  const coordinates = (v: {X(): number; Y(): number; Z(): number}): Vec3 => [
    v.X(),
    v.Y(),
    v.Z(),
  ];
  const {uMin, uMax, vMin, vMax} = face.UVBounds;
  try {
    // Interior samples avoid removable UV singularities at analytic poles.
    // Native shape validation separately checks the constructed boundaries.
    for (let i = 0; i < 9; i++)
      for (let j = 0; j < 9; j++) {
        const [du, dv, duu, dvv, duv] = derivatives;
        surface.D2(
          uMin + ((uMax - uMin) * (i + 0.5)) / 9,
          vMin + ((vMax - vMin) * (j + 0.5)) / 9,
          point,
          du,
          dv,
          duu,
          dvv,
          duv,
        );
        const u = coordinates(du),
          v = coordinates(dv),
          n = cross(u, v),
          magnitude = Math.hypot(...n);
        if (!(magnitude > 0))
          throw new Error('The surface has a singular offset normal.');
        const normal = scale(
          n,
          (face.orientation === 'forward' ? 1 : -1) / magnitude,
        );
        const E = dot(u, u),
          F = dot(u, v),
          G = dot(v, v),
          det = E * G - F * F;
        const e = dot(normal, coordinates(duu)),
          f = dot(normal, coordinates(duv)),
          g = dot(normal, coordinates(dvv));
        const mean = (e * G - 2 * f * F + g * E) / (2 * det),
          gaussian = (e * g - f * f) / det;
        const spread = Math.sqrt(Math.max(0, mean * mean - gaussian));
        if (
          Math.min(
            1 - thickness * (mean + spread),
            1 - thickness * (mean - spread),
          ) <= 1e-7
        )
          throw new Error(
            'Thickness reaches or crosses a curvature centre. Reduce the thickness.',
          );
      }
  } finally {
    derivatives.forEach(v => v.delete());
    point.delete();
    surface.delete();
  }
}
