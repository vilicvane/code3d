import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {
  SketchPointAddress,
  SketchPosition,
  SketchSnapshot,
} from '@code3d/core/tooling';
import type {SketchChange} from '../src/tools/sketch-source.ts';
import type {ProjectCompiler} from '../src/model/project-compiler.ts';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestProjectCompiler} from './project-test-files.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let geometry: typeof import('../src/tools/sketch-segments.ts');
let sourceTools: typeof import('../src/tools/sketch-source.ts');
before(async () => {
  server = await createAppTestServer();
  geometry = (await server.ssrLoadModule(
    '/src/tools/sketch-segments.ts',
  )) as typeof geometry;
  sourceTools = (await server.ssrLoadModule(
    '/src/tools/sketch-source.ts',
  )) as typeof sourceTools;
});
after(async () => server?.close());
const ref = (id: number, layer = 'local'): SketchPointAddress => ({id, layer});
const point = (
  id: number,
  x: number,
  y = 0,
): SketchSnapshot['entities'][number] => ({
  kind: 'point',
  id,
  position: [x, y],
});
const line = (
  id: number,
  a: number,
  b: number,
  layer = 'local',
): SketchSnapshot['entities'][number] => ({
  kind: 'line',
  id,
  points: [ref(a, layer), ref(b, layer)],
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
function resolve(
  source: string,
  change: SketchChange,
  layer = 'local',
  references: Record<string, string> = {},
) {
  const sourceRef = {file: '/model.ts', start: 0, end: source.length};
  return new sourceTools.SketchEditResolver().resolve(
    {
      kind: 'sketch.edit',
      sourceRef,
      expectedText: source,
      layer,
      references,
      change,
    },
    {
      toolId: 'overlap',
      baseVersion: 1,
      resolveSourceRef: ref => ref,
      readSource: () => source,
    },
  );
}

test('overlap groups equal local intervals in either direction, not crossings, touching ends or nearby parallel lines', () => {
  const local = snapshot([
    point(1, 0),
    point(2, 40),
    line(3, 1, 2),
    point(4, 40),
    point(5, 0),
    line(6, 4, 5),
    point(7, 10),
    point(8, 30),
    line(9, 7, 8),
    point(10, 20, -10),
    point(11, 20, 10),
    line(12, 10, 11),
    point(13, 0, 0.1),
    point(14, 40, 0.1),
    line(15, 13, 14),
    point(16, 40),
    point(17, 50),
    line(18, 16, 17),
  ]);
  const base = snapshot(
    [point(1, 0), point(2, 40), line(3, 1, 2, 'base')],
    [],
    'base',
  );
  for (const angle of [0, 37, 90, 180, 270])
    for (const scale of [1e-6, 1, 1e6])
      for (const offset of [0, 1e7]) {
        const theta = (angle * Math.PI) / 180;
        const transform = (layer: SketchSnapshot): SketchSnapshot => ({
          ...layer,
          entities: layer.entities.map(e => {
            if (e.kind !== 'point') return e;
            const [x, y] = e.position;
            return {
              ...e,
              position: [
                offset + scale * (x * Math.cos(theta) - y * Math.sin(theta)),
                -offset + scale * (x * Math.sin(theta) + y * Math.cos(theta)),
              ],
            };
          }),
        });
        const layers = [transform(base), transform(local)];
        const before = structuredClone(layers);
        const parts = segments(...layers);
        for (const [id, count] of [
          [3, 4],
          [6, 4],
          [9, 2],
        ]) {
          assert.equal(
            parts.filter(p => p.layer === 'local' && p.id === id).length,
            count,
            `no spurious cuts: ${id}/${angle}/${scale}/${offset}`,
          );
        }
        const selected = parts.find(
          p =>
            p.layer === 'local' &&
            p.id === 3 &&
            Math.abs((p.start.t + p.end.t) / 2 - 0.375) < 1e-3,
        )!;
        assert.ok(selected, `${angle}/${scale}/${offset}`);
        const group = geometry.overlappingSketchSegments(parts, selected);
        assert.deepEqual(
          group.map(p => p.id),
          [3, 6, 9],
          `${angle}/${scale}/${offset}`,
        );
        assert.ok(group.every(p => p.layer === 'local'));
        assert.deepEqual(
          geometry.overlappingSketchSegments(parts, group[1]).map(p => p.id),
          [3, 6, 9],
        );
        assert.deepEqual(layers, before);
      }
});

test('whole overlap removal cleans all newly orphaned endpoints and their constraints after the batch', () => {
  const value = snapshot(
    [
      point(1, 0),
      point(2, 40),
      point(3, 0),
      point(4, 40),
      line(5, 1, 2),
      line(6, 4, 3),
      point(7, 60, 20),
    ],
    [
      ['fixed', ref(1)],
      ['length', [5, 40]],
      ['angle', [6, 180]],
      ['coincident', [ref(1), ref(3)]],
      ['x', [ref(4), 40]],
      ['y', [ref(7), 20]],
    ],
  );
  const change = geometry.trimSketchSegment([value], segments(value)[0]);
  assert.equal(change.kind, 'trim');
  assert.deepEqual(
    change.lines.map(l => l.id),
    [5, 6],
  );
  assert.deepEqual(change.ids, [5, 6, 1, 2, 3, 4]);
  assert.deepEqual(change.entries, []);
  assert.deepEqual(change.constraints, [0, 3, 4]);
  assert.deepEqual(change.lineConstraints, [
    {index: 1, lines: []},
    {index: 2, lines: []},
  ]);
});

test('a partial overlap removes only the shared interval and preserves outside geometry with distinct IDs', () => {
  const value = snapshot([
    point(1, 0),
    point(2, 40),
    point(3, 10),
    point(4, 30),
    point(5, 10),
    point(6, 30),
    line(7, 1, 2),
    line(8, 3, 4),
    line(9, 6, 5),
  ]);
  const change = geometry.trimSketchSegment(
    [value],
    segments(value).find(p => p.id === 7 && p.start.t === 0.25)!,
  );
  assert.equal(change.kind, 'trim');
  assert.deepEqual(change.ids, [7, 8, 9]);
  assert.deepEqual(change.entries, [
    ['line', 10, [ref(1), ref(3)]],
    ['line', 11, [ref(4), ref(2)]],
  ]);
});

test('computed cut points are shared by all overlapping survivors and direction rewrites stay in source order', () => {
  const value = snapshot(
    [
      point(1, 0),
      point(2, 40),
      point(3, 0),
      point(4, 40),
      point(5, 10, -10),
      point(6, 10, 10),
      point(7, 30, -10),
      point(8, 30, 10),
      line(9, 1, 2),
      line(10, 4, 3),
      line(11, 5, 6),
      line(12, 7, 8),
    ],
    [
      ['angle', [10, 180]],
      ['length', [9, 40]],
      ['angle', [9, 0]],
      ['length', [10, 40]],
    ],
  );
  const change = geometry.trimSketchSegment(
    [value],
    segments(value).find(p => p.id === 9 && p.start.t === 0.25)!,
  );
  assert.equal(change.kind, 'trim');
  assert.deepEqual(
    change.entries.filter(e => e[0] === 'point'),
    [
      ['point', 13, [10, 0]],
      ['point', 15, [30, 0]],
    ],
  );
  assert.deepEqual(
    change.entries.filter(e => e[0] === 'line'),
    [
      ['line', 14, [ref(1), ref(13)]],
      ['line', 16, [ref(15), ref(2)]],
      ['line', 17, [ref(4), ref(15)]],
      ['line', 18, [ref(13), ref(3)]],
    ],
  );
  assert.deepEqual(change.lineConstraints, [
    {index: 0, lines: [17, 18]},
    {index: 1, lines: []},
    {index: 2, lines: [14, 16]},
    {index: 3, lines: []},
  ]);
});

test('an uneditable direction in a later overlapping line rejects the entire source plan', () => {
  const value = snapshot(
    [
      point(1, 0),
      point(2, 40),
      point(3, 10),
      point(4, 30),
      line(5, 1, 2),
      line(6, 2, 1),
    ],
    [
      ['angle', [5, 0]],
      ['angle', [6, 180]],
    ],
  );
  const change = geometry.trimSketchSegment([value], segments(value)[1]);
  const source =
    "[['point',1,[0,0]], ['point',2,[40,0]], ['point',3,[10,0]], ['point',4,[30,0]], ['line',5,[1,2]], ['line',6,[2,1]]], {constraints: [['angle', [5, theta]], ['angle', hidden]]}";
  const result = resolve(source, change);
  assert.equal(result.status, 'conflict');
  assert.ok(!('plan' in result));
});

test('all overlapping lines are rewritten in one edit and survive fresh compiler replay with expression directions', async () => {
  for (const angle of [0, 37, 90, 180]) {
    const theta = (angle * Math.PI) / 180;
    const rotate = (x: number, y: number): SketchPosition => [
      x * Math.cos(theta) - y * Math.sin(theta),
      x * Math.sin(theta) + y * Math.cos(theta),
    ];
    const data = [
      [0, 0],
      [40, 0],
      [0, 0],
      [40, 0],
      [10, -10],
      [10, 10],
      [30, -10],
      [30, 10],
    ].map(([x, y], i) => ['point', i + 1, rotate(x, y)]);
    const args = `${JSON.stringify([...data, ['line', 9, [1, 2]], ['line', 10, [4, 3]], ['line', 11, [5, 6]], ['line', 12, [7, 8]]])}, {constraints: [['angle',[10, theta + 180 /* reversed */]], ['length',[9,40]], ['angle',[9,theta]], ['length',[10,40]]]}`;
    const compile = async (args: string) => {
      const compiler: ProjectCompiler = await createTestProjectCompiler(server);
      try {
        const module = await compiler.compile(
          {
            files: [
              {
                path: '/model.ts',
                source: `import {sketch} from '@code3d/core'; const theta = ${angle}; const value = sketch(${args});`,
              },
            ],
          },
          '/model.ts',
        );
        assert.equal(module.diagnostic, undefined);
        return [...module.sketches.values()][0];
      } finally {
        compiler.dispose();
      }
    };
    const original = await compile(args);
    const selected = segments(original).find(
      p => p.id === 9 && p.start.t > 0 && p.end.t < 1,
    )!;
    const change = geometry.trimSketchSegment([original], selected);
    const resolved = resolve(args, change, original.id);
    assert.ok(resolved.status === 'ready');
    assert.equal(resolved.plan.edits.length, 1);
    const source = resolved.plan.edits[0].text;
    assert.equal(source.match(/\/\* reversed \*\//g)?.length, 2);
    assert.doesNotMatch(source, /'length'/);
    const replay = await compile(source);
    assert.equal(replay.entities.filter(e => e.kind === 'point').length, 10);
    assert.equal(replay.entities.filter(e => e.kind === 'line').length, 6);
    assert.deepEqual(replay.constraints, [
      ['angle', [17, angle + 180]],
      ['angle', [14, angle]],
      ['angle', [18, angle + 180]],
      ['angle', [16, angle]],
    ]);
    const remaining = segments(replay).filter(p =>
      [14, 16, 17, 18].includes(p.id),
    );
    assert.equal(remaining.length, 4);
    assert.equal(
      geometry.overlappingSketchSegments(remaining, remaining[0]).length,
      2,
    );
  }
});
