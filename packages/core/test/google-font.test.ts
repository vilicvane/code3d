import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {afterEach, test} from 'node:test';
import {installModelResourceReader} from '../bld/library/font.js';
import {googleFontSources, googleFontUrl} from '../bld/library/google-font.js';
import {
  clearKernelOperationCache,
  kernelOperationCacheStats,
  setKernelArtifactStore,
} from '../bld/library/kernel-cache.js';
import {googleFont, text, type Model} from '../bld/node/index.js';
import {replicad} from '../bld/node/replicad.js';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';

const encoder = new TextEncoder();
const models: Model[] = [];
afterEach(() => {
  disposeModelObjects(models.splice(0));
  clearKernelOperationCache();
  setKernelArtifactStore(undefined);
  installModelResourceReader(url =>
    url.protocol === 'file:' ? readFileSync(url) : undefined,
  );
});
const keep = <T extends Model>(value: T): T => {
  models.push(value);
  return value;
};
const shape = (content: string, family: string, weight?: number) =>
  text(content, googleFont(family, {weight}), 10).map(keep);

test('Google requests omit unspecified axes and preserve explicit weight/style', () => {
  const family = (options?: Parameters<typeof googleFontUrl>[1]) =>
    googleFontUrl('Play', options).searchParams.get('family');
  assert.equal(family(), 'Play');
  assert.equal(family({weight: undefined}), 'Play');
  assert.equal(family({weight: 700}), 'Play:wght@700');
  assert.equal(family({italic: true}), 'Play:ital@1');
  assert.equal(family({weight: 450, italic: false}), 'Play:ital,wght@0,450');
  assert.equal(
    googleFontUrl('Noto Sans SC').searchParams.get('family'),
    'Noto Sans SC',
  );
  assert.throws(() => googleFontUrl(' '), /non-empty/);
  for (const weight of [0, NaN, Infinity, 1001])
    assert.throws(() => googleFontUrl('Play', {weight}), /weight/);
});

test('font-face parsing retains all subsets, Unicode ranges and CSS precedence', () => {
  const sources = googleFontSources(
    encoder.encode(`/* comment */
@font-face {src: url('https://fonts.example/greek.woff2') format('woff2'); unicode-range: U+0370-03FF;}
@font-face {src: url("https://fonts.example/latin.woff2"); unicode-range: U+00??, U+20AC;}`),
  );
  assert.deepEqual(sources, [
    {
      url: 'https://fonts.example/latin.woff2',
      ranges: [
        [0, 255],
        [0x20ac, 0x20ac],
      ],
    },
    {url: 'https://fonts.example/greek.woff2', ranges: [[0x370, 0x3ff]]},
  ]);
  assert.throws(
    () => googleFontSources(encoder.encode('<html>Error</html>')),
    /no font files/,
  );
  assert.throws(
    () =>
      googleFontSources(
        encoder.encode(
          '@font-face {src:url(https://fonts.example/a);unicode-range:U+110000;}',
        ),
      ),
    /Unicode range/,
  );
});

test('a font composed of subsets lays out mixed characters on one baseline', () => {
  const latin = readFileSync(
    new URL('../../app/examples/fonts/DejaVuSans.ttf', import.meta.url),
  );
  const chinese = readFileSync(
    new URL('./fonts/NotoSansCJK-subset.otf', import.meta.url),
  );
  const css =
    encoder.encode(`@font-face {src:url(https://fonts.example/latin.ttf);unicode-range:U+0000-00FF;}
@font-face {src:url(https://fonts.example/chinese.otf);unicode-range:U+4E00-9FFF;}`);
  installModelResourceReader(url =>
    url.hostname === 'fonts.googleapis.com'
      ? css
      : url.pathname === '/latin.ttf'
        ? latin
        : chinese,
  );
  const mixed = shape('B中8', 'Fixture');
  const latinOnly = shape('B8', 'Fixture');
  assert.equal(mixed.length, 3);
  const left = (model: Model) => modelGeometry(model).value.localBounds[0][0];
  assert.ok(left(mixed[0]) < left(mixed[1]));
  assert.ok(left(mixed[1]) < left(mixed[2]));
  assert.ok(Math.abs(left(mixed[2]) - left(latinOnly[1]) - 10) < 1e-7);
  for (const face of mixed)
    assert.ok(
      replicad.measureVolume(
        modelGeometry(keep(face.extrude(1))).value.shape.asShape3D(),
      ) > 0,
    );
});

test('variable weights change contours and advances and restore independently from disk', () => {
  const bytes = readFileSync(
    new URL('./fonts/Roboto-variable-subset.ttf', import.meta.url),
  );
  const css = encoder.encode(
    '@font-face {src:url(https://fonts.example/variable.ttf);}',
  );
  installModelResourceReader(url =>
    url.hostname === 'fonts.googleapis.com' ? css : bytes,
  );
  const disk = new Map<string, Uint8Array>();
  setKernelArtifactStore({
    get: key => disk.get(key),
    set: (key, value) => {
      disk.set(key, value);
    },
    touch: key => disk.has(key),
    getMany(ids: readonly string[]) {
      return ids.map(id => this.get(id));
    },
    touchMany: (ids: readonly string[]) => ids.map(id => disk.has(id)),
    delete: key => {
      disk.delete(key);
    },
    flush() {},
  });
  const signatures = new Map<number, string>();
  for (const weight of [400, 450, 700]) {
    const faces = shape('AVB8i', 'Roboto', weight);
    for (const face of faces) {
      const solid = keep(face.extrude(1));
      const mesh = createModelSnapshotter()(solid).mesh!;
      assert.ok(mesh.vertices.length > 0);
      assert.ok(mesh.uvs?.every(Number.isFinite));
    }
    signatures.set(
      weight,
      JSON.stringify(faces.map(face => modelGeometry(face).value.localBounds)),
    );
  }
  assert.equal(new Set(signatures.values()).size, 3);
  clearKernelOperationCache();
  for (const weight of [700, 450, 400]) {
    const faces = shape('AVB8i', 'Roboto', weight);
    assert.equal(
      JSON.stringify(faces.map(face => modelGeometry(face).value.localBounds)),
      signatures.get(weight),
    );
  }
  assert.ok(kernelOperationCacheStats().persistentHits > 0);
});
