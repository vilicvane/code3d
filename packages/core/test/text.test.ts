import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {afterEach, test} from 'node:test';
import {
  font,
  text,
  extrude,
  group,
  box,
  cut,
  union,
  type Model,
} from '../bld/node/index.js';
import {replicad} from '../bld/node/replicad.js';
import {
  clearKernelOperationCache,
  kernelOperationCacheStats,
  setKernelArtifactStore,
} from '../bld/library/kernel-cache.js';
import {groupTextContours, textRegionFace} from '../bld/library/text.js';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';
import type {PathCommand} from 'opentype.js';

const latinUrl = new URL(
  '../../app/examples/fonts/DejaVuSans.ttf',
  import.meta.url,
);
const chineseUrl = new URL('./fonts/NotoSansCJK-subset.otf', import.meta.url);
const models: Model[] = [];
const keep = <T extends Model>(model: T): T => {
  models.push(model);
  return model;
};
const keepAll = <T extends Model>(values: readonly T[]) => values.map(keep);
const volume = (model: Model) =>
  replicad.measureVolume(modelGeometry(model).value.shape.asShape3D());
const near = (a: number, b: number, tolerance = 1e-5) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
afterEach(() => {
  disposeModelObjects(models.splice(0));
  clearKernelOperationCache();
  setKernelArtifactStore(undefined);
});

test('real TTF text keeps holes, independent regions, baseline and signed extrusion', () => {
  const sans = font(latinUrl);
  const faces = keepAll(text('B8i', sans, 10));
  assert.equal(faces.length, 4);
  const snapshot = createModelSnapshotter();
  for (const face of faces) {
    const nativeFace = modelGeometry(face).value
      .shape as import('replicad').Face;
    const normal = nativeFace.normalAt();
    try {
      normal
        .toTuple()
        .forEach((value, index) => near(value, index === 1 ? 1 : 0));
    } finally {
      normal.delete();
    }
    const state = snapshot(face);
    assert.equal(state.operation.kind, 'text');
    assert.deepEqual(state.origin, [0, 0, 0]);
    const [minimum, maximum] = modelGeometry(face).value.localBounds;
    near(minimum[1], 0);
    near(maximum[1], 0);
    assert.ok(minimum[0] > 0);
    assert.ok(minimum[2] < -1);
  }
  const volumes = [
    20.3598876794, 18.3618485928, 4.913330078125, 1.022148132324,
  ];
  for (const distance of [1, -2]) {
    const solids = keepAll(extrude(faces, distance));
    solids.forEach((solid, index) => {
      near(volume(solid), volumes[index] * Math.abs(distance));
      const [min, max] = modelGeometry(solid).value.localBounds;
      near(min[1], Math.min(0, distance));
      near(max[1], Math.max(0, distance));
    });
    const assembly = keep(group(solids));
    assert.equal(snapshot(assembly).children.length, 4);
  }
  assert.deepEqual(extrude([], 1), []);
});

test('real OTF/CFF Chinese and Latin glyphs produce valid extrudable faces', () => {
  const chinese = font(chineseUrl);
  for (const content of ['B8i', '中文文字测试']) {
    const faces = keepAll(text(content, chinese, 10));
    assert.ok(faces.length >= content.length);
    for (const solid of keepAll(extrude(faces, 1)))
      assert.ok(volume(solid) > 0);
  }
});

test('font metrics retain spaces, scaling and immutable bytes; invalid input is diagnosed', () => {
  const bytes = new Uint8Array(readFileSync(latinUrl));
  const sans = font(bytes);
  bytes.fill(0);
  assert.equal(text('', sans, 10).length, 0);
  assert.equal(text('   ', sans, 10).length, 0);
  const normal = keepAll(text('B', sans, 10));
  const spaced = keepAll(text(' B', sans, 10));
  const scaled = keepAll(text('B', sans, 20));
  assert.ok(
    modelGeometry(spaced[0]).value.localBounds[0][0] >
      modelGeometry(normal[0]).value.localBounds[0][0] + 3,
  );
  const a = volume(keep(normal[0].extrude(1))),
    b = volume(keep(scaled[0].extrude(1)));
  near(b, a * 4);
  assert.throws(() => text('中', sans, 10), /U\+4E2D/);
  assert.throws(() => text('B\n8', sans, 10), /one line/);
  for (const size of [0, -1, NaN, Infinity])
    assert.throws(() => text('B', sans, size), /greater than zero/);
  assert.throws(() => font(bytes), /Cannot parse font/);
  assert.throws(
    () => font(new URL('https://example.com/font.ttf')),
    /prepared by the model engine/,
  );
});

