import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {box, circle, cylinder, group, line, sphere} from '@code3d/core';
import {
  createModelSnapshotter,
  disposeModelObjects,
  retainModelGeometry,
} from '@code3d/core/tooling';
import * as replicad from 'replicad';
import {importSTEP} from 'replicad';
import {strFromU8, unzipSync} from 'fflate';
import {Group, Object3D} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {createAppTestServer} from './vite-test-server.mjs';
import {createTestProjectCompiler} from './project-test-files.mjs';

let server,
  exportModel,
  collectExportInstances,
  renderedModelName,
  compileProject,
  applyNodeTransform;
before(async () => {
  server = await createAppTestServer();
  const exporter = await server.ssrLoadModule('/src/model/model-export.ts');
  exportModel = (...args) => exporter.exportModel(...args, replicad);
  ({collectExportInstances, renderedModelName} = await server.ssrLoadModule(
    '/src/rendering/model-export-scene.ts',
  ));
  ({applyNodeTransform} = await server.ssrLoadModule(
    '/src/rendering/model-renderer.ts',
  ));
  compileProject = async (...args) => {
    const compiler = await createTestProjectCompiler(server);
    try {
      return await compiler.compile(...args);
    } finally {
      compiler.dispose();
    }
  };
});
after(async () => {
  await server?.close();
});

const defaults = {
  format: 'step',
  scale: 1,
  upAxis: 'y',
  tolerance: 0.1,
  angularTolerance: Math.PI / 18,
  binary: true,
};

function scene(snapshot) {
  const occurrences = [];
  function add(node, key, parent) {
    const object = new Object3D();
    applyNodeTransform(object, node, 'composition');
    parent.add(object);
    occurrences.push({key, node, object});
    node.children.forEach((child, i) => add(child, `${key}/${i}`, object));
  }
  add(snapshot, 'root', new Group());
  return occurrences;
}

function read3mf(bytes) {
  const archive = unzipSync(new Uint8Array(bytes));
  assert.deepEqual(Object.keys(archive).sort(), [
    '3D/3dmodel.model',
    '[Content_Types].xml',
    '_rels/.rels',
  ]);
  const model = strFromU8(archive['3D/3dmodel.model']);
  assert.match(model, /unit="millimeter"/);
  const meshes = [
    ...model.matchAll(
      /<mesh><vertices>(.*?)<\/vertices><triangles>(.*?)<\/triangles><\/mesh>/gs,
    ),
  ].map(([, vertices, triangles]) => ({
    vertices: [
      ...vertices.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g),
    ].map(match => match.slice(1).map(Number)),
    triangles: [
      ...triangles.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g),
    ].map(match => match.slice(1).map(Number)),
  }));
  return {model, meshes};
}

