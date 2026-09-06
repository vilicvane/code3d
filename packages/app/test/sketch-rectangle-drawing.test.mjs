import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';
import {createTestProjectCompiler} from './project-test-files.mjs';

let server, SketchRectangleDrawing, SketchEditResolver, analyzeSketchSource;
before(async () => {
  server = await createAppTestServer();
  ({SketchRectangleDrawing} = await server.ssrLoadModule(
    '/src/tools/sketch-rectangle-drawing.ts',
  ));
  ({SketchEditResolver, analyzeSketchSource} = await server.ssrLoadModule(
    '/src/tools/sketch-source.ts',
  ));
});
after(async () => server?.close());
const context = {points: [], scale: 10, gridStep: 1, enabled: false};
const position = snap =>
  snap.endpoint.point?.position ?? snap.endpoint.position;
function place(drawing, point, commit, nextId = 1) {
  drawing.pointer = point;
  return drawing.place(
    drawing.resolve(context).endpoint,
    'local',
    nextId,
    commit,
  );
}

test('a rectangle in every quadrant emits four shared corners and four direction constraints atomically', () => {
  for (const x of [-1, 1])
    for (const y of [-1, 1]) {
      const drawing = new SketchRectangleDrawing();
      const changes = [];
      const commit = change => (changes.push(change), true);
      assert.equal(place(drawing, [3, 5], commit, 10), undefined);
      assert.equal(changes.length, 0);
      const end = [3 + 40 * x, 5 + 20 * y];
      assert.deepEqual(drawing.measurements(end), {width: 40, height: 20});
      const segments = drawing.segments(end);
      assert.equal(segments.length, 4);
      assert.equal(place(drawing, end, commit, 10), undefined);
      assert.equal(changes.length, 1);
      const {entries, constraints} = changes[0];
      assert.deepEqual(
        entries.map(e => e[1]),
        [10, 11, 12, 13, 14, 15, 16, 17],
      );
      assert.deepEqual(
        entries.slice(0, 4).map(e => e[2]),
        segments.map(e => e[0]),
      );
      assert.deepEqual(
        entries.slice(4).map(e => e[2].map(p => p.id)),
        [
          [10, 11],
          [11, 12],
          [12, 13],
          [13, 10],
        ],
      );
      assert.deepEqual(constraints, [
        ['horizontal', 14],
        ['vertical', 15],
        ['horizontal', 16],
        ['vertical', 17],
      ]);
      assert.equal(drawing.hasDraft, false);
      assert.equal(drawing.title, 'First corner');
    }
});

test('width and height keep their magnitudes while the pointer chooses the quadrant and free axes', () => {
  const drawing = new SketchRectangleDrawing();
  place(drawing, [3, 5], () => true);
  drawing.dimensions.set('width', '40');
  for (const x of [-1, 1])
    for (const y of [-1, 1]) {
      drawing.pointer = [3 + x * 70, 5 + y * 25];
      assert.deepEqual(position(drawing.resolve(context)), [
        3 + x * 40,
        5 + y * 25,
      ]);
    }
  drawing.dimensions.set('height', '20');
  drawing.pointer = [-70, -80];
  assert.deepEqual(position(drawing.resolve(context)), [-37, -15]);
  for (const invalid of ['-', '0', '-2', 'NaN']) {
    drawing.dimensions.set('width', invalid);
    assert.match(
      place(drawing, [-70, -80], () =>
        assert.fail('invalid dimensions cannot commit'),
      ),
      /Width/,
    );
    assert.equal(drawing.dimensions.value('width'), 40);
    assert.equal(drawing.dimensions.text('width'), invalid);
  }
  drawing.dimensions.set('width', '');
  assert.deepEqual(position(drawing.resolve(context)), [-70, -15]);
});

test('explicit first-corner coordinates and sizes become constraints without constraining unentered values', () => {
  const drawing = new SketchRectangleDrawing();
  drawing.dimensions.set('x', '2');
  place(drawing, [10, 5], () => true);
  drawing.dimensions.set('height', '20');
  let result;
  place(drawing, [30, 70], change => ((result = change), true));
  assert.deepEqual(
    result.entries.slice(0, 4).map(e => e[2]),
    [
      [2, 5],
      [30, 5],
      [30, 25],
      [2, 25],
    ],
  );
  assert.deepEqual(result.constraints, [
    ['x', [{layer: 'local', id: 1}, 2]],
    ['horizontal', 5],
    ['vertical', 6],
    ['horizontal', 7],
    ['vertical', 8],
    ['length', [6, 20]],
  ]);
});

