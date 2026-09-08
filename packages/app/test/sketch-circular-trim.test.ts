import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {
  sketchCurveGeometry,
  sketchCurvePosition,
  type SketchSnapshot,
  type SketchPosition,
} from '@code3d/core/tooling';
import type {SketchChange} from '../src/tools/sketch-source.ts';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestProjectCompiler} from './project-test-files.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let geometry: typeof import('../src/tools/sketch-segments.ts');
let source: typeof import('../src/tools/sketch-source.ts');
before(async () => {
  server = await createAppTestServer();
  geometry = (await server.ssrLoadModule(
    '/src/tools/sketch-segments.ts',
  )) as typeof geometry;
  source = (await server.ssrLoadModule(
    '/src/tools/sketch-source.ts',
  )) as typeof source;
});
after(async () => server?.close());
const ref = (id: number, layer = 'local') => ({id, layer});
const point = (
  id: number,
  x: number,
  y: number,
): SketchSnapshot['entities'][number] => ({
  kind: 'point',
  id,
  position: [x, y],
});
const snapshot = (
  entities: SketchSnapshot['entities'],
  constraints: SketchSnapshot['constraints'] = [],
  id = 'local',
): SketchSnapshot => ({
  id,
  entities,
  constraints,
  degreesOfFreedom: 0,
  redundant: [],
});
const segments = (...layers: SketchSnapshot[]) =>
  geometry.sketchSegments(
    layers,
    layers.flatMap(layer =>
      layer.entities.flatMap(e =>
        e.kind === 'point' ? [{...e, layer: layer.id}] : [],
      ),
    ),
  );
const near = (a: SketchPosition, b: SketchPosition) =>
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, `${a} != ${b}`);
const position = (view: SketchSnapshot, id: number) =>
  view.entities.filter(e => e.kind === 'point').find(e => e.id === id)!
    .position;
function resolve(
  args: string,
  change: SketchChange,
  layer = 'local',
  references: Record<string, string> = {},
) {
  const sourceRef = {file: '/model.ts', start: 0, end: args.length};
  return new source.SketchEditResolver().resolve(
    {
      kind: 'sketch.edit',
      sourceRef,
      expectedText: args,
      layer,
      references,
      change,
    },
    {
      toolId: 'trim',
      baseVersion: 1,
      resolveSourceRef: r => r,
      readSource: ref => args.slice(ref.start, ref.end),
    },
  );
}
function edit(...args: Parameters<typeof resolve>) {
  const result = resolve(...args);
  assert.equal(result.status, 'ready');
  assert.equal(result.plan.edits.length, 1);
  return result.plan.edits[0].text;
}
async function compile(args: string, declarations = '') {
  const compiler = await createTestProjectCompiler(server);
  try {
    const result = await compiler.compile(
      {
        files: [
          {
            path: '/model.ts',
            source: `import {sketch} from '@code3d/core'; ${declarations} const value = sketch(${args});`,
          },
        ],
      },
      '/model.ts',
    );
    assert.equal(result.diagnostic, undefined);
    return [...result.sketches.values()].at(-1)!;
  } finally {
    compiler.dispose();
  }
}

test('circle cuts are cyclic without a zero-angle seam; zero or one boundary deletes the whole circle', () => {
  for (const boundaries of [
    [],
    [point(3, 0, 10)],
    [point(3, 10 * Math.cos(1.8 * Math.PI), 10 * Math.sin(1.8 * Math.PI))],
    [point(3, 0, 10), point(4, 0, -10)],
  ]) {
    const value = snapshot([
      point(1, 0, 0),
      {kind: 'circle', id: 2, center: ref(1), radius: 10},
      ...boundaries,
    ]);
    const parts = segments(value);
    assert.equal(parts.length, boundaries.length === 2 ? 2 : 1);
    if (boundaries.length < 2) {
      assert.equal(parts[0].curve.kind, 'circle');
      const change = geometry.trimSketchSegment([value], parts[0]);
      assert.equal(change.entries.length, 0);
      assert.deepEqual(
        new Set(change.ids),
        new Set(value.entities.map(e => e.id)),
      );
    } else {
      assert.deepEqual(
        parts.map(p => [p.start.t, p.end.t]),
        [
          [0.25, 0.75],
          [0.75, 1.25],
        ],
      );
      assert.ok(geometry.sketchSegmentDistance([10, 0], parts[1]) < 1e-9);
      assert.ok(geometry.sketchSegmentDistance([-10, 0], parts[1]) > 10);
      const change = geometry.trimSketchSegment([value], parts[1]);
      assert.deepEqual(change.entries, [
        ['arc', 2, [ref(1), 10, ref(4), ref(3), 'cw']],
      ]);
    }
  }
});

