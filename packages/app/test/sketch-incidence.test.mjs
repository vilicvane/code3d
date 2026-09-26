import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestModelPipeline} from './project-test-files.ts';
import {trimmedArcSketchArguments} from './sketch-fixtures.ts';

let server, compiler, analyzeSketchSource, SketchEditResolver;
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestModelPipeline(server);
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
function drag(layers, args, id, position, previous, constraints) {
  const continuation = previous?.continuation ?? previous;
  return compiler.previewSketchDrag(
    continuation ? [...layers.slice(0, -1), continuation.snapshot] : layers,
    {
      id,
      position,
      reference: previous?.reference,
      data: continuation?.data ?? layers.at(-1).data,
      constraints,
      editable: analyzeSketchSource(args).editable,
    },
  );
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
        constraints: preview.constraints,
        merge: preview.merge,
        data: preview.data.filter(e =>
          analyzeSketchSource(args).editable.get(e.id)?.some(Boolean),
        ),
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

test('ordinary constraint edits preserve authored circle contacts and expressions in a fresh runtime', async () => {
  const args = `[
    ['point', 1, [0, 0]], ['circle', 2, [1, radius]],
    ['aux:line', 4, [1, 5]],
    ['point', 5, [-5.65685424949, diagonal]],
    ['point', 6, [0, 8]], ['point', 7, [-7.5, 8]], ['line', 8, [6, 7]],
    ['point', 9, [-3.75, 8]], ['line', 10, [5, 9]],
  ], {constraints: [['fixed', 1], ['fixed', 6], ['radius', 2, radius], ['angle', 4, 135], ['horizontal', 8], ['pointOn', [5, 2]], ['pointOn', [9, 8]]]}`;
  const prefix =
    'const radius = 8; const diagonal = 5.65685424949; const angle = -90;\n';
  const [reference] = await compile(prefix + 'const s = sketch(' + args + ');');
  const nextArgs = args.replace(
    "['horizontal', 8]",
    "['horizontal', 8], ['angle', [4, 10], angle]",
  );
  const [solved] = await compile(
    prefix + 'const s = sketch(' + nextArgs + ');',
  );
  assert.ok(
    Math.hypot(
      ...position(solved, 5).map((v, i) => v - position(reference, 5)[i]),
    ) < 1e-7,
  );
  assert.ok(Math.abs(position(solved, 9)[0] - (8 - 8 * Math.SQRT2)) < 1e-7);
  const fresh = await createTestModelPipeline(server);
  try {
    const [replay] = await compile(
      prefix + 'const s = sketch(' + nextArgs + ');',
      fresh,
    );
    assert.deepEqual(replay.entities, solved.entities);
    assert.equal(replay.constraints.length, 8);
  } finally {
    fresh.dispose();
  }
});

test('a radius edit leaves an unconnected expression point unchanged', async () => {
  const args =
    "[['point',1,[0,0]],['circle',2,[1,10]],['point',3,[x,y]]], {constraints:[['fixed',1],['radius',2,10]]}";
  const prefix = 'const x = 6; const y = 8;\n';
  const [reference] = await compile(prefix + 'const s = sketch(' + args + ');');
  const nextArgs = args.replace("['radius',2,10]", "['radius',2,20]");
  const [solved] = await compile(
    prefix + 'const s = sketch(' + nextArgs + ');',
  );
  assert.deepEqual(position(solved, 3), [6, 8]);
  assert.deepEqual(position(reference, 3), [6, 8]);
  assert.equal(solved.entities.find(e => e.kind === 'circle').radius, 20);
});

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
    const fresh = await createTestModelPipeline(server);
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
    const fresh = await createTestModelPipeline(server);
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
    const fresh = await createTestModelPipeline(server);
    try {
      [local] = await compile('const s = sketch(' + args + ');', fresh);
      assert.deepEqual(local.entities, preview.snapshot.entities);
    } finally {
      fresh.dispose();
    }
    if (x === 7.5) assert.deepEqual(local.entities, initial);
  }
});

test('authored point-on-line motion writes actual data and replays exactly in a fresh compiler', async () => {
  const args = entries + ", {constraints: [['pointOn', [4, 3]]]}";
  const [local] = await compile('const s = sketch(' + args + ');');
  let preview;
  for (let frame = 1; frame <= 8; frame++) {
    preview = drag([local], args, 2, [20, frame], preview);
    online(preview.snapshot);
    assert.deepEqual(position(preview.snapshot, 2), [20, frame]);
  }
  const source = apply(local, args, preview);
  assert.match(source, /pointOn/);
  assert.match(source, /\['line', 3, \[1, 2\]\]/);
  const fresh = await createTestModelPipeline(server);
  try {
    const [replay] = await compile('const s = sketch(' + source + ');', fresh);
    assert.deepEqual(replay.entities, preview.snapshot.entities);
    online(replay);
    // The next gesture obeys the authored relation from ordinary source replay.
    const next = drag([replay], source, 4, [12, 8]);
    online(next.snapshot);
    assert.deepEqual(position(next.snapshot, 4), [12, 8]);
  } finally {
    fresh.dispose();
  }
});