test('snapping preserves corner identities and never overrides entered dimensions', () => {
  const drawing = new SketchRectangleDrawing();
  const a = {layer: 'base', id: 7, position: [0, 0]};
  const b = {layer: 'local', id: 8, position: [30, 20]};
  const snapping = {...context, enabled: true, points: [a, b]};
  drawing.pointer = [0.2, 0.2];
  assert.equal(drawing.resolve(snapping).endpoint.point, a);
  drawing.place(drawing.resolve(snapping).endpoint, 'local', 9, () => true);
  drawing.pointer = [30.2, 20.2];
  assert.equal(drawing.resolve(snapping).endpoint.point, b);
  drawing.dimensions.set('width', '29.5');
  assert.equal(drawing.resolve(snapping).endpoint.point, undefined);
  drawing.dimensions.set('width', '');
  let result;
  drawing.place(
    drawing.resolve(snapping).endpoint,
    'local',
    9,
    change => ((result = change), true),
  );
  assert.equal(result.entries.filter(e => e[0] === 'point').length, 2);
  assert.deepEqual(result.entries[2][2], [
    {layer: 'base', id: 7},
    {layer: 'local', id: 9},
  ]);
  assert.deepEqual(result.entries[3][2], [
    {layer: 'local', id: 9},
    {layer: 'local', id: 8},
  ]);
});

test('zero area, cancellation and rejected transactions never partially create geometry or consume identities', () => {
  const drawing = new SketchRectangleDrawing();
  place(drawing, [0, 0], () => true);
  assert.match(
    place(drawing, [0, 20], () => assert.fail()),
    /greater than zero/,
  );
  drawing.dimensions.set('width', '30');
  const attempts = [];
  assert.match(
    place(drawing, [30, 20], change => (attempts.push(change), false)),
    /not applied/,
  );
  assert.equal(drawing.hasDraft, true);
  assert.equal(drawing.dimensions.text('width'), '30');
  assert.equal(
    place(drawing, [30, 20], change => (attempts.push(change), true)),
    undefined,
  );
  assert.deepEqual(attempts[0], attempts[1]);
  place(drawing, [40, 50], () => true, 9);
  drawing.reset();
  assert.equal(drawing.hasDraft, false);
  assert.deepEqual(drawing.segments([40, 60]), []);
  assert.deepEqual(
    drawing.dimensions.definitions.map(f => f.id),
    ['x', 'y'],
  );
});

test('center rectangles use full dimensions and one persistent midpoint relation in every quadrant', () => {
  for (const x of [-1, 1])
    for (const y of [-1, 1]) {
      const drawing = new SketchRectangleDrawing('center');
      assert.equal(drawing.title, 'Center');
      drawing.dimensions.set('x', '3');
      place(drawing, [3, 5], () => assert.fail('center remains a draft'));
      assert.equal(drawing.title, 'Corner');
      drawing.dimensions.set('width', '40');
      drawing.pointer = [3 + x * 60, 5 + y * 15];
      assert.deepEqual(position(drawing.resolve(context)), [
        3 + x * 20,
        5 + y * 15,
      ]);
      drawing.dimensions.set('height', '20');
      const endpoint = drawing.resolve(context).endpoint;
      const end = position({endpoint});
      assert.deepEqual(end, [3 + x * 20, 5 + y * 10]);
      assert.deepEqual(drawing.measurements(end), {width: 40, height: 20});
      const segments = drawing.segments(end);
      let result;
      assert.equal(
        drawing.place(
          endpoint,
          'local',
          1,
          change => ((result = change), true),
        ),
        undefined,
      );
      assert.equal(result.entries.length, 9);
      assert.deepEqual(result.entries[0], ['point', 1, [3, 5]]);
      assert.deepEqual(
        result.entries.slice(1, 5).map(e => e[2]),
        segments.map(e => e[0]),
      );
      assert.deepEqual(result.constraints, [
        ['x', [{layer: 'local', id: 1}, 3]],
        ['horizontal', 6],
        ['vertical', 7],
        ['horizontal', 8],
        ['vertical', 9],
        ['midpoint', [1, 2, 4].map(id => ({layer: 'local', id}))],
        ['length', [6, 40]],
        ['length', [7, 20]],
      ]);
      assert.equal(drawing.title, 'Center');
      assert.equal(drawing.hasDraft, false);
    }
});

test('center and corner reuse real snapped references without consuming center identities', () => {
  const drawing = new SketchRectangleDrawing('center');
  const center = {layer: 'base', id: 1, position: [0, 0]};
  const corner = {layer: 'local', id: 2, position: [20, 15]};
  const snapping = {...context, enabled: true, points: [center, corner]};
  drawing.pointer = [0.1, 0.1];
  drawing.place(drawing.resolve(snapping).endpoint, 'local', 3, () =>
    assert.fail(),
  );
  drawing.dimensions.set('width', '40');
  drawing.pointer = [20.1, 15.1];
  const endpoint = drawing.resolve(snapping).endpoint;
  assert.equal(endpoint.point, corner);
  let result;
  drawing.place(endpoint, 'local', 3, change => ((result = change), true));
  assert.equal(result.entries.length, 7);
  assert.deepEqual(
    result.entries.slice(0, 3).map(e => e[1]),
    [3, 4, 5],
  );
  assert.deepEqual(result.constraints[4], [
    'midpoint',
    [
      {layer: 'base', id: 1},
      {layer: 'local', id: 3},
      {layer: 'local', id: 2},
    ],
  ]);
});