test('coincident circles and reversed arcs group equal intervals, not complementary arcs or nearby curves', () => {
  const value = snapshot([
    point(1, 0, 0),
    point(2, 10, 0),
    point(3, 0, 10),
    {kind: 'circle', id: 4, center: ref(1), radius: 10},
    {kind: 'circle', id: 5, center: ref(1), radius: 10},
    {
      kind: 'arc',
      id: 6,
      center: ref(1),
      radius: 10,
      points: [ref(3), ref(2)],
      direction: 'cw',
    },
    {
      kind: 'arc',
      id: 7,
      center: ref(1),
      radius: 10,
      points: [ref(3), ref(2)],
      direction: 'ccw',
    },
    {kind: 'circle', id: 8, center: ref(1), radius: 10.001},
  ]);
  const parts = segments(value);
  const selected = parts.find(p => p.id === 4 && p.start.t === 0)!;
  assert.deepEqual(
    geometry.overlappingSketchSegments(parts, selected).map(p => p.id),
    [4, 5, 6],
  );
  const change = geometry.trimSketchSegment([value], selected);
  assert.deepEqual(
    change.replacements.map(r => [r.original.id, r.ids]),
    [
      [4, [4]],
      [5, [5]],
      [6, []],
    ],
  );
  assert.equal(change.entries.filter(e => e[0] === 'arc').length, 2);
  assert.ok(!change.ids.includes(1));
});

test('arc end and interior trims preserve direction, allocate IDs per survivor count and transfer radius constraints only', () => {
  for (const direction of ['ccw', 'cw'] as const) {
    const sign = direction === 'ccw' ? 1 : -1;
    const value = snapshot(
      [
        point(1, 0, 0),
        point(2, 10, 0),
        point(3, 0, -sign * 10),
        point(4, 0, sign * 10),
        point(5, -10, 0),
        {
          kind: 'arc',
          id: 6,
          center: ref(1),
          radius: 10,
          points: [ref(2), ref(3)],
          direction,
        },
      ],
      [
        ['radius', 6, 10],
        ['sweep', 6, 270],
      ],
    );
    const parts = segments(value);
    assert.equal(parts.length, 3);
    for (const index of [0, 1, 2]) {
      const change = geometry.trimSketchSegment([value], parts[index]);
      const arcs = change.entries.filter(e => e[0] === 'arc');
      assert.equal(arcs.length, index === 1 ? 2 : 1);
      assert.deepEqual(
        arcs.map(e => e[1]),
        index === 1 ? [7, 8] : [6],
      );
      assert.ok(arcs.every(e => e[2][4] === direction));
      assert.deepEqual(change.constraintReplacements, [
        {index: 0, ids: arcs.map(e => e[1])},
        {index: 1, ids: []},
      ]);
      assert.ok(!change.ids.includes(1));
    }
  }
});

test('analytic intersections share generated endpoints across overlapping circular trims over model scales', () => {
  for (const scale of [1e-6, 1, 1e6]) {
    const p = (id: number, x: number, y: number) =>
      point(id, (x + 100) * scale, (y - 30) * scale);
    const value = snapshot([
      p(1, 0, 0),
      {kind: 'circle', id: 2, center: ref(1), radius: 10 * scale},
      {kind: 'circle', id: 3, center: ref(1), radius: 10 * scale},
      p(4, -20, 3),
      p(5, 20, 3),
      {kind: 'line', id: 6, points: [ref(4), ref(5)]},
    ]);
    const selected = segments(value).find(s => s.id === 2 && s.end.t < 1)!;
    const change = geometry.trimSketchSegment([value], selected);
    const points = change.entries.filter(e => e[0] === 'point');
    const arcs = change.entries.filter(e => e[0] === 'arc');
    assert.equal(points.length, 2);
    assert.equal(arcs.length, 2);
    assert.deepEqual(arcs[0][2], arcs[1][2]);
    assert.deepEqual(
      arcs.map(e => e[1]),
      [2, 3],
    );
    assert.deepEqual(change.ids, [2, 3]);
    for (const entry of points) {
      assert.ok(Math.abs(entry[2][1] / scale + 27) < 1e-6);
      assert.ok(
        Math.abs(Math.abs(entry[2][0] / scale - 100) - Math.sqrt(91)) < 1e-6,
      );
    }
  }
});

