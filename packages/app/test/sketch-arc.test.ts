import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {SketchSnapshot} from '@code3d/core/tooling';
import type {SketchChange} from '../src/tools/sketch-source.ts';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestProjectCompiler} from './project-test-files.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let source: typeof import('../src/tools/sketch-source.ts');
let segments: typeof import('../src/tools/sketch-segments.ts');
let constraints: typeof import('../src/tools/sketch-constraints.ts');
let drawing: typeof import('../src/tools/sketch-arc-drawing.ts');
before(async () => {
  server = await createAppTestServer();
  source = (await server.ssrLoadModule(
    '/src/tools/sketch-source.ts',
  )) as typeof source;
  segments = (await server.ssrLoadModule(
    '/src/tools/sketch-segments.ts',
  )) as typeof segments;
  constraints = (await server.ssrLoadModule(
    '/src/tools/sketch-constraints.ts',
  )) as typeof constraints;
  drawing = (await server.ssrLoadModule(
    '/src/tools/sketch-arc-drawing.ts',
  )) as typeof drawing;
});
after(async () => server?.close());
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
      toolId: 'arc',
      baseVersion: 1,
      resolveSourceRef: ref => ref,
      readSource: () => args,
    },
  );
  assert.equal(result.status, 'ready');
  return result.plan.edits[0].text;
}
const ref = (id: number, layer = 'local') => ({id, layer});

test('arc drawings default to CW after construction, cancellation and a completed CCW arc', () => {
  const tool = new drawing.SketchArcDrawing();
  for (const finish of ['cancel', 'commit'] as const) {
    tool.place({position: [0, 0]}, 'local', 1, () => assert.fail());
    tool.place({position: [10, 0]}, 'local', 1, () => assert.fail());
    assert.equal(tool.title, 'End point · CW');
    tool.toggleDirection();
    assert.equal(tool.title, 'End point · CCW');
    if (finish === 'cancel') tool.reset();
    else
      tool.place({position: [0, 10]}, 'local', 1, change => {
        assert.equal(change.kind, 'append');
        assert.deepEqual(change.entries.at(-1), [
          'arc',
          4,
          [ref(1), ref(2), ref(3), 'ccw'],
        ]);
        return true;
      });
    assert.equal(tool.title, 'Center');
  }
  tool.place({position: [0, 0]}, 'local', 1, () => assert.fail());
  tool.place({position: [10, 0]}, 'local', 1, () => assert.fail());
  assert.equal(tool.title, 'End point · CW');
});

test('entered sweep projects the endpoint, preserves compatible references and commits one independent constraint', () => {
  for (const direction of ['ccw', 'cw']) {
    const tool = new drawing.SketchArcDrawing();
    tool.place({position: [0, 0]}, 'local', 1, () => assert.fail());
    tool.place({position: [10, 0]}, 'local', 1, () => assert.fail());
    tool.dimensions.set('sweep', '270');
    if (direction === 'ccw') tool.toggleDirection();
    tool.pointer = [10, 0];
    const end = {
      layer: 'base',
      id: 9,
      position: [0, direction === 'cw' ? 10 : -10] as const,
    };
    const resolved = tool.resolve({
      points: [end],
      scale: 10,
      gridStep: 1,
      enabled: true,
    });
    assert.deepEqual(resolved.endpoint, {point: end});
    assert.ok(Math.abs(tool.measurements(end.position).sweep - 270) < 1e-8);
    let args = '[]';
    tool.place(
      resolved.endpoint,
      'local',
      1,
      change => ((args = edit(args, change)), true),
    );
    assert.match(args, /\['sweep', \[3, 270\]\]/);
    assert.match(
      args,
      new RegExp(
        `\\['arc', 3, \\[1, 2, base.point\\(9\\), '${direction}'\\]\\]`,
      ),
    );
    assert.doesNotMatch(args, /radius/);
    assert.equal(tool.title, 'Center');
    assert.equal(tool.hasDraft, false);
  }
});

