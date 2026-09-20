import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {getOC, type Face} from 'replicad';
import {
  circle,
  cut,
  cylinder,
  font,
  group,
  rectangle,
  sphere,
  text,
  thicken,
  union,
  wrap,
  type Model,
} from '../bld/node/index.js';
import {definePrimitive, replicad} from '../bld/node/replicad.js';
import {
  clearKernelOperationCache,
  kernelOperationCacheStats,
} from '../bld/library/kernel-cache.js';
import {castOwnedShape} from '../bld/library/kernel-shapes.js';
import {wrapFaces} from '../bld/library/wrap.js';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';

const models: Model[] = [];
const keep = <T extends Model>(value: T): T => {
  models.push(value);
  return value;
};
const keepAll = <T extends Model>(values: readonly T[]) => values.map(keep);
const near = (a: number, b: number, tolerance = 0.002) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
afterEach(() => {
  disposeModelObjects(models.splice(0));
  clearKernelOperationCache();
});
const native = (model: Model) => modelGeometry(model).value.shape;

test('wrap maps a planar region to a cylinder at physical scale, accepting equivalent closest points', () => {
  const body = keep(keep(cylinder(20, 40)).rotate(90, 0, 0));
  const source = keep(keep(rectangle(10, 8)).originOffset(0, -25, 0));
  const patches = keepAll(wrap(source, body.surface(1)));
  near(
    patches.reduce((s, p) => s + p.area, 0),
    80,
  );
  assert.equal((native(patches[0]) as Face).geomType, 'CYLINDRE');
  const raised = keepAll(thicken(patches, 1)),
    engraved = keepAll(thicken(patches, -1));
  near(
    raised.reduce((s, p) => s + p.volume, 0),
    82,
  );
  near(
    engraved.reduce((s, p) => s + p.volume, 0),
    78,
  );
  near(keep(union([body, ...raised])).volume, body.volume + 82);
  near(keep(cut(body, engraved)).volume, body.volume - 78);
  near(source.area, 80);
  near(body.volume, Math.PI * 20 ** 2 * 40);
  assert.equal('plane' in patches[0], false);
  assert.throws(() => patches[0].extrude(1), /planar face/);
  const snap = createModelSnapshotter()(patches[0]);
  assert.equal(snap.operation.kind, 'wrap');
  assert.ok(snap.mesh?.triangles.length);
});

test('sphere uses geodesic distance and normal thickness rather than a planar extrusion', () => {
  const body = keep(sphere(20));
  const source = keep(keep(circle(4)).originOffset(0, -25, 0));
  const [patch] = keepAll(wrap(source, body.surface(1), {tolerance: 0.0005}));
  const expected = 2 * Math.PI * 20 ** 2 * (1 - Math.cos(4 / 20));
  near(patch.area, expected, 0.003);
  const raised = keep(patch.thicken(1));
  near(raised.volume, (expected * (21 ** 3 - 20 ** 3)) / (3 * 20 ** 2), 0.003);
  assert.ok(keep(union([body, raised])).volume > body.volume);
  const inward = keep(thicken(patch, -1));
  assert.ok(keep(cut(body, [inward])).volume < body.volume);
});

test('B-spline ellipsoid supports the same public API', () => {
  const ellipsoid = definePrimitive(() => replicad.makeEllipsoid(20, 30, 25));
  const body = keep(ellipsoid());
  const source = keep(keep(rectangle(6, 4)).originOffset(0, -35, 5));
  const patches = keepAll(wrap(source, body.surface(1)));
  assert.equal((native(patches[0]) as Face).geomType, 'BSPLINE_SURFACE');
  const raised = keepAll(thicken(patches, 1));
  assert.ok(raised.every(p => p.volume > 0));
  near(
    keep(union([body, ...raised])).volume - body.volume,
    raised.reduce((s, p) => s + p.volume, 0),
    0.02,
  );
});

test('text keeps holes and spacing, and unchanged wrap calls reuse geometry', () => {
  const body = keep(keep(cylinder(25, 35)).rotate(90, 0, 0));
  const profiles = keepAll(
    text('B8i', font(new URL('./fonts/DejaVuSans.ttf', import.meta.url)), 8),
  ).map(p => keep(p.originOffset(7, -30, 0)));
  const wrapped = keepAll(wrap(profiles, body.surface(1)));
  near(
    wrapped.reduce((s, p) => s + p.area, 0),
    profiles.reduce((s, p) => s + p.area, 0),
    0.01,
  );
  const solids = keepAll(thicken(wrapped, 0.6));
  const fused = keep(union([body, ...solids]));
  assert.ok(fused.volume > body.volume);
  const misses = kernelOperationCacheStats().misses;
  const again = keepAll(wrap(profiles, body.surface(1)));
  assert.equal(kernelOperationCacheStats().misses, misses);
  assert.notEqual(again[0], wrapped[0]);
});

