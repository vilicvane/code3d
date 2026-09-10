import type {SketchPosition, SketchSnapshot} from '@code3d/core/tooling';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {SketchChange} from '../src/tools/sketch-source.ts';
import {createTestModelPipeline} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let drawing: typeof import('../src/tools/sketch-circle-drawing.ts');
let source: typeof import('../src/tools/sketch-source.ts');
let geometry: typeof import('../src/tools/sketch-segments.ts');
before(async () => {
  server = await createAppTestServer();
  drawing = (await server.ssrLoadModule(
    '/src/tools/sketch-circle-drawing.ts',
  )) as typeof drawing;
  source = (await server.ssrLoadModule(
    '/src/tools/sketch-source.ts',
  )) as typeof source;
  geometry = (await server.ssrLoadModule(
    '/src/tools/sketch-segments.ts',
  )) as typeof geometry;
});
after(async () => server?.close());
const context = {points: [], scale: 10, gridStep: 1, enabled: false};
const ref = (id: number, layer = 'local') => ({id, layer});
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function edit(
  args: string,
  change: SketchChange,
  layer = 'local',
  references = {base: 'base'},
) {
  const sourceRef = {file: '/model.ts', start: 0, end: args.length};
  const result = new source.SketchEditResolver().resolve(
    {
      kind: 'sketch.edit',
      sourceRef,
      expectedText: args,
      layer,
      references,
      change,
    },
    {
      toolId: 'circle',
      baseVersion: 1,
      resolveSourceRef: ref => ref,
      readSource: ref => args.slice(ref.start, ref.end),
    },
  );
  assert.equal(result.status, 'ready');
  return result.plan.edits[0].text;
}

test('circle creates only a center and analytic circle, with explicitly entered dimensions as constraints', () => {
  for (const constrained of [false, true]) {
    const tool = new drawing.SketchCircleDrawing();
    const changes: SketchChange[] = [];
    const place = (position: SketchPosition) => {
      tool.pointer = position;
      return tool.place(
        tool.resolve(context).endpoint,
        'local',
        7,
        change => (changes.push(change), true),
      );
    };
    if (constrained) tool.dimensions.set('x', '3');
    assert.equal(place([3, 4]), undefined);
    assert.equal(changes.length, 0);
    assert.equal(tool.title, 'Radius');
    if (constrained) tool.dimensions.set('radius', '5');
    assert.deepEqual(tool.preview([3, 9])[0], {
      kind: 'circle',
      center: [3, 4],
      radius: 5,
    });
    assert.equal(place([3, 9]), undefined);
    assert.deepEqual(changes, [
      {
        kind: 'append',
        entries: [
          ['point', 7, [3, 4]],
          ['circle', 8, [ref(7), 5]],
        ],
        constraints: constrained
          ? [
              ['x', ref(7), 3],
              ['radius', 8, 5],
            ]
          : [],
      },
    ]);
    assert.equal(tool.hasDraft, false);
    assert.equal(tool.title, 'Center');
  }
});

test('circle cancellation, invalid radius and a rejected commit preserve source and allocation', () => {
  const tool = new drawing.SketchCircleDrawing();
  tool.place({position: [0, 0]}, 'local', 1, () => assert.fail());
  for (const invalid of ['0', '-2', '-']) {
    tool.dimensions.set('radius', invalid);
    assert.match(
      tool.place({position: [5, 0]}, 'local', 1, () => assert.fail())!,
      /Radius/,
    );
  }
  tool.dimensions.set('radius', '5');
  const attempts: SketchChange[] = [];
  assert.match(
    tool.place(
      {position: [5, 0]},
      'local',
      1,
      change => (attempts.push(change), false),
    )!,
    /not applied/,
  );
  assert.ok(tool.hasDraft);
  tool.place(
    {position: [5, 0]},
    'local',
    1,
    change => (attempts.push(change), true),
  );
  assert.deepEqual(attempts[0], attempts[1]);
  tool.place({position: [0, 0]}, 'local', 1, () => assert.fail());
  assert.match(
    tool.place({position: [0, 0]}, 'local', 1, () => assert.fail())!,
    /positive/,
  );
  tool.reset();
  assert.equal(tool.hasDraft, false);
});

