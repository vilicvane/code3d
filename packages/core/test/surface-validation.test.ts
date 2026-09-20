import assert from 'node:assert/strict';
import {test} from 'node:test';
import '../bld/node/index.js';
import {getOC, sketchRectangle, type Face} from 'replicad';
import {withNativeScope} from '../bld/library/kernel-scope.js';
import {castOwnedShape} from '../bld/library/kernel-shapes.js';
import {initialShapeTopology} from '../bld/library/topology.js';
import {SurfaceChart} from '../bld/library/wrap-mapping.js';
import {mappedFace} from '../bld/library/wrap-face.js';
import {wrapFaces} from '../bld/library/wrap.js';
import {thickenWithTopology} from '../bld/library/thicken.js';
import {
  SurfaceGeometry,
  principalCurvatures,
} from '../bld/library/surface-geometry.js';
import {faceTriangles, centroid} from '../bld/library/surface-domain.js';

/** y=(x²+z²)/2 on [-4,4]²; the inward offset folds first at the origin. */
function paraboloid(): Face {
  return withNativeScope(scope => {
    const oc = getOC(),
      poles = scope.own(new oc.NCollection_Array2_gp_Pnt(1, 3, 1, 3));
    const knots = scope.own(new oc.NCollection_Array1_double(1, 2)),
      mults = scope.own(new oc.NCollection_Array1_int(1, 2));
    knots.SetValue(1, -4);
    knots.SetValue(2, 4);
    mults.SetValue(1, 3);
    mults.SetValue(2, 3);
    const heights = [8, -8, 8];
    for (let u = 0; u < 3; u++)
      for (let v = 0; v < 3; v++) {
        const p = scope.own(
          new oc.gp_Pnt(-4 + u * 4, heights[u] + heights[v], -4 + v * 4),
        );
        poles.SetValue(u + 1, v + 1, p);
      }
    const surface = scope.own(
      new oc.Geom_BSplineSurface(
        poles,
        knots,
        knots,
        mults,
        mults,
        2,
        2,
        false,
        false,
      ),
    );
    const builder = scope.own(new oc.BRepBuilderAPI_MakeFace(surface, 1e-7));
    const face = castOwnedShape(builder.Face()) as Face;
    face.wrapped.Reverse();
    return face;
  });
}

function hollowProfile(): Face {
  return withNativeScope(scope => {
    const oc = getOC(),
      outer = scope.own(sketchRectangle(6, 6, {plane: 'XZ'})),
      inner = scope.own(sketchRectangle(4, 4, {plane: 'XZ'}));
    const hole = scope.own(inner.wire.clone());
    hole.wrapped.Reverse();
    const builder = scope.own(
      new oc.BRepBuilderAPI_MakeFace(outer.wire.wrapped, false),
    );
    builder.Add(hole.wrapped);
    return castOwnedShape(builder.Face()) as Face;
  });
}

function offset(face: Face, thickness: number) {
  return thickenWithTopology(
    {shape: face, topology: initialShapeTopology(face), namespace: 1},
    thickness,
  ).shape;
}

test('offset curvature checks exclude holes in the actual trimmed surface', () => {
  withNativeScope(scope => {
    const surface = scope.own(paraboloid());
    const geometry = scope.own(
      new SurfaceGeometry(getOC().BRep_Tool.Surface(surface.wrapped)),
    );
    assert.ok(
      principalCurvatures(geometry.differential([0, 0]), -1).every(
        k => k > 0.99,
      ),
    );
    assert.throws(() => offset(surface, 1.5), /curvature centre/);
    const chart = scope.own(new SurfaceChart(surface, 0.001, [0, 0, 0])),
      profile = scope.own(hollowProfile());
    const trimmed = scope.own(mappedFace(profile, uv => uv, chart, 0.001));
    const triangles = faceTriangles(trimmed, 0.001);
    for (const triangle of triangles) {
      const [u, v] = centroid(triangle);
      assert.ok(Math.max(Math.abs(u), Math.abs(v)) >= 2 - 1e-6);
    }
    const thickened = scope.own(offset(trimmed, 1.5));
    assert.equal(thickened.wrapped.IsNull(), false);
  });
});