test('sweep field rejects zero/full turns, retains valid preview during incomplete input and resets cleanly', () => {
  const tool = new drawing.SketchArcDrawing();
  tool.place({position: [0, 0]}, 'local', 1, () => assert.fail());
  tool.place({position: [10, 0]}, 'local', 1, () => assert.fail());
  tool.dimensions.set('sweep', '90');
  for (const value of ['0', '-90', '360', '361', '1e999', '-']) {
    tool.dimensions.set('sweep', value);
    assert.ok(tool.dimensions.error('sweep'));
    assert.equal(tool.dimensions.value('sweep'), 90);
    assert.ok(tool.place({position: [0, 10]}, 'local', 1, () => assert.fail()));
  }
  for (const value of ['.001', '359.999']) {
    tool.dimensions.set('sweep', value);
    assert.equal(tool.dimensions.error('sweep'), undefined);
  }
  tool.dimensions.set('sweep', '');
  assert.equal(tool.dimensions.value('sweep'), undefined);
  tool.pointer = [0, 10];
  assert.deepEqual(
    tool.resolve({points: [], scale: 10, gridStep: 1, enabled: false}).endpoint,
    {position: [0, 10]},
  );
  tool.reset();
  assert.equal(tool.hasDraft, false);
  assert.deepEqual(
    tool.dimensions.definitions.map(d => d.id),
    ['x', 'y'],
  );
});

