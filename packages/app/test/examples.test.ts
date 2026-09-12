import {replicad} from '@code3d/core/replicad';
import {modelGeometry} from '../../core/test/model-test.ts';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {after, before, test} from 'node:test';
import {
  installModelResourceReader,
  modelElementReference,
  googleFontUrl,
  googleFontSources,
  isSketch,
  snapshotSketch,
  isModelObject,
  createModelSnapshotter,
  disposeModelObjects,
  type ModelObject,
  type ModelSnapshotObject,
} from '@code3d/core/tooling';
import {
  exampleEntries,
  movedExamplePaths,
  renderSamples,
  sourceContextSets,
} from '../render-samples/catalog.ts';
import {sourceTokenOffset} from '../render-samples/source-focus.ts';

const expectedSolids: Record<string, readonly [string, number]> = {
  'projects/phone-stand.ts': ['default', 1],
  'assemblies/screw-box/model.ts': ['default', 6],
  'assemblies/screw-box/box.ts': ['default', 1],
  'assemblies/screw-box/lid.ts': ['default', 1],
  'operations/cut.ts': ['default', 1],
  'operations/union.ts': ['default', 1],
  'constraints/combined-constraints.ts': ['default', 2],
  'constraints/transformations.ts': ['default', 2],
  'operations/group.ts': ['default', 2],
  'materials.ts': ['plain', 1],
  'text.ts': ['lettering', 4],
  'operations/rotate.ts': ['default', 1],
  'operations/origin.ts': ['centered', 1],
  'primitives/primitives.ts': ['cuboid', 1],
  'constraints/relate.ts': ['default', 2],
  'topology-paths.ts': ['default', 1],
  'operations/loft.ts': ['default', 1],
  'operations/intersect.ts': ['default', 1],
  'operations/shell.ts': ['default', 1],
  'annotations.ts': ['default', 1],
  'expose.ts': ['model', 3],
  'primitives/custom-primitives.ts': ['customPrimitivesExample', 3],
  'npm/model.ts': ['default', 5],
  'projects/desktop-controller/enclosure.ts': ['default', 1],
  'projects/desktop-controller/panel.ts': ['default', 5],
  'projects/desktop-controller/model.ts': ['default', 17],
  'sketches/mounting-plate.ts': ['default', 1],
  'sketches/regions.ts': ['default', 1],
  'sketches/constraints.ts': ['default', 1],
};
const volume = (model: Parameters<typeof modelGeometry>[0]) =>
  replicad.measureVolume(modelGeometry(model).value.shape.asShape3D());

const retained: ModelObject[] = [];
// Imported components share one native module graph. Release that graph once,
// after all its consumers, rather than deleting a component before its assembly.
after(() => disposeModelObjects(retained));
const root = new URL('../examples/', import.meta.url);

test('every example source is registered and every website context resolves uniquely', async () => {
  const sources = (await readdir(root, {recursive: true}))
    .filter(
      file =>
        file.endsWith('.ts') &&
        !file.includes('node_modules/') &&
        !file.includes('.code3d/'),
    )
    .sort();
  assert.deepEqual(sources, exampleEntries.map(entry => entry.file).sort());
  assert.equal(
    new Set(exampleEntries.map(entry => entry.file)).size,
    exampleEntries.length,
  );
  const readme = await readFile(
    new URL('../../../README.md', import.meta.url),
    'utf8',
  );
  assert.equal(
    readme.match(/```ts\n([\s\S]*?)```/)![1],
    await readFile(new URL('annotations.ts', root), 'utf8'),
    'README uses the canonical annotations source',
  );
  for (const path of Object.values(movedExamplePaths))
    assert.ok(
      exampleEntries.some(entry => '/examples/' + entry.file === path),
      'Old public links resolve to a current example',
    );
  for (const sample of renderSamples) {
    assert.ok(exampleEntries.some(entry => entry.file === sample.file));
    const source = await readFile(new URL(sample.file, root), 'utf8');
    sourceTokenOffset(source, sample.focus);
    for (const context of sourceContextSets[sample.id] ?? [])
      sourceTokenOffset(source, context.focus);
  }
});