function closedMesh(mesh) {
  const edges = new Map();
  let volume = 0;
  for (const triangle of mesh.triangles) {
    assert.equal(new Set(triangle).size, 3);
    triangle.forEach(index =>
      assert.ok(index >= 0 && index < mesh.vertices.length),
    );
    for (let i = 0; i < 3; i++) {
      const a = triangle[i],
        b = triangle[(i + 1) % 3];
      const key = [Math.min(a, b), Math.max(a, b)].join(',');
      const edge = edges.get(key) ?? {count: 0, balance: 0};
      edge.count++;
      edge.balance += a < b ? 1 : -1;
      edges.set(key, edge);
    }
    const [a, b, c] = triangle.map(index => mesh.vertices[index]);
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  for (const edge of edges.values())
    assert.deepEqual(edge, {count: 2, balance: 0});
  assert.ok(volume > 0, 'triangles wind outwards');
}

test('project runtime retains export geometry and preserves STEP placements, names and colors', async () => {
  const compiler = await createTestProjectCompiler(server);
  const source = `import {box, group} from '@code3d/core';
const base = box(10, 20, 30).paint('#123456');
const top = box(2, 4, 6).relate(self => self.down.on(base.up));
export default group([base, top], 'Assembly');`;
  try {
    const module = await compiler.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    const snapshot = module.objects.get(module.exports.get('default'));
    const instances = collectExportInstances(scene(snapshot));
    assert.equal(instances.length, 2);
    const blob = compiler.export(instances, defaults);
    const text = await blob.text();
    assert.match(text, /ISO-10303-21/);
    assert.match(text, /COLOUR_RGB/);
    const imported = await importSTEP(blob);
    try {
      const bounds = imported.boundingBox;
      assert.deepEqual(
        bounds.bounds.map(point => point.map(value => Math.round(value))),
        [
          [-5, -10, -15],
          [5, 14, 15],
        ],
      );
      bounds.delete();
    } finally {
      imported.delete();
    }
    // Repeated exports do not consume retained geometry.
    assert.match(
      await compiler.export(instances, defaults).text(),
      /END-ISO-10303-21/,
    );
  } finally {
    compiler.dispose();
  }
});

test('project compilation carries recursive group colors into exported materials', async () => {
  const compiler = await createTestProjectCompiler(server);
  const source = `import {box, group} from '@code3d/core';
const base = box(10, 4, 10).paint('#ff0000');
const top = box(2, 2, 2).relate(self => self.down.on(base.up));
export default group([base, group([top]).paint('#00ff00')]).paint('#345678');`;
  try {
    const module = await compiler.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    const snapshot = module.objects.get(module.exports.get('default'));
    const instances = collectExportInstances(scene(snapshot));
    assert.deepEqual(
      instances.map(instance => instance.color),
      ['#345678', '#345678'],
    );
    const blob = compiler.export(instances, {...defaults, format: '3mf'});
    const {model, meshes} = read3mf(await blob.arrayBuffer());
    assert.equal(meshes.length, 2);
    const colors = [...model.matchAll(/displaycolor="([^"]+)"/g)].map(
      match => match[1],
    );
    assert.ok(colors.length > 0);
    assert.ok(colors.every(color => color === '#345678'));
  } finally {
    compiler.dispose();
  }
});

for (const mode of ['builtin', 'installed']) {
  test(`exports with the ${mode} project kernel across cached npm model edits and releases old geometry`, async () => {
    const compiler = await createTestProjectCompiler(server);
    let retained;
    let runtime;
    try {
      for (const count of [2, 3]) {
        const module = await compiler.compile(
          {
            files: [
              {
                path: '/package.json',
                source: JSON.stringify({
                  dependencies: {
                    'just-range': '4.2.0',
                    ...(mode === 'installed' ? {'@code3d/core': '*'} : {}),
                  },
                }),
              },
              {
                path: '/model.ts',
                source: `import range from 'just-range'; import {box, group} from '@code3d/core'; export default group(range(${count}).map(i => box(i + 1, 2, 3)));`,
              },
            ],
          },
          '/model.ts',
        );
        assert.equal(module.diagnostic, undefined);
        if (retained) assert.equal(retained.shapes.size, 0);
        retained = compiler.geometry;
        runtime ??= compiler.runtime;
        assert.equal(compiler.runtime, runtime);
        assert.notEqual(runtime.replicad.exportSTEP, replicad.exportSTEP);
        const instances = collectExportInstances(scene(module.fallback));
        assert.equal(instances.length, count);
        assert.throws(
          () => compiler.export(instances, {...defaults, scale: 0}),
          /Scale/,
        );
        assert.match(
          await compiler.export(instances, defaults).text(),
          /ISO-10303-21/,
        );
        const stl = await compiler
          .export(instances, {...defaults, format: 'stl'})
          .arrayBuffer();
        assert.equal(
          stl.byteLength,
          84 + new DataView(stl).getUint32(80, true) * 50,
        );
        const threeMf = read3mf(
          await compiler
            .export(instances, {...defaults, format: '3mf'})
            .arrayBuffer(),
        );
        assert.equal(threeMf.meshes.length, count);
        threeMf.meshes.forEach(closedMesh);
      }
      await assert.rejects(
        compiler.compile(
          {files: [{path: '/model.ts', source: 'import "missing-package";'}]},
          '/model.ts',
        ),
        /missing-package/,
      );
      assert.equal(retained.shapes.size, 0);
      assert.throws(() => compiler.export([], defaults), /model has changed/);
    } finally {
      compiler.dispose();
    }
  });
}