test('failed native boundary reconstruction releases all temporary handles', () => {
  const oc = getOC() as import('@code3d/opencascade').OpenCascadeInstance;
  withNativeScope(scope => {
    const sourceSketch = scope.own(sketchRectangle(2, 2, {plane: 'XZ'})),
      targetSketch = scope.own(
        sketchRectangle(5, 5, {plane: 'XZ', origin: [0, 2, 0]}),
      );
    const source = scope.own(sourceSketch.face()),
      target = scope.own(targetSketch.face());
    const original = oc.BRepLib.BuildCurves3d;
    oc.BRepLib.BuildCurves3d = () => {
      throw new Error('injected reconstruction failure');
    };
    try {
      const batch = () => {
        for (let i = 0; i < 12; i++)
          assert.throws(
            () => wrapFaces([source], target, 0.001),
            /injected reconstruction failure/,
          );
        return oc.Code3dMemory.AllocatedBytes();
      };
      const warm = batch(),
        later = batch();
      assert.ok(later - warm < 4096, `${warm} -> ${later}`);
    } finally {
      oc.BRepLib.BuildCurves3d = original;
    }
  });
});

/** A curvature spike confined to the short central quadratic knot span. */
function narrowRidge(): Face {
  return withNativeScope(scope => {
    const oc = getOC(),
      poles = scope.own(new oc.NCollection_Array2_gp_Pnt(1, 5, 1, 2));
    const uknots = scope.own(new oc.NCollection_Array1_double(1, 4)),
      umults = scope.own(new oc.NCollection_Array1_int(1, 4));
    const vknots = scope.own(new oc.NCollection_Array1_double(1, 2)),
      vmults = scope.own(new oc.NCollection_Array1_int(1, 2));
    [0, 0.44, 0.46, 1].forEach((k, i) => {
      uknots.SetValue(i + 1, k);
      umults.SetValue(i + 1, i === 0 || i === 3 ? 3 : 1);
    });
    [0, 1].forEach((k, i) => {
      vknots.SetValue(i + 1, k);
      vmults.SetValue(i + 1, 2);
    });
    [0, 0.22, 0.45, 0.73, 1].forEach((x, i) => {
      for (let j = 0; j < 2; j++) {
        const p = scope.own(new oc.gp_Pnt(x, i === 2 ? 0.02 : 0, j));
        poles.SetValue(i + 1, j + 1, p);
      }
    });
    const surface = scope.own(
      new oc.Geom_BSplineSurface(
        poles,
        uknots,
        vknots,
        umults,
        vmults,
        2,
        1,
        false,
        false,
      ),
    );
    const builder = scope.own(new oc.BRepBuilderAPI_MakeFace(surface, 1e-7));
    return castOwnedShape(builder.Face()) as Face;
  });
}

test('adaptive offset validation detects curvature between the former fixed sample lines', () => {
  withNativeScope(scope => {
    const face = scope.own(narrowRidge()),
      geometry = scope.own(
        new SurfaceGeometry(getOC().BRep_Tool.Surface(face.wrapped)),
      );
    const margin = (u: number) =>
      Math.min(
        ...principalCurvatures(geometry.differential([u, 0.5]), 1).map(
          k => 1 - 0.5 * k,
        ),
      );
    assert.ok(
      Array.from({length: 9}, (_, i) => margin((i + 0.5) / 9)).every(
        value => value > 0,
      ),
    );
    assert.ok(margin(0.45) < 0);
    assert.throws(() => offset(face, 0.5), /curvature centre/);
  });
});

test('partial surface evaluator construction releases the acquired surface and buffers', () => {
  const oc = getOC() as import('@code3d/opencascade').OpenCascadeInstance;
  withNativeScope(scope => {
    const sketch = scope.own(sketchRectangle(2, 2, {plane: 'XZ'})),
      face = scope.own(sketch.face());
    const Vec = oc.gp_Vec;
    let allocations = 0;
    oc.gp_Vec = new Proxy(Vec, {
      construct(target, args) {
        if (++allocations % 3 === 0)
          throw new Error('injected buffer allocation failure');
        return Reflect.construct(target, args, target);
      },
    });
    try {
      const batch = () => {
        for (let i = 0; i < 20; i++)
          assert.throws(
            () => new SurfaceGeometry(oc.BRep_Tool.Surface(face.wrapped)),
            /injected buffer allocation failure/,
          );
        return oc.Code3dMemory.AllocatedBytes();
      };
      const warm = batch(),
        later = batch();
      assert.ok(later - warm < 4096, `${warm} -> ${later}`);
    } finally {
      oc.gp_Vec = Vec;
    }
  });
});