test('named upstream cut points and center expressions survive circle conversion while unsafe split constraints reject atomically', () => {
  const base = snapshot(
    [point(1, 0, 0), point(2, 0, 10), point(3, 0, -10)],
    [],
    'base',
  );
  const local = snapshot([
    {kind: 'circle', id: 1, center: ref(1, 'base'), radius: 10},
  ]);
  const selected = segments(base, local).find(s => s.start.t === 0.75)!;
  const change = geometry.trimSketchSegment([base, local], selected);
  const args = "[['circle', 1, [base.point(1), r / 2 /* radius */,]]]";
  const rewritten = edit(args, change, 'local', {base: 'base'});
  assert.match(rewritten, /base\.point\(1\), r \/ 2 \/\* radius \*\//);
  assert.match(rewritten, /base\.point\(3\), base\.point\(2\), 'cw'/);
  assert.equal(resolve(args, change).status, 'conflict');
  assert.deepEqual(change.ids, [1]);

  const value = snapshot(
    [
      point(1, 0, 0),
      point(2, 10, 0),
      point(3, 0, -10),
      point(4, 0, 10),
      point(5, -10, 0),
      {
        kind: 'arc',
        id: 6,
        center: ref(1),
        radius: 10,
        points: [ref(2), ref(3)],
        direction: 'ccw',
      },
    ],
    [['radius', 6, 10]],
  );
  const split = geometry.trimSketchSegment([value], segments(value)[1]);
  const hidden =
    "[['point',1,[0,0]],['point',2,[10,0]],['point',3,[0,-10]],['point',4,[0,10]],['point',5,[-10,0]],['arc',6,[1,r,2,3,'ccw']]], {constraints:[['radius', curveId, dimension]]}";
  const result = resolve(hidden, split);
  assert.equal(result.status, 'conflict');
  assert.ok(!('plan' in result));
});

test('circle-to-arc source retains radius and center expressions and fresh compilation preserves the surviving interval', async () => {
  for (const radius of [10, 15]) {
    const args =
      "[['point', 1, [0, 0]], ['circle', 2, [1, r]], ['point', 3, [0, 10]], ['point', 4, [0, -10]]], {constraints: [['radius', 2, dimension]]}";
    const declarations = `const r = ${radius}; const dimension = 10;`;
    const original = await compile(args, declarations);
    const selected = segments(original).find(p => p.start.t === 0.75)!;
    const change = geometry.trimSketchSegment([original], selected);
    const rewritten = edit(args, change, original.id);
    assert.match(rewritten, /'arc',\s*2,\s*\[1,\s*r,\s*4,\s*3,\s*'cw'\]/);
    assert.match(rewritten, /'radius',\s*2,\s*dimension/);
    const replay = await compile(rewritten, declarations);
    const arc = replay.entities.find(e => e.kind === 'arc')!;
    assert.equal(arc.kind, 'arc');
    assert.ok(Math.abs(arc.radius - 10) < 1e-6);
    for (const entity of replay.entities)
      if (entity.kind === 'point')
        near(entity.position, position(original, entity.id));
  }
});

test('interior arc splits copy radius source and dimension expressions, remove sweep and replay both finite arcs', async () => {
  for (const direction of ['cw', 'ccw']) {
    const sign = direction === 'cw' ? -1 : 1;
    const args = `[['point', 1, [0, 0]], ['point', 2, [10, 0]], ['point', 3, [0, ${-sign * 10}]], ['point', 4, [0, ${sign * 10}]], ['point', 5, [-10, 0]], ['arc', 6, [1, r /* data */, 2, 3, '${direction}']]], {constraints: [['radius', 6, dimension /* constraint */], ['sweep', 6, 270]]}`;
    const declarations = 'const r = 10; const dimension = 10;';
    const original = await compile(args, declarations);
    const change = geometry.trimSketchSegment(
      [original],
      segments(original)[1],
    );
    const rewritten = edit(args, change, original.id);
    assert.equal(rewritten.match(/\br\b/g)?.length, 2);
    assert.equal(rewritten.match(/dimension/g)?.length, 2);
    assert.equal(rewritten.match(/\/\* data \*\//g)?.length, 2);
    assert.equal(rewritten.match(/\/\* constraint \*\//g)?.length, 2);
    assert.doesNotMatch(rewritten, /sweep/);
    const replay = await compile(rewritten, declarations);
    for (const entity of replay.entities) {
      if (entity.kind === 'point')
        near(entity.position, position(original, entity.id));
      if (entity.kind === 'arc') {
        assert.equal(entity.direction, direction);
        const curve = sketchCurveGeometry(entity, p => position(replay, p.id));
        assert.ok(Math.abs(Math.abs(curve.sweep) - Math.PI / 2) < 1e-6);
      }
    }
  }
});
