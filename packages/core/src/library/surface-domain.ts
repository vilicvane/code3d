import {getOC, type Face} from 'replicad';
import {withNativeScope} from './kernel-scope.js';
import {transformShape} from './kernel-shapes.js';
import {surfaceKnots, type UV} from './surface-geometry.js';

export type Triangle = readonly [UV, UV, UV];

/** A private native tessellation respects the face's outer trim, holes and seams. */
export function faceTriangles(face: Face, tolerance: number): Triangle[] {
  return withNativeScope(scope => {
    const oc = getOC();
    // Copy geometry before meshing: validation must not depend on viewport caches.
    const copy = scope.own(transformShape(face, () => {}));
    const mesh = scope.own(
      new oc.BRepMesh_IncrementalMesh(
        copy.wrapped,
        tolerance,
        false,
        0.1,
        false,
      ),
    );
    if (!mesh.IsDone())
      throw new Error('Could not resolve the finite surface domain.');
    const location = scope.own(new oc.TopLoc_Location());
    const triangulation = oc.BRep_Tool.Triangulation(copy.wrapped, location, 0);
    if (!triangulation)
      throw new Error('Could not resolve the finite surface domain.');
    scope.own(triangulation);
    if (
      triangulation.isNull() ||
      !triangulation.HasUVNodes() ||
      !triangulation.NbTriangles()
    )
      throw new Error('Could not resolve the finite surface domain.');
    const uv: UV[] = Array.from({length: triangulation.NbNodes()}, (_, i) => {
      const p = triangulation.UVNode(i + 1);
      try {
        return [p.X(), p.Y()];
      } finally {
        p.delete();
      }
    });
    const result: Triangle[] = [];
    for (let i = 1; i <= triangulation.NbTriangles(); i++) {
      const triangle = triangulation.Triangle(i);
      try {
        result.push([
          uv[triangle.Value(1) - 1],
          uv[triangle.Value(2) - 1],
          uv[triangle.Value(3) - 1],
        ]);
      } finally {
        triangle.delete();
      }
    }
    return result;
  });
}

/** Split mesh triangles at spline knots before adaptive curvature checks. */
export function knotTriangles(
  face: Face,
  triangles: readonly Triangle[],
): Triangle[] {
  const knots = surfaceKnots(face),
    result: Triangle[] = [];
  for (const triangle of triangles) {
    let polygons: UV[][] = [[...triangle]];
    for (let axis = 0; axis < 2; axis++) {
      const low = Math.min(...triangle.map(p => p[axis])),
        high = Math.max(...triangle.map(p => p[axis]));
      for (const knot of knots[axis].filter(v => v > low && v < high))
        polygons = polygons.flatMap(p => split(p, axis, knot));
    }
    for (const polygon of polygons)
      for (let i = 1; i < polygon.length - 1; i++) {
        const t: Triangle = [polygon[0], polygon[i], polygon[i + 1]];
        if (
          Math.abs(
            (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) -
              (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]),
          ) > 0
        )
          result.push(t);
      }
  }
  return result;
}

function split(polygon: readonly UV[], axis: number, value: number): UV[][] {
  const sides: UV[][] = [[], []];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    if (p[axis] <= value) sides[0].push(p);
    if (p[axis] >= value) sides[1].push(p);
    if (
      (p[axis] < value && q[axis] > value) ||
      (p[axis] > value && q[axis] < value)
    ) {
      const t = (value - p[axis]) / (q[axis] - p[axis]);
      const intersection: UV = [
        p[0] + (q[0] - p[0]) * t,
        p[1] + (q[1] - p[1]) * t,
      ];
      sides.forEach(side => side.push(intersection));
    }
  });
  return sides.filter(side => side.length >= 3);
}

export const midpoint = (a: UV, b: UV): UV => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
];
export const centroid = ([a, b, c]: Triangle): UV => [
  (a[0] + b[0] + c[0]) / 3,
  (a[1] + b[1] + c[1]) / 3,
];
export function subdivide([a, b, c]: Triangle): readonly Triangle[] {
  const ab = midpoint(a, b),
    bc = midpoint(b, c),
    ca = midpoint(c, a);
  return [
    [a, ab, ca],
    [ab, b, bc],
    [ca, bc, c],
    [ab, bc, ca],
  ];
}
