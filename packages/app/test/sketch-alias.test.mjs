import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestProjectCompiler} from './project-test-files.ts';

let server,
  compiler,
  analyzeSketchSource,
  SketchEditResolver,
  deleteSketchEntity;
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestProjectCompiler(server);
  ({analyzeSketchSource, SketchEditResolver} = await server.ssrLoadModule(
    '/src/tools/sketch-source.ts',
  ));
  ({deleteSketchEntity} = await server.ssrLoadModule(
    '/src/tools/sketch-segments.ts',
  ));
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

async function compile(source, engine = compiler) {
  const module = await engine.compile(
    {
      files: [
        {
          path: '/model.ts',
          source: "import {sketch} from '@code3d/core';\n" + source,
        },
      ],
    },
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  return [...module.sketches.values()];
}
function drag(layers, args, id, position, target) {
  const local = layers.at(-1);
  return compiler.previewSketchDrag(layers, {
    id,
    position,
    mergeTarget: target,
    data: local.data,
    editable: analyzeSketchSource(args).editable,
  });
}
function apply(local, args, preview) {
  const resolution = new SketchEditResolver().resolve(
    {
      kind: 'sketch.edit',
      sourceRef: {file: '/model.ts', start: 0, end: args.length},
      expectedText: args,
      layer: local.id,
      references: local.references,
      change: {
        kind: 'move',
        data: preview.data.filter(e =>
          analyzeSketchSource(args).editable.get(e.id)?.some(Boolean),
        ),
        merge: preview.merge,
      },
    },
    {
      toolId: 'test',
      baseVersion: 1,
      resolveSourceRef: ref => ref,
      readSource: ref => args.slice(ref.start, ref.end),
    },
  );
  assert.equal(resolution.status, 'ready');
  return resolution.plan.edits[0].text;
}

test('drag merge preserves the old ID and replays exactly through a fresh compiler', async () => {
  const args =
    "[['point', 1, [0, 0]], ['point', 2, [10, 0]], ['point', 11, [0, 5]], ['line', 3, [11, 2]]]";
  const [local] = await compile('const s = sketch(' + args + ');');
  const preview = drag([local], args, 11, [0, 0], {layer: local.id, id: 1});
  assert.deepEqual(preview.merge, {
    id: 11,
    target: {layer: local.id, id: 1},
    deleted: {ids: [], constraints: []},
  });
  const source = apply(local, args, preview);
  assert.match(source, /\['point', 11, 1\]/);
  assert.match(source, /\['line', 3, \[11, 2\]\]/);
  assert.equal(analyzeSketchSource(source).reason, undefined);
  const fresh = await createTestProjectCompiler(server);
  try {
    const [replay] = await compile('const s = sketch(' + source + ');', fresh);
    assert.deepEqual(replay.entities, preview.snapshot.entities);
    assert.equal(
      replay.data.some(e => e.id === 11),
      false,
    );
    const next = drag([replay], source, 11, [3, 4]);
    assert.deepEqual(
      next.snapshot.entities.find(e => e.id === 11).position,
      next.snapshot.entities.find(e => e.id === 1).position,
    );
    assert.equal(
      next.data.some(e => e.id === 11),
      false,
    );
    const same = drag([replay], source, 11, [0, 0], {layer: replay.id, id: 1});
    assert.equal(same.merge, undefined);
  } finally {
    fresh.dispose();
  }
});

test('merging into a named ancestor emits a reference and retains upstream coordinates', async () => {
  const args =
    "[['point', 11, [0, 5]], ['point', 2, [10, 0]], ['line', 3, [11, 2]]]";
  const prefix = "const base = sketch([['point', 1, [0, 0]]]);\n";
  const layers = await compile(prefix + 'const s = base.derive(' + args + ');');
  const local = layers.at(-1);
  const preview = drag(layers, args, 11, [0, 0], {layer: layers[0].id, id: 1});
  const source = apply(local, args, preview);
  assert.match(source, /\['point', 11, base.point\(1\)\]/);
  const replay = (
    await compile(prefix + 'const s = base.derive(' + source + ');')
  ).at(-1);
  assert.deepEqual(replay.entities, preview.snapshot.entities);
});

test('merging connected endpoints keeps both point IDs and removes the collapsed line', async () => {
  const args =
    "[['point', 1, [0, 0]], ['point', 2, [10, 0]], ['line', 3, [1, 2]]]";
  const [local] = await compile('const s = sketch(' + args + ');');
  const preview = drag([local], args, 2, [0, 0], {layer: local.id, id: 1});
  assert.deepEqual(
    preview.snapshot.entities.map(e => e.id),
    [1, 2],
  );
  const source = apply(local, args, preview);
  assert.match(source, /\['point', 2, 1\]/);
  assert.doesNotMatch(source, /'line'/);
  const [replay] = await compile('const s = sketch(' + source + ');');
  assert.deepEqual(replay.entities, preview.snapshot.entities);
});

test('invalid merges reject atomically instead of moving a fixed point or replacing an expression', async () => {
  for (const {args, prefix = '', pattern} of [
    {
      args: "[['point', 1, [0, 0]], ['point', 2, [10, 0]]], {constraints: [['fixed', 2]]}",
      pattern: /fixed point/,
    },
    {
      args: "[['point', 1, [0, 0]], ['point', 2, [width, 0]]]",
      prefix: 'const width = 10;',
      pattern: /editable coordinate literals/,
    },
  ]) {
    const [local] = await compile(prefix + 'const s = sketch(' + args + ');');
    const original = structuredClone(local.entities);
    assert.throws(
      () => drag([local], args, 2, [0, 0], {layer: local.id, id: 1}),
      pattern,
    );
    assert.deepEqual(local.entities, original);
  }
});

test('deleting an owner removes dependent aliases and curves, while deleting an alias retains other users', async () => {
  const [local] = await compile(
    "const s = sketch([['point', 1, [0, 0]], ['point', 10, 1], ['point', 11, 10], ['point', 2, [10, 0]], ['line', 3, [11, 2]], ['line', 4, [1, 2]]]);",
  );
  assert.deepEqual(
    new Set(deleteSketchEntity([local], 1).ids),
    new Set([1, 10, 11, 2, 3, 4]),
  );
  const removed = deleteSketchEntity([local], 11).ids;
  assert.ok(removed.includes(3));
  assert.ok(!removed.includes(1));
  assert.ok(!removed.includes(4));
});

test('arc endpoint grid coordinates are exact in source and after compilation', async () => {
  const args =
    "[['point', 1, [0, 0]], ['point', 2, [-15, 0]], ['point', 3, [0, 15]], ['arc', 4, [1, r, 2, 3, 'cw']]]";
  const [local] = await compile(
    'const r = 15; const s = sketch(' + args + ');',
  );
  const preview = drag([local], args, 3, [15, 0]);
  const source = apply(local, args, preview);
  assert.match(source, /\['point', 3, \[15, 0\]\]/);
  assert.match(source, /\[1, r, 2, 3, 'cw'\]/);
  const [replay] = await compile(
    'const r = 15; const s = sketch(' + source + ');',
  );
  assert.deepEqual(replay.entities, preview.snapshot.entities);
});

test('the reported two-arc near-origin case merges endpoints with radius expressions preserved', async () => {
  const args = `[
    ['point', 1, [1.04796726852e-12, 6.10622663544e-16]],
    ['point', 2, [-15, 1.28142451723e-12]],
    ['point', 3, [1.22717593056e-13, 15]],
    ['arc', 4, [1, r, 2, 3, 'cw']],
    ['point', 5, [-0.644688728775, -6.87608143152]],
    ['arc', 6, [5, 6.90623771745, 10, 11, 'cw']],
    ['point', 10, [4.26813525406, -11.7299747064]],
    ['point', 11, [1.04802312469e-12, -6.07862988845e-17]],
  ]`;
  const [local] = await compile(
    'const r = 15; const s = sketch(' + args + ');',
  );
  const target = local.entities.find(e => e.id === 1).position;
  const preview = drag([local], args, 11, target, {layer: local.id, id: 1});
  const source = apply(local, args, preview);
  assert.match(source, /\['point', 11, 1\]/);
  assert.match(source, /\[1, r, 2, 3, 'cw'\]/);
  const [replay] = await compile(
    'const r = 15; const s = sketch(' + source + ');',
  );
  assert.deepEqual(replay.entities, preview.snapshot.entities);
  assert.deepEqual(
    replay.entities.find(e => e.id === 11).position,
    replay.entities.find(e => e.id === 1).position,
  );
});

for (const upstream of [false, true]) {
  test(`point merge removes every collapsed alias-connected line and only its constraints (upstream=${upstream})`, async () => {
    const prefix = upstream
      ? "const base = sketch([['point', 1, [0, 0]]]);\n"
      : '';
    const args = `[
      ['point', 1, ${upstream ? 'base.point(1)' : '[0, 0]'}],
      ['point', 2, [10, 0]], ['point', 12, 2],
      ['point', 4, [0, 10]], ['point', 5, [10, 10]],
      ['line', 3, [1, 2]], ['line', 13, [12, 1]],
      ['line', 6, [4, 5]],
    ], {constraints: [
      ['horizontal', 3], ['length', 3, 10], ['angle', 13, 180],
      ['horizontal', 6], ['length', 6, width], ['fixed', 1],
    ]}`;
    const layers = await compile(
      'const width = 10; ' +
        prefix +
        `const s = ${upstream ? 'base.derive' : 'sketch'}(${args});`,
    );
    const local = layers.at(-1);
    const before = structuredClone(layers);
    const preview = drag(layers, args, 12, [0, 0], {
      layer: layers[0].id,
      id: 1,
    });
    assert.deepEqual(preview.merge.deleted, {
      ids: [3, 13],
      constraints: [0, 1, 2],
    });
    assert.equal(preview.merge.id, 2);
    assert.deepEqual(
      preview.snapshot.entities.map(e => e.id),
      [1, 2, 12, 4, 5, 6],
    );
    const source = apply(local, args, preview);
    assert.match(source, /\['point', 12, 2\]/);
    assert.doesNotMatch(source, /\['line', (3|13),/);
    assert.doesNotMatch(source, /\['(horizontal|length|angle)', (3|13),?/);
    assert.match(source, /\['length', 6, width\]/);
    const replay = await compile(
      'const width = 10; ' +
        prefix +
        `const s = ${upstream ? 'base.derive' : 'sketch'}(${source});`,
    );
    assert.deepEqual(replay.at(-1).entities, preview.snapshot.entities);
    assert.deepEqual(replay.at(-1).constraints, preview.snapshot.constraints);
    assert.deepEqual(layers, before);
  });
}

test('removing a collapsed line keeps gesture-start incidences on subsequent surviving curves', async () => {
  const args = `[
    ['point',1,[0,0]], ['point',2,[10,0]], ['line',3,[1,2]],
    ['point',4,[0,10]], ['point',5,[20,10]], ['line',6,[4,5]],
    ['point',7,[10,10]],
  ]`;
  const [local] = await compile(`const s = sketch(${args});`);
  const preview = drag([local], args, 2, [0, 0], {layer: local.id, id: 1});
  assert.deepEqual(preview.merge.deleted.ids, [3]);
  const source = apply(local, args, preview);
  const [replay] = await compile(`const s = sketch(${source});`);
  assert.deepEqual(replay.entities, preview.snapshot.entities);
  assert.deepEqual(replay.entities.find(e => e.id === 7).position, [10, 10]);
});

test('snapping a circle center carries its attached points before establishing the alias', async () => {
  const args = `[
    ['point',1,[7,5]], ['point',2,[0,0]], ['circle',3,[2,10]],
    ['point',4,[10,0]],
  ]`;
  const [local] = await compile(`const s = sketch(${args});`);
  const preview = drag([local], args, 2, [7, 5], {layer: local.id, id: 1});
  assert.deepEqual(
    preview.snapshot.entities.find(e => e.id === 4).position,
    [17, 5],
  );
  const source = apply(local, args, preview);
  const [replay] = await compile(`const s = sketch(${source});`);
  assert.deepEqual(replay.entities, preview.snapshot.entities);
});
