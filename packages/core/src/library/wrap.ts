import {BoundingBox, getOC, cast, type AnyShape, type Face} from 'replicad';
import {describeOpenCascadeException} from './open-cascade-error.js';
import {castOwnedShape, shapeSubshapes} from './kernel-shapes.js';
import {withNativeScope} from './kernel-scope.js';
import {coordinates, distance, type Rectangle} from './surface-geometry.js';
import {SurfaceChart, validatedMapping} from './wrap-mapping.js';
import {mappedFace, requireCovered, trimmedFaces} from './wrap-face.js';
import type {Vec3} from './spatial.js';

/** Geometric accuracy in model units, including geodesics and fitted boundaries. */
export interface WrapOptions {
  tolerance?: number;
}
type Bounds = readonly [Vec3, Vec3];

function bounds(shape: AnyShape): Bounds {
  return withNativeScope(scope => {
    const box = scope.own(new BoundingBox());
    getOC().BRepBndLib.AddOptimal(shape.wrapped, box.wrapped, false, false);
    return box.bounds;
  });
}

/** Inputs have already been expressed in their shared XZ source plane. */
export function wrapFaces(
  profiles: readonly Face[],
  target: Face,
  tolerance: number,
): AnyShape {
  try {
    return withNativeScope(scope => {
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
      const region: Rectangle = [
        [
          Math.min(...boxes.map(b => b[0][0])),
          Math.min(...boxes.map(b => b[0][2])),
        ],
        [
          Math.max(...boxes.map(b => b[1][0])),
          Math.max(...boxes.map(b => b[1][2])),
        ],
      ];
      const candidates = closestCandidates(region, target, tolerance);
      const chart = scope.own(
        new SurfaceChart(target, tolerance, candidates[0]),
      );
      const map = validatedMapping(region, candidates, chart);
      // The complete layout includes whitespace and must fit the target trim.
      withNativeScope(regionScope => {
        const rectangle = regionScope.own(regionFace(region));
        const patch = regionScope.own(
          mappedFace(rectangle, map, chart, tolerance),
        );
        requireCovered(patch, target, tolerance);
      });
      const oc = getOC(),
        builder = scope.own(new oc.TopoDS_Builder()),
        compound = scope.own(new oc.TopoDS_Compound());
      builder.MakeCompound(compound);
      for (const profile of profiles)
        withNativeScope(faceScope => {
          const patch = faceScope.own(
            mappedFace(profile, map, chart, tolerance),
          );
          const faces = trimmedFaces(patch, target).map(face =>
            faceScope.own(face),
          );
          for (const face of faces) builder.Add(compound, face.wrapped);
        });
      return cast(compound);
    });
  } catch (error) {
    const detail = describeOpenCascadeException(error);
    if (detail) throw new Error(`wrap: ${detail}`, {cause: error});
    throw error;
  }
}

function regionFace([[x0, z0], [x1, z1]]: Rectangle): Face {
  return withNativeScope(scope => {
    const oc = getOC(),
      point = scope.own(new oc.gp_Pnt(0, 0, 0)),
      normal = scope.own(new oc.gp_Dir(0, -1, 0)),
      x = scope.own(new oc.gp_Dir(1, 0, 0));
    const frame = scope.own(new oc.gp_Ax3(point, normal, x)),
      plane = scope.own(new oc.gp_Pln(frame));
    const builder = scope.own(
      new oc.BRepBuilderAPI_MakeFace(plane, x0, x1, z0, z1),
    );
    return castOwnedShape(builder.Face()) as Face;
  });
}

function closestCandidates(
  region: Rectangle,
  target: Face,
  tolerance: number,
): Vec3[] {
  return withNativeScope(scope => {
    const oc = getOC(),
      box = bounds(target);
    const corner = scope.own(
      new oc.gp_Pnt(region[0][0], box[0][1] - 1, region[0][1]),
    );
    const prismBuilder = scope.own(
      new oc.BRepPrimAPI_MakeBox(
        corner,
        region[1][0] - region[0][0],
        box[1][1] - box[0][1] + 2,
        region[1][1] - region[0][1],
      ),
    );
    const prism = scope.own(castOwnedShape(prismBuilder.Shape()));
    const rectangle = scope.own(regionFace(region));
    const builder = scope.own(
      new oc.BRepAlgoAPI_Common(target.wrapped, prism.wrapped),
    );
    builder.Build();
    if (!builder.IsDone())
      throw new Error(
        'wrap could not isolate the target within the profile region.',
      );
    const cropped = scope.own(castOwnedShape(builder.Shape()));
    const faces = shapeSubshapes(cropped, 'face').map(face => scope.own(face));
    if (!faces.length)
      throw new Error(
        'wrap found no target surface beneath the profile region.',
      );
    const [[, y0], [, y1]] = bounds(cropped);
    if (y0 < -tolerance && y1 > tolerance)
      throw new Error(
        'wrap: the profile region crosses the target surface. Move or rotate the profiles outside the surface or tangent to it.',
      );
    const extrema = scope.own(new oc.BRepExtrema_DistShapeShape());
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
        const value = coordinates(p);
        if (!points.some(other => distance(value, other) < tolerance / 16))
          points.push(value);
      } finally {
        p.delete();
      }
    }
    return points;
  });
}