function square(x: number, y: number, size: number): PathCommand[] {
  return [
    {type: 'M', x, y},
    {type: 'L', x: x + size, y},
    {type: 'L', x: x + size, y: y + size},
    {type: 'L', x, y: y + size},
    {type: 'Z'},
  ];
}
function permutations<T>(values: T[]): T[][] {
  return values.length
    ? values.flatMap((value, index) =>
        permutations(values.filter((_, i) => i !== index)).map(rest => [
          value,
          ...rest,
        ]),
      )
    : [[]];
}
test('text options apply font kerning and model-unit spacing to whole glyphs', () => {
  const sans = font(latinUrl);
  const left = (model: Model) => modelGeometry(model).value.localBounds[0][0];
  const kerned = keepAll(text('AV', sans, 10));
  const unkerned = keepAll(text('AV', sans, 10, {kerning: false}));
  const explicit = keepAll(text('AV', sans, 10, {kerning: true}));
  const defaults = keepAll(text('AV', sans, 10, {}));
  near(left(kerned[0]), left(unkerned[0]));
  // DejaVu Sans's Latin GPOS AV pair advances by -131 / 2048 em.
  near(left(unkerned[1]) - left(kerned[1]), (131 / 2048) * 10);
  kerned.forEach((face, index) => {
    near(left(face), left(explicit[index]));
    near(left(face), left(defaults[index]));
  });
  for (const size of [10, 20]) {
    const normal = keepAll(text('Ai i', sans, size));
    assert.equal(normal.length, 5);
    for (const letterSpacing of [-0.5, 2]) {
      const spaced = keepAll(text('Ai i', sans, size, {letterSpacing}));
      spaced.forEach((face, index) => {
        // Both disconnected parts of i move together; the space also advances.
        near(
          left(face) - left(normal[index]),
          [0, 1, 1, 3, 3][index] * letterSpacing,
        );
      });
    }
  }
  const spacedPair = keepAll(text('AV', sans, 10, {letterSpacing: 2}));
  near(left(spacedPair[1]) - left(kerned[1]), 2);
  for (const letterSpacing of [NaN, Infinity, -Infinity])
    assert.throws(
      () => text('A', sans, 10, {letterSpacing}),
      /letter spacing must be finite/,
    );
});

test('multi-hole workaround handles every contour order and nested islands', () => {
  for (const contours of permutations([
    square(0, 0, 10),
    square(1, 1, 2),
    square(6, 1, 2),
    square(1.5, 1.5, 1),
  ])) {
    const regions = groupTextContours(contours);
    assert.equal(regions.length, 2);
    let area = 0;
    for (const region of regions) {
      const face = textRegionFace(region, 0, 0);
      try {
        area += replicad.measureArea(face);
      } finally {
        face.delete();
      }
    }
    near(area, 93);
  }
  assert.throws(
    () => groupTextContours([square(0, 0, 3), square(2, 2, 3)]),
    /crossing or touching/,
  );
});

test('text solids work as embossing and engraving boolean operands', () => {
  const profiles = keepAll(text('B8i', font(latinUrl), 10));
  const stock = keep(keep(box(30, 2, 16)).originOffset(-12, 1, 4));
  const raisedTools = keepAll(extrude(profiles, 1));
  const raised = keep(union([stock, ...raisedTools]));
  near(
    volume(raised),
    volume(stock) + raisedTools.reduce((sum, solid) => sum + volume(solid), 0),
  );
  const engravedTools = keepAll(extrude(profiles, -1));
  const engraved = keep(cut(stock, engravedTools));
  near(
    volume(engraved),
    volume(stock) -
      engravedTools.reduce((sum, solid) => sum + volume(solid), 0),
  );
});

test('content identities reuse fonts and restore text geometry from persistent artifacts', () => {
  const entries = new Map<string, Uint8Array>();
  setKernelArtifactStore({
    get: id => entries.get(id),
    set: (id, bytes) => {
      entries.set(id, bytes);
    },
    touch: id => entries.has(id),
    delete: id => {
      entries.delete(id);
    },
    flush() {},
  });
  const build = () =>
    keepAll(extrude(keepAll(text('B8i', font(latinUrl), 10)), 1));
  const first = build();
  const ids = first.map(model => modelGeometry(model).id);
  const before = kernelOperationCacheStats();
  assert.ok(before.persistentWrites > 0);
  assert.equal(before.persistenceErrors, 0);
  assert.deepEqual(
    build().map(model => modelGeometry(model).id),
    ids,
  );
  assert.ok(kernelOperationCacheStats().hits > before.hits);
  disposeModelObjects(models.splice(0));
  clearKernelOperationCache();
  const restored = build();
  assert.deepEqual(
    restored.map(model => modelGeometry(model).id),
    ids,
  );
  assert.ok(kernelOperationCacheStats().persistentHits > 0);
  assert.equal(kernelOperationCacheStats().persistenceErrors, 0);
});

test('repeated text construction releases native temporaries after cache disposal', async () => {
  const {getOC} = await import('replicad');
  const kernel = getOC() as import('@code3d/opencascade').OpenCascadeInstance;
  const sans = font(latinUrl);
  const batch = () => {
    for (let i = 0; i < 10; i++) {
      const faces = text('B8i', sans, 10);
      disposeModelObjects(faces);
      clearKernelOperationCache();
    }
    return kernel.Code3dMemory.AllocatedBytes();
  };
  const warm = batch();
  const later = batch();
  assert.ok(later - warm < 64 * 1024, `${warm} -> ${later} native bytes`);
});