function edit(args, change) {
  const sourceRef = {file: '/model.ts', start: 0, end: args.length};
  const result = new SketchEditResolver().resolve(
    {
      kind: 'sketch.edit',
      sourceRef,
      expectedText: args,
      layer: 'local',
      references: {},
      change,
    },
    {
      toolId: 'rectangle',
      baseVersion: 1,
      resolveSourceRef: ref => ref,
      readSource: () => args,
    },
  );
  assert.equal(result.status, 'ready');
  assert.equal(result.plan.edits.length, 1);
  return result.plan.edits[0].text;
}

test('generated rectangles preserve right angles, dimensions and source replay when dragging every corner', async () => {
  const compiler = await createTestProjectCompiler(server);
  const compile = async args => {
    const result = await compiler.compile(
      {
        files: [
          {
            path: '/model.ts',
            source: `import {sketch} from '@code3d/core'; const value = sketch(${args});`,
          },
        ],
      },
      '/model.ts',
    );
    assert.equal(result.diagnostic, undefined);
    return [...result.sketches.values()][0];
  };
  const points = value =>
    value.entities.filter(e => e.kind === 'point').map(e => e.position);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
  try {
    for (const mode of ['corner', 'center'])
      for (const fields of [[], ['width'], ['height'], ['width', 'height']]) {
        const drawing = new SketchRectangleDrawing(mode);
        place(drawing, [0, 0], () => true);
        for (const field of fields)
          drawing.dimensions.set(field, field === 'width' ? '40' : '30');
        let args;
        place(drawing, [40, 30], change => ((args = edit('[]', change)), true));
        const original = await compile(args);
        assert.equal(original.degreesOfFreedom, 4 - fields.length);
        assert.deepEqual(original.redundant, []);
        points(original).forEach((p, i) =>
          p.forEach((v, axis) => near(v, original.data[i].position[axis])),
        );
        for (const id of mode === 'center' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4]) {
          let preview = {snapshot: original, data: original.data};
          const start = points(original)[id - 1];
          for (let step = 1; step <= 20; step++) {
            preview = compiler.previewSketchDrag([preview.snapshot], {
              id,
              position: [start[0] + step / 2, start[1] + step / 3],
              editable: analyzeSketchSource(args).editable,
              data: preview.data,
            });
            const solved = points(preview.snapshot);
            const [a, b, c, d] = solved.slice(mode === 'center' ? 1 : 0);
            near(a[1], b[1]);
            near(b[0], c[0]);
            near(c[1], d[1]);
            near(d[0], a[0]);
            if (mode === 'center') {
              near(solved[0][0], (a[0] + c[0]) / 2);
              near(solved[0][1], (a[1] + c[1]) / 2);
              if (id !== 1)
                solved[0].forEach((v, axis) =>
                  near(v, points(original)[0][axis]),
                );
            }
            if (fields.includes('width')) near(Math.abs(b[0] - a[0]), 40);
            if (fields.includes('height')) near(Math.abs(c[1] - b[1]), 30);
          }
          const replay = await compile(
            edit(args, {kind: 'move', positions: preview.data}),
          );
          points(replay).forEach((p, i) =>
            p.forEach((v, axis) => near(v, points(preview.snapshot)[i][axis])),
          );
        }
      }
  } finally {
    compiler.dispose();
  }
});

test('a generated center stays referenceable by a derived sketch after source dimension updates', async () => {
  const compiler = await createTestProjectCompiler(server);
  const drawing = new SketchRectangleDrawing('center');
  place(drawing, [4, 6], () => true);
  drawing.dimensions.set('width', '40');
  drawing.dimensions.set('height', '30');
  let args;
  place(drawing, [24, 21], change => ((args = edit('[]', change)), true));
  try {
    for (const width of [40, 60]) {
      const result = await compiler.compile(
        {
          files: [
            {
              path: '/model.ts',
              source: `import {sketch} from '@code3d/core';
const base = sketch(${args.replace("['length', [6, 40]]", `['length', [6, ${width}]]`)});
const child = base.derive([['point', 1, [0, 0]], ['line', 2, [base.point(1), 1]]]);`,
            },
          ],
        },
        '/model.ts',
      );
      assert.equal(result.diagnostic, undefined);
      const values = [...result.sketches.values()];
      const base = values.find(s => !s.base),
        child = values.find(s => s.base);
      const center = base.entities.find(e => e.kind === 'point' && e.id === 1);
      assert.ok(center);
      assert.equal(child.base, base.id);
      assert.deepEqual(child.entities.find(e => e.kind === 'line').points[0], {
        layer: base.id,
        id: 1,
      });
      assert.deepEqual(child.references[base.id], 'base');
    }
  } finally {
    compiler.dispose();
  }
});