test('source transforms and exposed target occurrences retain their common coordinate frame', () => {
  const body = keep(sphere(20));
  const moved = keep(body.originOffset(-40, 0, 0));
  const assembly = keep(keep(group([moved])).expose({skin: moved.surface(1)}));
  const profile = keep(keep(rectangle(6, 4)).originOffset(-40, -25, 0));
  const patches = keepAll(wrap(profile, assembly.skin));
  assert.ok(patches[0].bounds().minimum[0] > 36);
  const related = keep(
    keep(rectangle(6, 4)).relate(self => [
      self.plane.align(profile.plane),
      self.center.align(profile.center),
    ]),
  );
  const relatedPatches = keepAll(wrap(related, assembly.skin));
  near(
    relatedPatches.reduce((s, p) => s + p.area, 0),
    patches.reduce((s, p) => s + p.area, 0),
  );
});

test('periodic seam crossing splits valid patches without losing area', () => {
  const body = keep(keep(cylinder(20, 40)).rotate(90, 0, 0));
  const profile = keep(
    keep(keep(rectangle(10, 8)).rotate(0, 0, -90)).originOffset(-25, 0, 0),
  );
  const patches = keepAll(wrap(profile, body.surface(1)));
  near(
    patches.reduce((s, p) => s + p.area, 0),
    80,
  );
  const solids = keepAll(thicken(patches, 0.5));
  near(keep(union([body, ...solids])).volume - body.volume, 40.5, 0.01);
});

test('tangency is allowed, crossing and missing target regions report errors', () => {
  const body = keep(sphere(20));
  const tangent = keep(keep(rectangle(4, 4)).originOffset(0, -20, 0));
  assert.ok(keepAll(wrap(tangent, body.surface(1))).length);
  const crossing = keep(keep(rectangle(12, 8)).originOffset(0, -19.8, 0));
  assert.throws(() => wrap(crossing, body.surface(1)), /region crosses/);
  const absent = keep(keep(rectangle(2, 2)).originOffset(-40, -25, 0));
  assert.throws(() => wrap(absent, body.surface(1)), /no target surface/);
  assert.throws(
    () => wrap(tangent, body.surface(1), {tolerance: 0}),
    /tolerance/,
  );
  assert.throws(() => thicken(tangent, 0), /non-zero/);
});

test('a finite target must cover the complete mapped region', () => {
  const source = keep(rectangle(8, 8));
  const target = keep(keep(rectangle(3, 3)).originOffset(0, 5, 0));
  assert.throws(() => wrap(source, target), /trimmed boundary/);
  const patches = keepAll(wrap(target, source));
  near(
    patches.reduce((s, p) => s + p.area, 0),
    9,
  );
});

/** Quartic height field with equal maxima at x=-2 and x=2, extruded along Z. */
function twinPeaks(): Face {
  const oc = getOC(),
    poles = new oc.NCollection_Array2_gp_Pnt(1, 5, 1, 2);
  const ys = [-19.4, 19, -36.46666666666667, 19, -19.4];
  const uknots = new oc.NCollection_Array1_double(1, 2),
    vknots = new oc.NCollection_Array1_double(1, 2),
    umults = new oc.NCollection_Array1_int(1, 2),
    vmults = new oc.NCollection_Array1_int(1, 2);
  try {
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 2; j++) {
        const p = new oc.gp_Pnt(-4 + i * 2, ys[i], -10 + j * 20);
        poles.SetValue(i + 1, j + 1, p);
        p.delete();
      }
    for (let i = 1; i <= 2; i++) {
      uknots.SetValue(i, i - 1);
      vknots.SetValue(i, i - 1);
      umults.SetValue(i, 5);
      vmults.SetValue(i, 2);
    }
    const surface = new oc.Geom_BSplineSurface(
      poles,
      uknots,
      vknots,
      umults,
      vmults,
      4,
      1,
      false,
      false,
    );
    try {
      const builder = new oc.BRepBuilderAPI_MakeFace(surface, 1e-7);
      try {
        return castOwnedShape(builder.Face()) as Face;
      } finally {
        builder.delete();
      }
    } finally {
      surface.delete();
    }
  } finally {
    poles.delete();
    uknots.delete();
    vknots.delete();
    umults.delete();
    vmults.delete();
  }
}