test('a T-junction follows its authored contact and branch constraints across source replay', async () => {
  const args =
    entries.slice(0, -1) +
    ", ['point', 5, [10, 10]], ['line', 6, [4, 5]]], {constraints: [['horizontal', 3], ['vertical', 6], ['length', 6, 10], ['pointOn', [4, 3]]]}";
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

test('expression coordinates remain locked independently of coincident local and upstream lines', async () => {
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

test('source replay rejects a merge that conflicts with an authored contact and fixed target', async () => {
  // Point identity changes still obey every authored constraint.
  const args =
    entries.slice(0, -1) +
    ", ['point', 5, [10, 10]]], {constraints: [['fixed', 1], ['fixed', 2], ['fixed', 5], ['pointOn', [4, 3]]]}";
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
    /constraint/i,
  );
  assert.deepEqual(local, before);
});

test('circle and arc followers replay exactly through fresh compilers after center and radius gestures', async () => {
  for (const arc of [false, true]) {
    const args =
      (arc
        ? "[['point',1,[0,0]],['point',2,[10,0]],['point',3,[0,10]],['arc',4,[1,10,2,3,'ccw']],['point',5,[6,8]]]"
        : "[['point',1,[0,0]],['circle',4,[1,10]],['point',5,[10,0]]]") +
      ", {constraints: [['pointOn', [5, 4]]]}";
    const [local] = await compile('const s = sketch(' + args + ');');
    for (const [id, target] of [
      [1, [5, 6]],
      [4, [0, 20]],
    ]) {
      const preview = drag([local], args, id, target);
      const source = apply(local, args, preview);
      assert.match(source, /pointOn/);
      const fresh = await createTestModelPipeline(server);
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
    "[['point',1,[zero,0]],['point',2,[10,0]],['point',3,[0,10]],['arc',4,[1,r,2,3,'ccw']],['point',5,[6,8]]],{constraints:[['fixed',1],['fixed',2],['fixed',3],['pointOn',[5,4]]]}";
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

test('a derived alias moves away from an unconnected upstream arc without changing upstream source', async () => {
  const prefix =
    "const base=sketch([['point',1,[0,0]],['point',2,[10,0]],['point',3,[0,10]],['arc',4,[1,10,2,3,'ccw']]]);";
  const args = "[['point',1,[6,8]],['point',2,1]]";
  const layers = await compile(prefix + 'const s=base.derive(' + args + ');');
  const preview = drag(layers, args, 2, [-4, 12]);
  assert.deepEqual(position(preview.snapshot, 1), [-4, 12]);
  const source = apply(layers.at(-1), args, preview);
  assert.match(source, /\['point',2,1\]/);
  const replay = await compile(prefix + 'const s=base.derive(' + source + ');');
  assert.deepEqual(replay[0].entities, layers[0].entities);
  assert.deepEqual(replay.at(-1).entities, preview.snapshot.entities);
});

test('an unconnected point stays independent when a line moves and can leave a former contact', async () => {
  const [local] = await compile('const s = sketch(' + entries + ');');
  const moved = drag([local], entries, 2, [20, 8]);
  assert.deepEqual(position(moved.snapshot, 4), [10, 0]);
  const point = drag([local], entries, 4, [10, 6]);
  assert.deepEqual(position(point.snapshot, 4), [10, 6]);
  assert.deepEqual(position(point.snapshot, 1), [0, 0]);
  assert.deepEqual(position(point.snapshot, 2), [20, 0]);
  const written = apply(local, entries, point);
  assert.doesNotMatch(written, /constraints/);
  const [replay] = await compile('const s = sketch(' + written + ');');
  assert.deepEqual(replay.entities, point.snapshot.entities);
});

test('accepting a drag snap persists its relation with coordinates while leaving the snap releases it', async () => {
  const args =
    entries.replace('[10, 0]', '[10, 6]') +
    ", {constraints: [['fixed', 1], ['fixed', 2]]}";
  const [local] = await compile('const s = sketch(' + args + ');');
  const constraints = [['pointOn', [{layer: local.id, id: 4}, 3]]];
  const preview = drag([local], args, 4, [8, 0], undefined, constraints);
  assert.deepEqual(preview.constraints, constraints);
  assert.equal(preview.snapshot.constraints.length, 3);
  online(preview.snapshot);
  const released = drag([local], args, 4, [8, 6], preview);
  assert.deepEqual(position(released.snapshot, 4), [8, 6]);
  assert.deepEqual(released.snapshot.constraints, local.constraints);
  const written = apply(local, args, preview);
  assert.match(written, /'pointOn', \[4, 3\]/);
  const [replay] = await compile('const s = sketch(' + written + ');');
  assert.deepEqual(replay.entities, preview.snapshot.entities);
  const moved = drag([replay], written, 4, [8, 6]);
  online(moved.snapshot);
});

test('an incompatible drag snap is rejected before coordinates or relations can be committed', async () => {
  const args =
    entries.replace('[10, 0]', '[10, 6]') +
    ", {constraints: [['fixed', 1], ['fixed', 2], ['fixed', 4]]}";
  const [local] = await compile('const s = sketch(' + args + ');');
  const before = structuredClone(local);
  assert.throws(
    () =>
      drag([local], args, 4, [8, 0], undefined, [
        ['pointOn', [{layer: local.id, id: 4}, 3]],
      ]),
    /constraint/i,
  );
  assert.deepEqual(local, before);
});

test('accepting the same snap through a point alias does not duplicate its authored relation', async () => {
  const args =
    entries.slice(0, -1) +
    ", ['point', 5, 4]], {constraints: [['pointOn', [4, 3]]]}";
  const [local] = await compile('const s = sketch(' + args + ');');
  const preview = drag([local], args, 5, [8, 0], undefined, [
    ['pointOn', [{layer: local.id, id: 5}, 3]],
    ['pointOn', [{layer: local.id, id: 4}, 3]],
  ]);
  assert.deepEqual(preview.constraints, []);
  assert.deepEqual(preview.snapshot.constraints, local.constraints);
  assert.equal(preview.continuation, undefined);
  const written = apply(local, args, preview);
  assert.equal(written.match(/pointOn/g).length, 1);
});