test('circle centers reuse upstream identity while radius source edits preserve expressions and comments', () => {
  const tool = new drawing.SketchCircleDrawing();
  tool.place({point: {...ref(9, 'base'), position: [0, 0]}}, 'local', 1, () =>
    assert.fail(),
  );
  let args = '[]';
  tool.place(
    {position: [5, 0]},
    'local',
    1,
    change => ((args = edit(args, change)), true),
  );
  assert.match(args, /\['circle', 1, \[base\.point\(9\), 5\]\]/);
  assert.doesNotMatch(args, /'point'/);
  const initial =
    "[['point', 1, [width, 2]], ['circle', 2, [1, /* radius */ +5]], ['circle', 3, [1, radius]]]";
  assert.deepEqual(
    [...source.analyzeSketchSource(initial).editable],
    [
      [1, [false, true]],
      [2, [true]],
      [3, [false]],
    ],
  );
  assert.equal(
    edit(initial, {
      kind: 'move',
      data: [
        {id: 1, parameters: [88, 7]},
        {id: 2, parameters: [6.5]},
      ],
    }),
    initial.replace('width, 2', 'width, 7').replace('+5', '6.5'),
  );
});

test('circle radius and center previews replay the exact rounded author data with hard and expression locks', async () => {
  const compiler = await createTestModelPipeline(server);
  try {
    const compile = async (args: string) => {
      const module = await compiler.compile(
        {
          files: [
            {
              path: '/model.ts',
              source: `import {sketch} from '@code3d/core'; const width = 3, radius = 5; const value = sketch(${args});`,
            },
          ],
        },
        '/model.ts',
      );
      assert.equal(module.diagnostic, undefined);
      return [...module.sketches.values()][0];
    };
    for (const options of [
      '',
      ", {constraints: [['fixed', 1]]}",
      ", {constraints: [['radius', 2, 8]]}",
    ])
      for (const radius of ['5', 'radius']) {
        const args = `[['point', 1, [width, 4]], ['circle', 2, [1, ${radius}]]]${options}`;
        const original = await compile(args);
        if (radius === 'radius' && options.includes("'radius'")) {
          assert.throws(
            () =>
              compiler.previewSketchDrag([original], {
                id: 1,
                position: [3, 8],
                editable: source.analyzeSketchSource(args).editable,
                data: original.data,
              }),
            /constraints/,
          );
          continue;
        }
        for (const id of [1, 2]) {
          const editable = source.analyzeSketchSource(args).editable;
          let preview = {
            snapshot: original as SketchSnapshot,
            data: original.data,
          };
          for (let step = 1; step <= 20; step++) {
            assert.doesNotThrow(() => {
              preview = compiler.previewSketchDrag([preview.snapshot], {
                id,
                position: [3 + step, 4 + step / 3],
                editable,
                data: preview.data,
              });
            }, `${args}; drag ${id}, step ${step}`);
            assert.equal(preview.data.find(e => e.id === 1)!.parameters[0], 3);
            if (radius === 'radius')
              assert.equal(
                preview.data.find(e => e.id === 2)!.parameters[0],
                5,
              );
          }
          const updated = edit(
            args,
            {
              kind: 'move',
              data: preview.data.filter(e => editable.get(e.id)!.some(Boolean)),
            },
            original.id,
          );
          assert.match(updated, /width/);
          if (radius === 'radius') assert.match(updated, /radius/);
          const replay = await compile(updated);
          const numbers = (s: SketchSnapshot) =>
            s.entities.flatMap(e =>
              e.kind === 'point'
                ? e.position
                : e.kind === 'circle'
                  ? [e.radius]
                  : [],
            );
          numbers(preview.snapshot).forEach((v, i) =>
            near(v, numbers(replay)[i]),
          );
        }
      }
  } finally {
    await compiler.dispose();
  }
});

test('deleting circles cleans only newly disconnected centers and affected constraints', () => {
  const local: SketchSnapshot = {
    id: 'local',
    degreesOfFreedom: 0,
    redundant: [],
    entities: [
      {kind: 'point', id: 1, position: [0, 0]},
      {kind: 'point', id: 4, position: [9, 9]},
      {kind: 'circle', id: 2, center: ref(1), radius: 5},
      {kind: 'circle', id: 3, center: ref(1), radius: 8},
    ],
    constraints: [
      ['fixed', ref(1)],
      ['radius', 2, 5],
      ['radius', 3, 8],
    ],
  };
  assert.deepEqual(geometry.deleteSketchEntity([local], 2), {
    kind: 'delete',
    ids: [2],
    constraints: [1],
  });
  assert.deepEqual(geometry.deleteSketchEntity([local], 1), {
    kind: 'delete',
    ids: [1, 2, 3],
    constraints: [0, 1, 2],
  });
  const one = {
    ...local,
    entities: local.entities.filter(e => e.id !== 3),
    constraints: local.constraints.slice(0, 2),
  };
  assert.deepEqual(geometry.deleteSketchEntity([one], 2), {
    kind: 'delete',
    ids: [2, 1],
    constraints: [0, 1],
  });
});