test('equal bumps inside the region are ambiguous; a distant bump outside is irrelevant', () => {
  const target = twinPeaks(),
    wide = replicad.sketchRectangle(6, 2, {plane: 'XZ'}).face(),
    narrow = replicad
      .sketchRectangle(1, 2, {plane: 'XZ', origin: [2, 0, 0]})
      .face();
  try {
    assert.throws(
      () => wrapFaces([wide], target, 0.001),
      /multiple distinct results/,
    );
    const local = wrapFaces([narrow], target, 0.001);
    local.delete();
  } finally {
    target.delete();
    wide.delete();
    narrow.delete();
  }
});

test('sphere chart poles, flipped normals and subsequent planar wrapping remain usable', () => {
  const ball = keep(sphere(20));
  const pole = keep(
    keep(keep(circle(3)).rotate(90, 0, 0)).originOffset(0, 0, -25),
  );
  const patches = keepAll(wrap(pole, ball.surface(1)));
  near(
    patches.reduce((s, p) => s + p.area, 0),
    2 * Math.PI * 400 * (1 - Math.cos(3 / 20)),
    0.003,
  );
  const plane = keep(rectangle(10, 10));
  const offsetPlane = keep(keep(rectangle(12, 12)).originOffset(0, 5, 0));
  const onPlane = keepAll(wrap(plane, offsetPlane));
  const again = keepAll(wrap(onPlane, plane));
  near(
    again.reduce((s, p) => s + p.area, 0),
    100,
  );
  const source = keep(keep(rectangle(4, 4)).originOffset(0, -25, 0));
  const reversed = keepAll(wrap(source, ball.surface(1).flip()));
  const tools = keepAll(thicken(reversed, 1));
  assert.ok(keep(cut(ball, tools)).volume < ball.volume);
});

test('blank space participates in crossing and source faces must be coplanar', () => {
  const body = keep(sphere(20));
  const left = keep(keep(rectangle(1, 1)).originOffset(5, -19.8, 0));
  const right = keep(keep(rectangle(1, 1)).originOffset(-5, -19.8, 0));
  // Each individual footprint is outside the sphere; their shared layout spans it.
  assert.throws(() => wrap([left, right], body.surface(1)), /region crosses/);
  const lifted = keep(right.originOffset(0, -1, 0));
  assert.throws(() => wrap([left, lifted], body.surface(1)), /coplanar/);
});

test('planar profile normals agree with positive extrusion and normal thickness', () => {
  for (const face of [keep(circle(2)), keep(rectangle(4, 6))]) {
    const normal = (native(face) as Face).normalAt();
    try {
      near(normal.toTuple()[1], 1);
    } finally {
      normal.delete();
    }
    const extruded = keep(face.extrude(2)),
      thickened = keep(face.thicken(2));
    near(extruded.bounds().minimum[1], 0);
    near(thickened.bounds().minimum[1], 0);
    near(thickened.bounds().maximum[1], 2);
    near(thickened.volume, extruded.volume);
  }
});

test('thicken rejects offsets that fold through a curvature centre', () => {
  const body = keep(sphere(20)),
    profile = keep(keep(rectangle(4, 4)).originOffset(0, -25, 0));
  const patches = keepAll(wrap(profile, body.surface(1)));
  for (const thickness of [-20, -25])
    assert.throws(() => thicken(patches, thickness), /curvature centre/);
});

test('repeated wrap and thicken release native temporaries', () => {
  const kernel = getOC() as import('@code3d/opencascade').OpenCascadeInstance;
  const batch = () => {
    for (let i = 0; i < 5; i++) {
      const body = sphere(20),
        source = rectangle(4, 4),
        profile = source.originOffset(0, -25, 0);
      const faces = wrap(profile, body.surface(1)),
        solids = thicken(faces, 0.5);
      disposeModelObjects([body, source, profile, ...faces, ...solids]);
      clearKernelOperationCache();
    }
    return kernel.Code3dMemory.AllocatedBytes();
  };
  const warm = batch(),
    later = batch();
  assert.ok(later - warm < 64 * 1024, `${warm} -> ${later} native bytes`);
});
