import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestProjectCompiler} from './project-test-files.ts';

let server, compiler, ModelViewport, analyzeSketchSource, SketchEditResolver;
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestProjectCompiler(server);
  ({ModelViewport} = await server.ssrLoadModule('/src/viewport.ts'));
  ({analyzeSketchSource, SketchEditResolver} = await server.ssrLoadModule(
    '/src/tools/sketch-source.ts',
  ));
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

async function compile(source, files = []) {
  const module = await compiler.compile(
    {
      files: [
        {
          path: '/model.ts',
          source: `import {sketch} from '@code3d/core';\n${source}`,
        },
        ...files,
      ],
    },
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  return module;
}

test('named sketches are selectable without a 3D model and retain layer-local identities', async () => {
  const source = `import {sketch} from '@code3d/core';
const width = 20;
let sketch1 = sketch([['point', 1, [0, 0]], ['point', 2, [width, 0]], ['line', 3, [1, 2]]]);
let sketch2 = sketch1.derive([['point', 1, [10, 10]], ['line', 2, [sketch1.point(2), 1]]]);`;
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  assert.equal(module.sketches.size, 2);
  const [base, derived] = [...module.sketches.values()];
  assert.equal(derived.base, base.id);
  assert.equal(derived.references[base.id], 'sketch1');
  assert.equal(
    source.slice(derived.definitionRef.start, derived.definitionRef.end),
    "[['point', 1, [10, 10]], ['line', 2, [sketch1.point(2), 1]]]",
  );
  for (const [binding, value] of [
    ['sketch1 =', base],
    ['sketch2 =', derived],
  ]) {
    const target = ModelViewport.prototype.sourceTargetAt.call(
      {module},
      '/model.ts',
      source.indexOf(binding) + 3,
    );
    assert.deepEqual(target.evaluations[0].sketchIds, [value.id]);
  }
});

test('grandparent references use visible bindings without relative-depth syntax', async () => {
  const module = await compile(`const base = sketch([['point', 1, [0, 0]]]);
const middle = base.derive([]);
const end = middle.derive([]);`);
  const [base, middle, end] = [...module.sketches.values()];
  assert.equal(end.references[base.id], 'base');
  assert.equal(end.references[middle.id], 'middle');
});

test('receiver parameters are valid names, shadowed and reassigned ancestors are not guessed', async () => {
  const module = await compile(`let base = sketch([['point', 1, [0, 0]]]);
const middle = base.derive([]);
base = sketch([]);
function derive(input) { const base = 42; return input.derive([]); }
const end = derive(middle);`);
  const layers = [...module.sketches.values()];
  const end = layers.at(-1);
  assert.equal(end.references[end.base], 'input');
  assert.equal(end.references[layers[0].id], undefined);
});

test('computed arrays remain visible without pretending they have an editable tuple source', async () => {
  const module = await compile(
    `const entries = [['point', 1, [0, 0]]]; const value = sketch(entries);`,
  );
  const value = [...module.sketches.values()][0];
  assert.equal(value.definitionRef, undefined);
  assert.equal(value.entities.length, 1);
});

test('argument-side reassignment does not turn the receiver name into a false upstream reference', async () => {
  const module = await compile(`let base = sketch([['point', 1, [0,0]]]);
const original = base;
const other = sketch([]);
const result = base.derive([['point', 1, [(base = other, 0), 0]]]);`);
  const [base, , result] = [...module.sketches.values()];
  assert.equal(result.references[base.id], 'original');
});

test('import aliases and repeated compilation preserve authored identities', async () => {
  const source =
    "import {base as upstream} from './base.ts'; const derived = upstream.derive([]);";
  const files = [
    {
      path: '/base.ts',
      source:
        "import {sketch} from '@code3d/core'; export const base = sketch([['point', 7, [0,0]]]);",
    },
  ];
  const first = await compile(source, files),
    second = await compile(source, files);
  assert.deepEqual([...second.sketches.keys()], [...first.sketches.keys()]);
  const [base, derived] = [...first.sketches.values()];
  assert.equal(derived.references[base.id], 'upstream');
});

test('receiver tracing preserves optional chain short circuiting and evaluates receivers once', async () => {
  await compile(`let calls = 0;
function get() { calls++; return {child: {method() { return this; }}}; }
const none = undefined;
none?.child.method();
none?.child?.method();
get().child.method();
if (calls !== 1) throw new Error('Repeated receiver evaluation');
const value = sketch([]);`);
});

test('constraint options share the editable source range and use the installed sketch solver', async () => {
  const args =
    "[['point', 1, [0,0]], ['point', 2, [38,2]], ['line', 3, [1,2]]], {constraints: [['fixed', 1], ['horizontal', 3], ['length', [3, width]]]}";
  const source = `import {sketch} from '@code3d/core'; const width = 40; const value = sketch(${args});`;
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const value = [...module.sketches.values()][0];
  assert.equal(
    source.slice(value.definitionRef.start, value.definitionRef.end),
    args,
  );
  assert.deepEqual(value.entities[1].position, [40, 0]);
  assert.equal(value.degreesOfFreedom, 0);
  const dragged = compiler.previewSketchDrag([value], {
    id: 2,
    position: [80, 30],
    editable: new Map([
      [1, [true, true]],
      [2, [true, true]],
    ]),
    data: value.data,
  });
  assert.deepEqual(dragged.snapshot.entities[1].position, [40, 0]);
});

test('AST coordinate locks preserve expressions through drag, source transactions and a fresh compiler', async () => {
  const cases = [
    {args: "[['point', 1, [x, 19]]]", id: 1, target: [30, 25]},
    {args: "[['point', 1, [22, y]]]", id: 1, target: [30, 25]},
    {
      args: "[['point', 1, [x, y]], ['point', 2, [62, 19]], ['line', 3, [1, 2]]], {constraints: [['length', [3, 40]]]}",
      id: 2,
      target: [46, 51],
    },
    {
      args: "[['point', 1, [22, 0]], ['point', 2, [62, y]], ['line', 3, [1, 2]]], {constraints: [['horizontal', 3]]}",
      id: 2,
      target: [70, 30],
    },
    {
      args: "[['point', 1, [2, 2]], ['point', 2, [x, 19]], ['line', 3, [1, 2]]], {constraints: [['length', [3, 40]]]}",
      id: 1,
      target: [-6, -5],
      initiallyUnsolved: true,
    },
  ];
  const point = (value, id) =>
    value.entities.find(e => e.kind === 'point' && e.id === id).position;
  const close = (a, b) =>
    a.forEach((v, axis) =>
      assert.ok(Math.abs(v - b[axis]) < 1e-7, `${a} != ${b}`),
    );
  for (const {args, id, target, initiallyUnsolved} of cases) {
    const source = `import {sketch} from '@code3d/core'; const x = 22; const y = 19; const value = sketch(${args});`;
    const module = await compiler.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    const value = [...module.sketches.values()][0];
    const {editable} = analyzeSketchSource(args);
    if (initiallyUnsolved)
      assert.ok(
        Math.abs(point(value, 2)[0] - 22) > 1,
        'normal evaluation still solves numeric seeds freely',
      );
    let preview = {snapshot: value, data: value.data};
    for (let frame = 1; frame <= 10; frame++) {
      const start = point(value, id);
      assert.doesNotThrow(
        () =>
          (preview = compiler.previewSketchDrag([preview.snapshot], {
            id,
            position: start.map(
              (v, axis) => v + ((target[axis] - v) * frame) / 10,
            ),
            editable,
            data: preview.data,
          })),
        `${args}: frame ${frame}`,
      );
      for (const data of value.data)
        for (const axis of [0, 1])
          if (!editable.get(data.id)[axis]) {
            assert.equal(
              preview.data.find(p => p.id === data.id).position[axis],
              data.position[axis],
            );
            assert.ok(
              Math.abs(
                point(preview.snapshot, data.id)[axis] - data.position[axis],
              ) < 1e-7,
            );
          }
      assert.deepEqual(preview.snapshot.constraints, value.constraints);
    }
    const sourceRef = value.definitionRef;
    const resolution = new SketchEditResolver().resolve(
      {
        kind: 'sketch.edit',
        sourceRef,
        expectedText: args,
        layer: value.id,
        references: {},
        change: {
          kind: 'move',
          positions: preview.data.filter(p => editable.get(p.id).some(Boolean)),
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
    assert.equal(resolution.plan.edits.length, 1);
    const edited = resolution.plan.edits[0].text;
    const parsed = analyzeSketchSource(edited);
    const original = analyzeSketchSource(args);
    for (const [id, axes] of editable)
      for (const axis of [0, 1])
        if (!axes[axis])
          assert.equal(
            parsed.entries.get(id).data.elements[axis].getText(),
            original.entries.get(id).data.elements[axis].getText(),
          );
    assert.doesNotMatch(edited, /fixed|offset/);
    const cold = await createTestProjectCompiler(server);
    try {
      const replaySource =
        source.slice(0, sourceRef.start) + edited + source.slice(sourceRef.end);
      const replay = await cold.compile(
        {files: [{path: '/model.ts', source: replaySource}]},
        '/model.ts',
      );
      assert.equal(replay.diagnostic, undefined);
      const replayValue = [...replay.sketches.values()][0];
      for (const data of preview.data)
        close(point(replayValue, data.id), point(preview.snapshot, data.id));
      assert.equal(replayValue.degreesOfFreedom, value.degreesOfFreedom);
    } finally {
      cold.dispose();
    }
  }
});

test('constraint conflicts highlight their source tuples, without persistent constraint IDs', async () => {
  const source = `import {sketch} from '@code3d/core'; const value = sketch([['point', 1, [0,0]], ['point', 2, [40,0]], ['line', 3, [1,2]]], {constraints: [['length', [3, 40]], ['length', [3, 50]]]});`;
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic.kind, 'evaluation');
  assert.match(module.diagnostic.summary, /sketch constraints/);
  const ref = module.diagnostic.sourceRef;
  assert.equal(
    source.slice(ref.start, ref.end),
    "['length', [3, 40]], ['length', [3, 50]]",
  );
});

test('temporary drag anchors survive full rotations and exact rounded source replay', async () => {
  const source = data =>
    `const value = sketch(${JSON.stringify([
      ...data.map(p => ['point', p.id, p.position]),
      ['line', 3, [1, 2]],
    ])}, {constraints: [['length', [3, 40]]]});`;
  const initialData = [
    {id: 1, position: [2, 2]},
    {id: 2, position: [22, 19]},
  ];
  const initial = [
    ...(await compile(source(initialData))).sketches.values(),
  ][0];
  const point = (snapshot, id) =>
    snapshot.entities.find(e => e.kind === 'point' && e.id === id).position;
  const close = (a, b) =>
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${a} != ${b}`));
  for (const id of [1, 2]) {
    const anchor = id === 1 ? 2 : 1;
    const center = point(initial, anchor),
      start = point(initial, id);
    const angle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    let preview = {snapshot: initial, data: initial.data};
    const unchanged = compiler.previewSketchDrag([initial], {
      id,
      position: start,
      editable: new Map([
        [1, [true, true]],
        [2, [true, true]],
      ]),
      data: initial.data,
    });
    assert.deepEqual(
      unchanged.data,
      initial.data,
      'a click must not normalize author seeds',
    );
    for (let step = 1; step <= 144; step++) {
      const theta = angle + (step * Math.PI) / 72;
      const position = [
        center[0] + 40 * Math.cos(theta),
        center[1] + 40 * Math.sin(theta),
      ];
      preview = compiler.previewSketchDrag([preview.snapshot], {
        id,
        position,
        editable: new Map([
          [1, [true, true]],
          [2, [true, true]],
        ]),
        data: preview.data,
      });
      close(point(preview.snapshot, anchor), center);
      close(point(preview.snapshot, id), position);
      if ([71, 73, 144].includes(step)) {
        const replay = [
          ...(await compile(source(preview.data))).sketches.values(),
        ][0];
        for (const pointId of [1, 2])
          close(point(preview.snapshot, pointId), point(replay, pointId));
      }
    }
  }
});

test('a library wrapper cannot expose an editable array while hiding its constraint options', async () => {
  const module = await compile(`
// Simulate a library wrapper whose body is not source-instrumented.
const wrapped = Function('sketch', 'return entries => sketch(entries, {constraints: [["fixed", 1]]})')(sketch);
const value = wrapped([['point', 1, [0,0]]]);`);
  const value = [...module.sketches.values()][0];
  assert.equal(value.definitionRef, undefined);
  assert.equal(value.constraints.length, 1);
});
