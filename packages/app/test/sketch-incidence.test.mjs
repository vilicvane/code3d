import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestProjectCompiler} from './project-test-files.ts';
import {trimmedArcSketchArguments} from './sketch-fixtures.ts';

let server, compiler, analyzeSketchSource, SketchEditResolver;
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestProjectCompiler(server);
  ({analyzeSketchSource, SketchEditResolver} = await server.ssrLoadModule(
    '/src/tools/sketch-source.ts',
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
function drag(layers, args, id, position, previous) {
  return compiler.previewSketchDrag(
    previous ? [...layers.slice(0, -1), previous.snapshot] : layers,
    {
      id,
      position,
      reference: previous?.reference,
      data: previous?.data ?? layers.at(-1).data,
      editable: analyzeSketchSource(args).editable,
    },
  );
}
function apply(local, args, preview) {
  const resolution = new SketchEditResolver().resolve(
    {
      kind: 'sketch.edit',
      sourceRef: local.definitionRef,
      expectedText: args,
      layer: local.id,
      references: local.references,
      change: {
        kind: 'move',
        data: preview.data.filter(e =>
          analyzeSketchSource(args).editable.get(e.id)?.some(Boolean),
        ),
      },
    },
    {
      toolId: 'test',
      baseVersion: 1,
      resolveSourceRef: ref => ref,
      readSource: () => args,
    },
  );
  assert.equal(resolution.status, 'ready');
  return resolution.plan.edits[0].text;
}
const position = (s, id) => s.entities.find(e => e.id === id).position;
const online = (s, id = 4) => {
  const p = position(s, id),
    a = position(s, 1),
    b = position(s, 2);
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  assert.ok(Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) < 1e-6);
};
const entries =
  "[['point', 1, [0, 0]], ['point', 2, [20, 0]], ['line', 3, [1, 2]], ['point', 4, [10, 0]]]";

test('fixed-neighbor center dragging keeps exact coordinates through staged preview and fresh source replay', async () => {
  const args = trimmedArcSketchArguments(10, 5, 4);
  const [local] = await compile('const s=sketch(' + args + ');');
  let preview;
  for (const target of [
    [0, 15],
    [-2, 7],
    [-5, 8],
    [-7.5, 10],
  ]) {
    preview = drag([local], args, 10, target, preview);
    for (const id of [5, 13]) {
      assert.equal(position(preview.snapshot, id)[1], target[1]);
      assert.equal(
        preview.data.find(p => p.id === id).parameters[1],
        target[1],
      );
    }
    assert.deepEqual(position(preview.snapshot, 4), [20, 5]);
    const source = apply(local, args, preview);
    const fresh = await createTestProjectCompiler(server);
    try {
      const [replay] = await compile('const s=sketch(' + source + ');', fresh);
      assert.deepEqual(replay.entities, preview.snapshot.entities);
      assert.deepEqual(replay.data, preview.data);
    } finally {
      fresh.dispose();
    }
  }
});

test('staged connected-center dragging preserves shape through continuous preview and fresh source replay into extrusion', async () => {
  let args = trimmedArcSketchArguments(10);
  const source = () => 'const s = sketch(' + args + ');\ns.face().extrude(10);';
  let [local] = await compile(source());
  const before = local.entities;
  const verify = (snapshot, y) => {
    for (const [id, x] of [
      [10, 0],
      [13, -10],
      [15, 10],
      [4, 20],
      [5, -20],
    ])
      assert.deepEqual(position(snapshot, id), [x, y]);
    assert.deepEqual(position(snapshot, 2), [-20, -10]);
    assert.deepEqual(position(snapshot, 3), [20, -10]);
    assert.equal(snapshot.entities.find(e => e.id === 11).radius, 10);
    assert.equal(snapshot.entities.find(e => e.id === 16).radius, 2.5);
    assert.deepEqual(snapshot.constraints, local.constraints);
  };
  let continuous;
  for (const y of [15, 7, 10]) {
    continuous = drag([local], args, 10, [0, y], continuous);
    verify(continuous.snapshot, y);
  }
  assert.deepEqual(continuous.snapshot.entities, before);
  for (const y of [15, 7, 10]) {
    const preview = drag([local], args, 10, [0, y]);
    args = apply(local, args, preview);
    assert.doesNotMatch(args, /'fixed'|'radius'|'sweep'/);
    const fresh = await createTestProjectCompiler(server);
    try {
      [local] = await compile(source(), fresh);
      assert.deepEqual(local.entities, preview.snapshot.entities);
      verify(local, y);
    } finally {
      fresh.dispose();
    }
  }
  assert.deepEqual(local.entities, before);
});

test('returning a trimmed arc endpoint keeps the opposite horizontal coordinate exact through source replay', async () => {
  let args = trimmedArcSketchArguments();
  let [local] = await compile('const s = sketch(' + args + ');');
  const initial = local.entities;
  let continuous;
  for (const x of [8, 9, 7.5]) {
    continuous = drag([local], args, 15, [x, 10], continuous);
    assert.deepEqual(position(continuous.snapshot, 13), [-x, 10]);
  }
  assert.deepEqual(continuous.snapshot.entities, initial);
  for (const x of [8, 7.5, 10, 7.5]) {
    const preview = drag([local], args, 15, [x, 10]);
    assert.deepEqual(position(preview.snapshot, 13), [-x, 10]);
    assert.deepEqual(position(preview.snapshot, 15), [x, 10]);
    args = apply(local, args, preview);
    assert.ok(args.includes(`['point', 13, [-${x}, 10]]`));
    const fresh = await createTestProjectCompiler(server);
    try {
      [local] = await compile('const s = sketch(' + args + ');', fresh);
      assert.deepEqual(local.entities, preview.snapshot.entities);
    } finally {
      fresh.dispose();
    }
    if (x === 7.5) assert.deepEqual(local.entities, initial);
  }
});

test('unconstrained point-on-line motion writes actual data and replays exactly in a fresh compiler', async () => {
  const [local] = await compile('const s = sketch(' + entries + ');');
  let preview;
  for (let frame = 1; frame <= 8; frame++) {
    preview = drag([local], entries, 2, [20, frame], preview);
    online(preview.snapshot);
    assert.deepEqual(position(preview.snapshot, 2), [20, frame]);
  }
  const source = apply(local, entries, preview);
  assert.doesNotMatch(source, /constraints/);
  assert.match(source, /\['line', 3, \[1, 2\]\]/);
  const fresh = await createTestProjectCompiler(server);
  try {
    const [replay] = await compile('const s = sketch(' + source + ');', fresh);
    assert.deepEqual(replay.entities, preview.snapshot.entities);
    online(replay);
    // The next gesture rediscovers the connection from source, not saved state.
    const next = drag([replay], source, 4, [12, 8]);
    online(next.snapshot);
    assert.deepEqual(position(next.snapshot, 4), [12, 8]);
  } finally {
    fresh.dispose();
  }
});

test('a T-junction follows both its geometric line and authored branch constraints across source replay', async () => {
  const args =
    entries.slice(0, -1) +
    ", ['point', 5, [10, 10]], ['line', 6, [4, 5]]], {constraints: [['horizontal', 3], ['vertical', 6], ['length', 6, 10]]}";
  const [local] = await compile('const s = sketch(' + args + ');');
  const preview = drag([local], args, 5, [15, 15]);
  online(preview.snapshot);
  const source = apply(local, args, preview);
  const [replay] = await compile('const s = sketch(' + source + ');');
  assert.deepEqual(replay.entities, preview.snapshot.entities);
  assert.deepEqual(replay.constraints, local.constraints);
  assert.deepEqual(position(replay, 5), [15, 15]);
  assert.deepEqual(position(replay, 4), [15, 5]);
});

test('expression coordinates and read-only upstream lines retain their source while sliding', async () => {
  for (const upstream of [false, true]) {
    const args = upstream
      ? "[['point', 4, [10, zero]]]"
      : entries.replace('[10, 0]', '[10, zero]');
    const prefix =
      'const zero = 0;\n' +
      (upstream
        ? "const base = sketch([['point', 1, [0, 0]], ['point', 2, [20, 0]], ['line', 3, [1, 2]]]);\n"
        : '');
    const create = upstream ? 'base.derive' : 'sketch';
    const layers = await compile(
      prefix + 'const s = ' + create + '(' + args + ');',
    );
    const preview = drag(layers, args, 4, [7, 8]);
    assert.deepEqual(position(preview.snapshot, 4), [7, 0]);
    const source = apply(layers.at(-1), args, preview);
    assert.match(source, /\['point', 4, \[7, zero\]\]/);
    const replay = await compile(
      prefix + 'const s = ' + create + '(' + source + ');',
    );
    assert.deepEqual(replay.at(-1).entities, preview.snapshot.entities);
    if (upstream) assert.deepEqual(replay[0].entities, layers[0].entities);
  }
});

test('source replay rejects an attempted merge that would pull a contacting point off its line', async () => {
  // A merge target must not bypass gesture relations during replay.
  const args =
    entries.slice(0, -1) +
    ", ['point', 5, [10, 10]]], {constraints: [['fixed', 1], ['fixed', 2]]}";
  const [local] = await compile('const s = sketch(' + args + ');');
  const before = structuredClone(local);
  assert.throws(
    () =>
      compiler.previewSketchDrag([local], {
        id: 4,
        position: [10, 10],
        data: local.data,
        editable: analyzeSketchSource(args).editable,
        mergeTarget: {layer: local.id, id: 5},
      }),
    /could not retain a point on its curve/,
  );
  assert.deepEqual(local, before);
});

test('circle and arc followers replay exactly through fresh compilers after center and radius gestures', async () => {
  for (const arc of [false, true]) {
    const args = arc
      ? "[['point',1,[0,0]],['point',2,[10,0]],['point',3,[0,10]],['arc',4,[1,10,2,3,'ccw']],['point',5,[6,8]]]"
      : "[['point',1,[0,0]],['circle',4,[1,10]],['point',5,[10,0]]]";
    const [local] = await compile('const s = sketch(' + args + ');');
    for (const [id, target] of [
      [1, [5, 6]],
      [4, [0, 20]],
    ]) {
      const preview = drag([local], args, id, target);
      const source = apply(local, args, preview);
      assert.doesNotMatch(source, /constraints/);
      const fresh = await createTestProjectCompiler(server);
      try {
        const [replay] = await compile(
          'const s = sketch(' + source + ');',
          fresh,
        );
        assert.deepEqual(replay.entities, preview.snapshot.entities);
        assert.deepEqual(
          replay.entities.map(e => e.id),
          local.entities.map(e => e.id),
        );
        const next = drag([replay], source, 5, [12, 16]);
        const again = apply(replay, source, next);
        const [second] = await compile(
          'const s = sketch(' + again + ');',
          fresh,
        );
        assert.deepEqual(second.entities, next.snapshot.entities);
      } finally {
        fresh.dispose();
      }
    }
  }
});

test('a point on an expression-radius arc slides within its finite branch with exact source replay', async () => {
  const args =
    "[['point',1,[zero,0]],['point',2,[10,0]],['point',3,[0,10]],['arc',4,[1,r,2,3,'ccw']],['point',5,[6,8]]],{constraints:[['fixed',1],['fixed',2],['fixed',3]]}";
  const prefix = 'const zero=0,r=10;';
  const [local] = await compile(prefix + 'const s=sketch(' + args + ');');
  let preview;
  for (const target of [
    [-10, 0],
    [8, 6],
    [0, 20],
    [6, 8],
  ]) {
    preview = drag([local], args, 5, target, preview);
    const source = apply(local, args, preview);
    assert.match(source, /\[1,r,2,3,'ccw'\]/);
    assert.match(source, /\[zero,0\]/);
    const [replay] = await compile(prefix + 'const s=sketch(' + source + ');');
    assert.deepEqual(replay.entities, preview.snapshot.entities);
  }
});

test('a derived alias slides on an upstream arc without changing its layer or upstream source', async () => {
  const prefix =
    "const base=sketch([['point',1,[0,0]],['point',2,[10,0]],['point',3,[0,10]],['arc',4,[1,10,2,3,'ccw']]]);";
  const args = "[['point',1,[6,8]],['point',2,1]]";
  const layers = await compile(prefix + 'const s=base.derive(' + args + ');');
  const preview = drag(layers, args, 2, [-4, 12]);
  assert.deepEqual(position(preview.snapshot, 1), [0, 10]);
  const source = apply(layers.at(-1), args, preview);
  assert.match(source, /\['point',2,1\]/);
  const replay = await compile(prefix + 'const s=base.derive(' + source + ');');
  assert.deepEqual(replay[0].entities, layers[0].entities);
  assert.deepEqual(replay.at(-1).entities, preview.snapshot.entities);
});