test('sweep badges expose center and both endpoints, and deletion removes the expression constraint atomically', () => {
  const local: SketchSnapshot = {
    id: 'local',
    degreesOfFreedom: 4,
    redundant: [],
    entities: [
      {kind: 'point', id: 1, position: [0, 0]},
      {kind: 'point', id: 2, position: [10, 0]},
      {kind: 'point', id: 3, position: [0, 10]},
      {
        kind: 'arc',
        id: 4,
        center: ref(1),
        points: [ref(2), ref(3)],
        direction: 'cw',
      },
    ],
    constraints: [['sweep', [4, 270]]],
  };
  const points = local.entities
    .filter(e => e.kind === 'point')
    .map(e => ({...e, layer: local.id}));
  const display = constraints.sketchConstraintDisplays([local], points)[0];
  assert.equal(display.label, '270°');
  assert.match(display.title, /Sweep 270° · CW · arc 4/);
  assert.deepEqual(display.curve, ref(4));
  assert.deepEqual(
    display.points.map(p => p.id),
    [1, 2, 3],
  );
  assert.deepEqual(display.guides, [
    [
      [0, 0],
      [10, 0],
    ],
    [
      [0, 0],
      [0, 10],
    ],
  ]);
  assert.ok(display.anchor[0] < 0 && display.anchor[1] < 0);
  const args =
    "[['point', 1, [0, 0]], ['point', 2, [10, 0]], ['point', 3, [0, 10]], ['arc', 4, [1, 2, 3, 'cw']]], {constraints: [['sweep', [4, angle /* keep expression */]]]}";
  const moved = edit(args, {kind: 'move', data: [{id: 2, parameters: [9, 1]}]});
  assert.match(moved, /angle \/\* keep expression \*\//);
  const deleted = edit(args, segments.deleteSketchEntity([local], 4));
  assert.doesNotMatch(deleted, /'arc'|'point'|'sweep'/);
});

test('sweep and radius drag previews replay through rounded AST edits and fresh compilation without losing expressions', async () => {
  const compiler = await createTestProjectCompiler(server);
  try {
    const compile = async (args: string) => {
      const module = await compiler.compile(
        {
          files: [
            {
              path: '/model.ts',
              source: `import {sketch} from '@code3d/core'; const center = 0; const angle = 270; const value = sketch(${args});`,
            },
          ],
        },
        '/model.ts',
      );
      assert.equal(module.diagnostic, undefined);
      return [...module.sketches.values()][0];
    };
    for (const direction of ['cw', 'ccw']) {
      const args = `[['point', 1, [center, 0]], ['point', 2, [10, 0]], ['point', 3, [0, ${direction === 'cw' ? 10 : -10}]], ['arc', 4, [1, 2, 3, '${direction}']]], {constraints: [['fixed', 1], ['radius', [4, 10]], ['sweep', [4, angle /* degrees */]]]}`;
      const original = await compile(args),
        editable = source.analyzeSketchSource(args).editable;
      let preview = {snapshot: original as SketchSnapshot, data: original.data};
      for (const degrees of [110, 145, 179, 181, 220, 270, 315, 359, 361]) {
        const radians = (degrees * Math.PI) / 180;
        preview = compiler.previewSketchDrag([preview.snapshot], {
          id: 3,
          position: [10 * Math.cos(radians), 10 * Math.sin(radians)],
          editable,
          data: preview.data,
        });
        const updated = edit(
          args,
          {
            kind: 'move',
            data: preview.data.filter(p => editable.get(p.id)?.some(Boolean)),
          },
          original.id,
        );
        assert.match(updated, /center/);
        assert.match(updated, /angle \/\* degrees \*\//);
        const replay = await compile(updated);
        const numbers = (s: SketchSnapshot) =>
          s.entities.flatMap(e => (e.kind === 'point' ? e.position : []));
        numbers(preview.snapshot).forEach((v, i) =>
          assert.ok(Math.abs(v - numbers(replay)[i]) < 1e-6),
        );
      }
    }
  } finally {
    compiler.dispose();
  }
});

test('arc drawing is one atomic center/start/end transaction with direction and entered radius', () => {
  const tool = new drawing.SketchArcDrawing();
  tool.dimensions.set('x', '0');
  assert.equal(
    tool.place({position: [0, 0]}, 'local', 1, () => assert.fail()),
    undefined,
  );
  tool.dimensions.set('radius', '10');
  assert.equal(
    tool.place({position: [10, 0]}, 'local', 1, () => assert.fail()),
    undefined,
  );
  const preview = tool.preview([0, 10])[0];
  assert.equal(preview.kind, 'arc');
  assert.ok(preview.sweep < -Math.PI);
  assert.match(
    tool.place({position: [10, 0]}, 'local', 1, () => assert.fail())!,
    /distinct/,
  );
  const attempts: SketchChange[] = [];
  const commit = (accept: boolean) =>
    tool.place(
      {position: [0, 10]},
      'local',
      1,
      change => (attempts.push(change), accept),
    );
  assert.match(commit(false)!, /not applied/);
  assert.equal(commit(true), undefined);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.deepEqual(attempts[1], {
    kind: 'append',
    entries: [
      ['point', 1, [0, 0]],
      ['point', 2, [10, 0]],
      ['point', 3, [0, 10]],
      ['arc', 4, [ref(1), ref(2), ref(3), 'cw']],
    ],
    constraints: [
      ['x', [ref(1), 0]],
      ['radius', [4, 10]],
    ],
  });
  assert.equal(tool.hasDraft, false);
});

test('arc drawing projects to its finite radius, preserves compatible point references and cancels cleanly', () => {
  const tool = new drawing.SketchArcDrawing();
  const center = {layer: 'base', id: 7, position: [0, 0] as const},
    start = {layer: 'base', id: 8, position: [10, 0] as const},
    end = {layer: 'base', id: 9, position: [0, 10] as const};
  tool.place({point: center}, 'local', 1, () => assert.fail());
  tool.place({point: start}, 'local', 1, () => assert.fail());
  tool.pointer = [0, 12];
  const resolved = tool.resolve({
    points: [center, start, end],
    scale: 10,
    gridStep: 1,
    enabled: true,
  });
  assert.deepEqual(resolved.endpoint, {point: end});
  let args = '[]';
  tool.place(
    resolved.endpoint,
    'local',
    1,
    change => ((args = edit(args, change)), true),
  );
  assert.match(
    args,
    /\['arc', 1, \[base.point\(7\), base.point\(8\), base.point\(9\), 'cw'\]\]/,
  );
  tool.place({position: [0, 0]}, 'local', 2, () => assert.fail());
  tool.reset();
  assert.equal(tool.hasDraft, false);
  assert.equal(tool.title, 'Center');
});

test('arc source serialization retains named upstream points and only rewrites literal point parameters', () => {
  const appended = edit('[]', {
    kind: 'append',
    entries: [['arc', 4, [ref(1, 'base'), ref(2), ref(3), 'cw']]],
  });
  assert.match(appended, /\['arc', 4, \[base\.point\(1\), 2, 3, 'cw'\]\]/);
  const initial =
    "[['point', 2, [width, /* y */ +2]], ['arc', 4, [base.point(1), 2, base.point(3), 'ccw']]]";
  assert.deepEqual(
    [...source.analyzeSketchSource(initial).editable],
    [[2, [false, true]]],
  );
  assert.equal(
    edit(initial, {kind: 'move', data: [{id: 2, parameters: [50, 7]}]}),
    initial.replace('+2', '7'),
  );
});

test('arc endpoint preview, rounded source transactions and fresh compiler evaluations agree across angular branches', async () => {
  const compiler = await createTestProjectCompiler(server);
  try {
    const compile = async (args: string) => {
      const module = await compiler.compile(
        {
          files: [
            {
              path: '/model.ts',
              source: `import {sketch} from '@code3d/core'; const width = 0; const value = sketch(${args});`,
            },
          ],
        },
        '/model.ts',
      );
      assert.equal(module.diagnostic, undefined);
      return [...module.sketches.values()][0];
    };
    for (const direction of ['cw', 'ccw']) {
      const args = `[['point', 1, [width, 0]], ['point', 2, [10, 0]], ['point', 3, [0, 10]], ['arc', 4, [1, 2, 3, '${direction}']]], {constraints: [['fixed', 1], ['radius', [4, 10]]]}`;
      const original = await compile(args),
        editable = source.analyzeSketchSource(args).editable;
      let preview = {snapshot: original as SketchSnapshot, data: original.data};
      for (const degrees of [110, 145, 179, 181, 220, 270, 315, 359, 361]) {
        const angle = (degrees * Math.PI) / 180;
        preview = compiler.previewSketchDrag([preview.snapshot], {
          id: 3,
          position: [10 * Math.cos(angle), 10 * Math.sin(angle)],
          editable,
          data: preview.data,
        });
        const updated = edit(
          args,
          {
            kind: 'move',
            data: preview.data.filter(p => editable.get(p.id)?.some(Boolean)),
          },
          original.id,
        );
        assert.match(updated, /width/);
        assert.match(updated, new RegExp(`'${direction}'`));
        assert.doesNotMatch(updated, /'point',\s*4/);
        const replay = await compile(updated);
        const numbers = (s: SketchSnapshot) =>
          s.entities.flatMap(e => (e.kind === 'point' ? e.position : []));
        numbers(preview.snapshot).forEach((v, i) =>
          assert.ok(Math.abs(v - numbers(replay)[i]) < 1e-6),
        );
      }
    }
  } finally {
    compiler.dispose();
  }
});

test('arc radius badges follow the directed arc midpoint and deletion cleans only disconnected referenced points', () => {
  const local: SketchSnapshot = {
    id: 'local',
    degreesOfFreedom: 0,
    redundant: [],
    entities: [
      {kind: 'point', id: 1, position: [0, 0]},
      {kind: 'point', id: 2, position: [10, 0]},
      {kind: 'point', id: 3, position: [0, 10]},
      {kind: 'point', id: 8, position: [5, 5]},
      {
        kind: 'arc',
        id: 4,
        center: ref(1),
        points: [ref(2), ref(3)],
        direction: 'cw',
      },
      {kind: 'circle', id: 5, center: ref(1), radius: 3},
    ],
    constraints: [
      ['radius', [4, 10]],
      ['fixed', ref(3)],
    ],
  };
  const points = local.entities
    .filter(e => e.kind === 'point')
    .map(e => ({...e, layer: local.id}));
  const display = constraints.sketchConstraintDisplays([local], points)[0];
  assert.equal(display.label, 'R10');
  assert.deepEqual(display.curve, ref(4));
  assert.ok(display.anchor[0] < 0 && display.anchor[1] < 0);
  assert.deepEqual(segments.deleteSketchEntity([local], 4), {
    kind: 'delete',
    ids: [4, 2, 3],
    constraints: [0, 1],
  });
  assert.deepEqual(segments.deleteSketchEntity([local], 3), {
    kind: 'delete',
    ids: [3, 4, 2],
    constraints: [0, 1],
  });
});

test('orphan cleanup uses finite analytic curves, including interior points and shared circle connections', () => {
  const local: SketchSnapshot = {
    id: 'local',
    degreesOfFreedom: 0,
    redundant: [],
    constraints: [],
    entities: [
      {kind: 'point', id: 1, position: [0, 0]},
      {kind: 'point', id: 2, position: [10, 0]},
      {kind: 'point', id: 3, position: [-10, 0]},
      {kind: 'point', id: 5, position: [0, 10]},
      {kind: 'point', id: 6, position: [0, -10]},
      {
        kind: 'arc',
        id: 4,
        center: ref(1),
        points: [ref(2), ref(3)],
        direction: 'ccw',
      },
    ],
  };
  assert.deepEqual(segments.deleteSketchEntity([local], 4), {
    kind: 'delete',
    ids: [4, 1, 2, 3, 5],
    constraints: [],
  });
  const connected: SketchSnapshot = {
    ...local,
    entities: [
      ...local.entities,
      {kind: 'point', id: 7, position: [0, 12]},
      {kind: 'circle', id: 8, center: ref(7), radius: 2},
    ],
  };
  assert.deepEqual(segments.deleteSketchEntity([connected], 4), {
    kind: 'delete',
    ids: [4, 1, 2, 3],
    constraints: [],
  });
});