function validateGeometry(node: ModelSnapshotObject): number {
  let solids = node.kind === 'solid' ? 1 : 0;
  if (node.kind === 'solid' || node.kind === 'face') {
    assert.ok(
      node.mesh && node.mesh.triangles.length >= 3,
      `${node.name}: tessellated ${node.kind}`,
    );
    assert.ok(
      node.mesh.vertices.every(Number.isFinite),
      `${node.name}: finite coordinates`,
    );
  }
  if (node.kind === 'edge') {
    assert.ok(
      node.mesh && node.mesh.edges.length >= 6,
      `${node.name}: visible curve`,
    );
    assert.ok(node.mesh.edges.every(Number.isFinite));
  }
  if (node.kind === 'vertex') {
    assert.ok(
      node.mesh && node.mesh.topologyVertices.length >= 3,
      `${node.name}: visible point`,
    );
    assert.ok(node.mesh.topologyVertices.every(Number.isFinite));
  }
  for (const child of node.children) solids += validateGeometry(child);
  return solids;
}

for (const entry of exampleEntries) {
  test(`example: ${entry.file} exports real geometry and its teaching presets run`, async () => {
    const exports = await import(new URL(entry.file, root).href);
    const values = Object.values(exports).flat().filter(isModelObject);
    const sketches = Object.values(exports).filter(isSketch);
    assert.ok(
      values.length + sketches.length > 0,
      'At least one inspectable model or sketch',
    );
    for (const sketch of sketches) {
      const snapshot = snapshotSketch(sketch, () => 'example');
      for (const entity of snapshot.entities) {
        if (entity.kind === 'point')
          assert.ok(entity.position.every(Number.isFinite));
      }
    }
    const source = await readFile(new URL(entry.file, root), 'utf8');
    // Presets are the same JSON arrays the Arguments UI consumes, attached to
    // the immediately following exported function (never duplicated fixtures).
    for (const match of source.matchAll(
      /\/\*\*([\s\S]*?)\*\/\s*export function (\w+)/g,
    )) {
      for (const preset of match[1].matchAll(
        /@code3d.arguments\s+(\[[^\n]*\])/g,
      )) {
        const value = exports[match[2]](...JSON.parse(preset[1]));
        if (isSketch(value)) {
          sketches.push(value);
          // The slot presets must remain closed profiles that can be extruded.
          const solid = value.face().extrude(1);
          assert.ok(isModelObject(solid));
          values.push(solid);
        } else {
          assert.ok(isModelObject(value));
          values.push(value);
        }
      }
    }
    try {
      const snapshot = createModelSnapshotter();
      for (const value of values) validateGeometry(snapshot(value));
      const expected = expectedSolids[entry.file];
      assert.ok(
        expected,
        'Every example has a purpose-specific geometry assertion',
      );
      assert.equal(
        validateGeometry(snapshot(exports[expected[0]])),
        expected[1],
      );
      if (entry.file === 'operations/union.ts') {
        assert.ok(
          Math.abs(volume(exports.default) - (30 * 8 * 20 + Math.PI * 25 * 8)) <
            1e-5,
          'The boss overlaps the base by 2 mm',
        );
      }
      if (entry.file === 'operations/cut.ts') {
        assert.ok(
          Math.abs(volume(exports.default) - (30 * 8 * 20 - Math.PI * 16 * 8)) <
            1e-5,
        );
      }
      if (entry.file === 'primitives/primitives.ts') {
        const kinds = values.map(value => snapshot(value).kind);
        assert.equal(kinds.filter(kind => kind === 'solid').length, 7);
        assert.equal(kinds.filter(kind => kind === 'face').length, 4);
        assert.equal(kinds.filter(kind => kind === 'edge').length, 4);
        assert.equal(kinds.filter(kind => kind === 'vertex').length, 1);
      }
      if (entry.file === 'assemblies/screw-box/lid.ts') {
        const lid = snapshot(exports.default);
        const ys = lid.mesh!.vertices.filter((_, index) => index % 3 === 1);
        const bottom = Math.min(...ys);
        assert.ok(Math.abs(Math.max(...ys) - bottom - 8) < 1e-5);
        for (const name of [
          'frontLeft',
          'backLeft',
          'frontRight',
          'backRight',
        ]) {
          const seat = modelElementReference(
            exports.default[name].counterboreBottom,
          )!;
          assert.ok(
            Math.abs(seat.transform.position[1] - bottom - 3.5) < 1e-5,
            'Each screw head rests on 3.5 mm of lid material',
          );
        }
      }
      if (entry.file === 'assemblies/screw-box/model.ts') {
        for (const gap of [0, 14]) {
          const model = exports.screwBox(gap);
          values.push(model);
          const children = snapshot(model).children;
          assert.equal(validateGeometry(snapshot(model)), 6);
          assert.ok(
            Math.abs(children[1].compositionTransform.position[1] - 16 - gap) <
              1e-5,
          );
          for (const screw of children.slice(2)) {
            const [x, , z] = screw.compositionTransform.position;
            assert.ok(
              Math.abs(Math.abs(x) - 34) < 1e-5,
              'Screw and pilot X agree',
            );
            assert.ok(
              Math.abs(Math.abs(z) - 24) < 1e-5,
              'Screw and pilot Z agree',
            );
          }
        }
      }
      if (entry.file === 'projects/desktop-controller/model.ts') {
        const children = snapshot(exports.default).children;
        const near = (actual: readonly number[], expected: readonly number[]) =>
          assert.ok(
            actual.every((value, i) => Math.abs(value - expected[i]) < 1e-5),
          );
        near(children[1].compositionTransform.position, [0, 15.5, 0]);
        near(children[2].compositionTransform.position, [-20, 22, 0]);
      }
      if (entry.file === 'projects/phone-stand.ts') {
        for (const args of [
          [45, 15],
          [100, 30],
        ]) {
          const value = exports.phoneStand(...args);
          values.push(value);
          assert.equal(
            validateGeometry(snapshot(value)),
            1,
            'A continuous one-piece stand',
          );
          const shape = modelGeometry(value).value.shape.asShape3D();
          const planes: number[][] = [];
          for (const face of shape.faces) {
            try {
              if (face.geomType !== 'PLANE') continue;
              const normal = face.normalAt();
              try {
                planes.push(normal.toTuple());
              } finally {
                normal.delete();
              }
            } finally {
              face.delete();
            }
          }
          const angle = (args[1] * Math.PI) / 180;
          for (const sign of [-1, 1])
            assert.ok(
              planes.some(
                n =>
                  sign * (n[1] * Math.sin(angle) + n[2] * Math.cos(angle)) >
                  1 - 1e-6,
              ),
              'Both back surfaces have the authored lean angle',
            );
          const [min, max] = shape.boundingBox.bounds;
          assert.ok(
            Math.abs(max[0] - min[0] - args[0]) < 1e-5,
            'Authored width',
          );
          assert.ok(Math.abs(max[1] - min[1] - 75) < 1e-5, 'Full-height back');
          assert.ok(
            volume(value) > 10000,
            'A substantial supporting body remains',
          );
        }
      }
      if (entry.file === 'text.ts') {
        assert.equal(
          snapshot(exports.lettering).children.length,
          4,
          'B8i retains the dot and independent glyphs',
        );
        assert.equal(snapshot(exports.raised).kind, 'solid');
        assert.equal(snapshot(exports.engraved).kind, 'solid');
        assert.ok(
          volume(exports.raised) > 26 * 2 * 14,
          'Raised letters add material',
        );
        assert.ok(
          volume(exports.engraved) < 26 * 2 * 14,
          'Engraving removes material',
        );
      }
      if (entry.file === 'sketches/mounting-plate.ts') {
        assert.equal(snapshot(exports.mountingPlate).kind, 'solid');
        assert.equal(snapshot(exports.cutter).kind, 'solid');
        const slotVolume = 6 * (28 * 8 + Math.PI * 4 ** 2);
        assert.ok(
          Math.abs(
            volume(exports.stock) - volume(exports.mountingPlate) - slotVolume,
          ) < 1e-4,
          'The full rounded slot passes through the plate',
        );
      }
    } finally {
      retained.push(...values);
    }
  });
}

// Node author imports are synchronous; load the same public font before execution.
before(async () => {
  const resources = new Map<string, Uint8Array>();
  async function load(url: string) {
    const response = await fetch(url, {signal: AbortSignal.timeout(30_000)});
    assert.equal(response.ok, true, `Font resource is reachable: ${url}`);
    let bytes = new Uint8Array(await response.arrayBuffer());
    if (new DataView(bytes.buffer).getUint32(0) === 0x774f4632) {
      const {default: decompress} = await import('woff2-encoder/decompress');
      bytes = Uint8Array.from(await decompress(bytes));
    }
    resources.set(url, bytes);
    return bytes;
  }
  const url = googleFontUrl('Play').href;
  const css = await load(url);
  await Promise.all(googleFontSources(css).map(source => load(source.url)));
  installModelResourceReader(url => resources.get(url.href));
});