test('STL binary and ASCII encode rendered occurrences with scale and Z-up conversion', async () => {
  const model = box(2, 4, 6);
  const snapshot = createModelSnapshotter()(model);
  const geometry = retainModelGeometry([model]);
  disposeModelObjects([model]);
  const occurrences = scene(snapshot);
  occurrences[0].object.position.set(5, 7, 11);
  const instances = collectExportInstances(occurrences);
  try {
    for (const binary of [true, false]) {
      const blob = exportModel(geometry, instances, {
        ...defaults,
        format: 'stl',
        binary,
        scale: 2,
        upAxis: 'z',
      });
      const data = await blob.arrayBuffer();
      if (binary)
        assert.equal(
          data.byteLength,
          84 + new DataView(data).getUint32(80, true) * 50,
        );
      else assert.match(await blob.text(), /facet normal/);
      const mesh = new STLLoader().parse(data);
      mesh.computeBoundingBox();
      assert.deepEqual(
        mesh.boundingBox.min.toArray().map(Math.round),
        [8, -28, 10],
      );
      assert.deepEqual(
        mesh.boundingBox.max.toArray().map(Math.round),
        [12, -16, 18],
      );
      mesh.dispose();
    }
  } finally {
    geometry.dispose();
  }
});

test('STEP also supports profile and curve geometry', async () => {
  const models = [circle(3), line([0, 0, 0], [1, 2, 3])];
  const snapshot = createModelSnapshotter()(group(models));
  const geometry = retainModelGeometry(models);
  disposeModelObjects(models);
  try {
    const instances = collectExportInstances(scene(snapshot));
    const blob = exportModel(geometry, instances, defaults);
    const imported = await importSTEP(blob);
    const edges = imported.edges;
    try {
      assert.ok(edges.length > 0);
    } finally {
      edges.forEach(edge => edge.delete());
      imported.delete();
    }
    assert.throws(
      () => exportModel(geometry, instances, {...defaults, format: 'stl'}),
      /require solids/,
    );
  } finally {
    geometry.dispose();
  }
});

test('retained geometry shares one owned clone and can be released without consuming live models', () => {
  const model = box(2, 4, 6);
  const painted = model.paint('#f00');
  const snapshot = createModelSnapshotter()(group([model, painted]));
  const geometry = retainModelGeometry([model, painted]);
  const retained = snapshot.children.map(node =>
    geometry.shapes.get(node.nodeId),
  );
  assert.equal(retained[0], retained[1]);
  geometry.dispose();
  assert.equal(geometry.shapes.size, 0);
  assert.throws(() => retained[0].wrapped, /deleted/);
  assert.ok(createModelSnapshotter()(model).mesh.vertices.length > 0);
  disposeModelObjects([model, painted]);
});

test('3MF packages closed welded meshes, escaped names, materials and a fixed assembly', async () => {
  const models = [box(2, 4, 6).paint('#f00'), cylinder(2, 8)];
  const assembly = group(models, 'Assembly');
  const occurrences = scene(createModelSnapshotter()(assembly));
  const instances = collectExportInstances(occurrences).map((instance, i) => ({
    ...instance,
    name: i ? 'round' : 'Part & "one" <red>',
  }));
  const geometry = retainModelGeometry(models);
  disposeModelObjects([assembly]);
  try {
    const blob = exportModel(geometry, instances, {...defaults, format: '3mf'});
    const {model, meshes} = read3mf(await blob.arrayBuffer());
    assert.equal(meshes.length, 2);
    meshes.forEach(closedMesh);
    assert.equal(meshes[0].vertices.length, 8);
    assert.match(model, /Part &amp; &quot;one&quot; &lt;red&gt;/);
    assert.match(model, /displaycolor="#ff0000"/);
    assert.match(
      model,
      /<components><component objectid="1"\/><component objectid="3"\/><\/components>/,
    );
    assert.match(model, /<build><item objectid="5"\/><\/build>/);
  } finally {
    geometry.dispose();
  }
});

test('exports all foreground occurrences with their nested world transforms', () => {
  const model = box(2, 4, 6);
  const groupNode = group([model]);
  const root = group([groupNode, model]);
  const occurrences = scene(createModelSnapshotter()(root));
  occurrences[0].object.position.set(2, 3, 4);
  occurrences[1].object.position.set(5, 6, 7);
  const instances = collectExportInstances(occurrences);
  assert.equal(instances.length, 2);
  assert.deepEqual(instances[0].transform.position, [7, 9, 11]);
  assert.deepEqual(instances[1].transform.position, [2, 3, 4]);
  assert.deepEqual(collectExportInstances([]), []);
  disposeModelObjects([root]);
});

test('mesh precision changes curved tessellation while 3MF stays closed at seams and poles', async () => {
  const model = sphere(10);
  const geometry = retainModelGeometry([model]);
  const instances = collectExportInstances(
    scene(createModelSnapshotter()(model)),
  );
  disposeModelObjects([model]);
  try {
    const coarse = read3mf(
      await exportModel(geometry, instances, {
        ...defaults,
        format: '3mf',
        tolerance: 1,
        angularTolerance: 0.5,
      }).arrayBuffer(),
    ).meshes[0];
    const fine = read3mf(
      await exportModel(geometry, instances, {
        ...defaults,
        format: '3mf',
        tolerance: 0.01,
        angularTolerance: 0.1,
      }).arrayBuffer(),
    ).meshes[0];
    closedMesh(coarse);
    closedMesh(fine);
    assert.ok(fine.triangles.length > coarse.triangles.length);
  } finally {
    geometry.dispose();
  }
});

test('export file names retain Unicode and version suffixes while replacing format extensions', async () => {
  const {exportFileName} = await server.ssrLoadModule(
    '/src/ui/export-dialog.ts',
  );
  assert.equal(exportFileName('旋钮.v2.step', '3mf'), '旋钮.v2.3mf');
  assert.equal(exportFileName('model.ts', 'stl'), 'model.stl');
  assert.equal(exportFileName('part.v2', 'step'), 'part.v2.step');
  assert.equal(exportFileName('invalid/name', 'png'), 'invalid-name.png');
});

test('names rendered variables, aliases, collections and assemblies without guessing from their children', async () => {
  const source = `import {box, group} from '@code3d/core';
const plate = box(10, 20, 30);
const alias = plate;
const parts = [plate, box(2, 4, 6)];
const assembly = group(parts);
export default group([assembly]);`;
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  const binding = name =>
    module.catalog.find(
      entry => entry.category === 'binding' && entry.label === name,
    );
  for (const name of ['plate', 'alias', 'parts', 'assembly']) {
    const entry = binding(name);
    assert.equal(
      renderedModelName(module, entry.nodeIds, entry.sourceRef),
      name,
    );
  }
  assert.equal(
    renderedModelName(module, binding('assembly').nodeIds),
    'assembly',
  );
  assert.equal(
    renderedModelName(module, [module.fallback.nodeId]),
    'code3d-model',
  );
  assert.equal(renderedModelName(module, []), 'code3d-model');
});

test('names repeated local results and prefers the outer binding for a rendered function result', async () => {
  const source = `import {box} from '@code3d/core';
function makePart(size: number) { const part = box(size, 2, 3); return part; }
const pieces = [makePart(1), makePart(2)];
const plate = makePart(3);`;
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  const local = module.catalog.find(
    entry => entry.category === 'binding' && entry.label === 'part',
  );
  assert.ok(local.occurrences.length > 1);
  assert.equal(
    renderedModelName(module, [local.occurrences[1].nodeId]),
    'part',
  );
  assert.equal(renderedModelName(module, [module.fallback.nodeId]), 'plate');
  assert.equal(
    renderedModelName(module, [module.fallback.nodeId], local.sourceRef),
    'part',
  );
});

test('export rejects empty, stale, non-solid and invalid parameter requests', () => {
  const geometry = retainModelGeometry([]);
  const instance = {
    nodeId: 'missing',
    kind: 'solid',
    name: 'missing',
    transform: {position: [0, 0, 0], quaternion: [0, 0, 0, 1]},
  };
  assert.throws(() => exportModel(geometry, [], defaults), /no rendered model/);
  assert.throws(
    () => exportModel(geometry, [instance], defaults),
    /model has changed/,
  );
  assert.throws(
    () => exportModel(geometry, [instance], {...defaults, scale: 0}),
    /Scale/,
  );
  assert.throws(
    () =>
      exportModel(geometry, [{...instance, kind: 'face'}], {
        ...defaults,
        format: '3mf',
      }),
    /require solids/,
  );
  assert.throws(
    () =>
      exportModel(geometry, [instance], {
        ...defaults,
        format: 'stl',
        tolerance: NaN,
      }),
    /tolerances/,
  );
  geometry.dispose();
});
