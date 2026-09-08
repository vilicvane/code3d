import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestProjectCompiler} from './project-test-files.ts';

let server,
  sketchSegments,
  trimSketchSegment,
  deleteSketchEntity,
  sketchSegmentDistance,
  SketchEditResolver;
before(async () => {
  server = await createAppTestServer();
  ({
    sketchSegments,
    trimSketchSegment,
    sketchSegmentDistance,
    deleteSketchEntity,
  } = await server.ssrLoadModule('/src/tools/sketch-segments.ts'));
  ({SketchEditResolver} = await server.ssrLoadModule(
    '/src/tools/sketch-source.ts',
  ));
});
after(async () => server?.close());

const ref = (id, layer = 'local') => ({id, layer});
const point = (id, x, y) => ({kind: 'point', id, position: [x, y]});
const line = (id, a, b) => ({
  kind: 'line',
  id,
  points: [
    typeof a === 'number' ? ref(a) : a,
    typeof b === 'number' ? ref(b) : b,
  ],
});
const snapshot = (entities, constraints = [], id = 'local') => ({
  id,
  entities,
  constraints,
  degreesOfFreedom: 0,
  redundant: [],
});
function segments(...layers) {
  const points = layers.flatMap(layer =>
    layer.entities
      .filter(e => e.kind === 'point')
      .map(p => ({...p, layer: layer.id})),
  );
  return sketchSegments(layers, points).filter(
    segment => segment.kind === 'line',
  );
}

test('trimmed crossing geometry and direction constraints survive fresh compiler replay', async () => {
  const compiler = await createTestProjectCompiler(server);
  const compile = async (args, angle) => {
    const result = await compiler.compile(
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
    assert.equal(result.diagnostic, undefined);
    return [...result.sketches.values()][0];
  };
  try {
    for (const angle of [0, 45, 180, 270]) {
      const radians = (angle * Math.PI) / 180;
      const rotate = ([x, y]) => [
        x * Math.cos(radians) - y * Math.sin(radians),
        x * Math.sin(radians) + y * Math.cos(radians),
      ];
      const positions = [
        [0, 0],
        [40, 0],
        [10, -10],
        [10, 10],
        [30, -10],
        [30, 10],
      ].map(rotate);
      const entries = [
        ...positions.map((p, index) => ['point', index + 1, p]),
        ['line', 7, [1, 2]],
        ['line', 8, [3, 4]],
        ['line', 9, [5, 6]],
      ];
      const args = `${JSON.stringify(entries)}, {constraints: [['angle', 7, theta], ['length', 7, 40]]}`;
      const original = await compile(args, angle);
      const selected = segments(original).find(
        s => s.id === 7 && s.start.t > 0 && s.end.t < 1,
      );
      assert.ok(selected);
      const change = trimSketchSegment([original], selected);
      const sourceRef = {file: '/model.ts', start: 0, end: args.length};
      const resolved = new SketchEditResolver().resolve(
        {
          kind: 'sketch.edit',
          sourceRef,
          expectedText: args,
          layer: original.id,
          references: {},
          change,
        },
        {
          toolId: 'trim',
          baseVersion: 1,
          resolveSourceRef: ref => ref,
          readSource: () => args,
        },
      );
      assert.equal(resolved.status, 'ready');
      assert.equal(resolved.plan.edits.length, 1);
      const source = resolved.plan.edits[0].text;
      assert.equal(source.match(/theta/g).length, 2);
      const replay = await compile(source, angle);
      const expected = [...positions, rotate([10, 0]), rotate([30, 0])];
      const actual = replay.entities.filter(e => e.kind === 'point');
      assert.equal(actual.length, expected.length);
      actual.forEach((p, index) =>
        p.position.forEach((axis, i) =>
          assert.ok(
            Math.abs(axis - expected[index][i]) < 1e-7,
            `${angle}: point ${p.id} moved`,
          ),
        ),
      );
      assert.deepEqual(replay.constraints, [
        ['angle', 11, angle],
        ['angle', 13, angle],
      ]);
      assert.deepEqual(
        replay.entities
          .filter(e => e.kind === 'line')
          .map(e => [e.id, e.points.map(p => p.id)]),
        [
          [8, [3, 4]],
          [9, [5, 6]],
          [11, [1, 10]],
          [13, [12, 2]],
        ],
      );
    }
  } finally {
    compiler.dispose();
  }
});
const intervals = values => values.map(s => [s.start.t, s.end.t]);

test('analytic circles split lines at crossings without changing the circle or creating source points', () => {
  const value = snapshot([
    point(1, -10, 0),
    point(2, 10, 0),
    line(3, 1, 2),
    point(4, 0, 3),
    {kind: 'circle', id: 5, center: ref(4), radius: 5},
  ]);
  const original = structuredClone(value);
  const parts = segments(value);
  assert.deepEqual(intervals(parts), [
    [0, 0.3],
    [0.3, 0.7],
    [0.7, 1],
  ]);
  assert.deepEqual(parts[1].start.endpoint, {position: [-4, 0]});
  assert.deepEqual(parts[1].end.endpoint, {position: [4, 0]});
  assert.deepEqual(value, original);
});

test('only the finite directed arc cuts a line, not the missing portion of its supporting circle', () => {
  for (const direction of ['cw', 'ccw']) {
    const value = snapshot([
      point(1, -10, 0),
      point(2, 10, 0),
      line(3, 1, 2),
      point(4, 0, 3),
      point(5, -5, 3),
      point(6, 0, -2),
      {
        kind: 'arc',
        id: 7,
        center: ref(4),
        radius: 5,
        points: [ref(5), ref(6)],
        direction,
      },
    ]);
    const cut = direction === 'cw' ? 0.7 : 0.3;
    const parts = segments(value);
    assert.equal(parts.length, 2);
    assert.ok(Math.abs(parts[0].end.t - cut) < 1e-9);
  }
});

test('tangent circles supply one cut and actual coincident point identities take precedence', () => {
  const value = snapshot([
    point(1, -10, 0),
    point(2, 10, 0),
    line(3, 1, 2),
    point(4, 0, 5),
    {kind: 'circle', id: 5, center: ref(4), radius: 5},
    {kind: 'circle', id: 6, center: ref(4), radius: 5},
    point(7, 0, 0),
  ]);
  const parts = segments(value);
  assert.deepEqual(intervals(parts), [
    [0, 0.5],
    [0.5, 1],
  ]);
  assert.equal(parts[0].end.endpoint.point.id, 7);
});

test('upstream circular boundaries stay read-only during a local line trim', () => {
  const base = snapshot(
    [
      point(1, 0, 3),
      {kind: 'circle', id: 2, center: ref(1, 'base'), radius: 5},
    ],
    [],
    'base',
  );
  const local = snapshot([point(1, -10, 0), point(2, 10, 0), line(3, 1, 2)]);
  const original = structuredClone(base);
  const change = trimSketchSegment([base, local], segments(base, local)[1]);
  assert.deepEqual(change.ids, [3]);
  assert.deepEqual(
    change.replacements.map(r => r.original.id),
    [3],
  );
  assert.equal(change.entries.filter(e => e[0] === 'line').length, 2);
  assert.deepEqual(base, original);
});

test('circle-delimited line trim preserves boundary expressions and constraints through fresh compilation', async () => {
  const compiler = await createTestProjectCompiler(server);
  const compile = async args => {
    const module = await compiler.compile(
      {
        files: [
          {
            path: '/model.ts',
            source: `import {sketch} from '@code3d/core'; const r = 5; const theta = 0; const value = sketch(${args});`,
          },
        ],
      },
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    return [...module.sketches.values()][0];
  };
  try {
    const args =
      "[['point', 1, [-10, 0]], ['point', 2, [10, 0]], ['line', 3, [1, 2]], ['point', 4, [0, 3]], ['circle', 5, [4, r]]], {constraints: [['angle', 3, theta], ['length', 3, 20], ['radius', 5, r]]}";
    const original = await compile(args);
    const change = trimSketchSegment([original], segments(original)[1]);
    const sourceRef = {file: '/model.ts', start: 0, end: args.length};
    const resolved = new SketchEditResolver().resolve(
      {
        kind: 'sketch.edit',
        sourceRef,
        expectedText: args,
        layer: original.id,
        references: {},
        change,
      },
      {
        toolId: 'trim',
        baseVersion: 1,
        resolveSourceRef: ref => ref,
        readSource: () => args,
      },
    );
    assert.equal(resolved.status, 'ready');
    const text = resolved.plan.edits[0].text;
    assert.ok(text.includes("['circle', 5, [4, r]]"));
    assert.ok(text.includes("['radius', 5, r]"));
    assert.equal(text.match(/theta/g).length, 2);
    assert.doesNotMatch(text, /'length'/);
    const replay = await compile(text);
    assert.deepEqual(
      replay.entities.filter(e => e.kind === 'circle'),
      original.entities.filter(e => e.kind === 'circle'),
    );
    assert.deepEqual(
      replay.entities.filter(e => e.kind === 'point').map(e => e.position),
      [
        [-10, 0],
        [10, 0],
        [0, 3],
        [-4, 0],
        [4, 0],
      ],
    );
    assert.deepEqual(
      replay.entities.filter(e => e.kind === 'line').map(e => e.id),
      [7, 9],
    );
  } finally {
    compiler.dispose();
  }
});

test('existing points partition a line without altering its authored geometry', () => {
  const value = snapshot([
    point(1, 0, 0),
    point(2, 40, 0),
    line(3, 1, 2),
    point(4, 10, 0),
    point(5, 30, 0),
    point(6, 20, 0.01),
    point(7, 50, 0),
  ]);
  const original = structuredClone(value);
  const parts = segments(value);
  assert.deepEqual(intervals(parts), [
    [0, 0.25],
    [0.25, 0.75],
    [0.75, 1],
  ]);
  assert.equal(parts[1].start.endpoint.point.id, 4);
  assert.equal(parts[1].end.endpoint.point.id, 5);
  assert.deepEqual(value, original);
  assert.equal(sketchSegmentDistance([20, 2], parts[1]), 2);
  assert.equal(sketchSegmentDistance([0, 0], parts[1]), 10);
});

test('proper crossings partition both finite lines, not their infinite extensions', () => {
  const value = snapshot([
    point(1, 0, 0),
    point(2, 40, 0),
    line(3, 1, 2),
    point(4, 20, -10),
    point(5, 20, 10),
    line(6, 4, 5),
    point(7, 60, -10),
    point(8, 60, 10),
    line(9, 7, 8),
  ]);
  const parts = segments(value);
  assert.deepEqual(intervals(parts.filter(p => p.id === 3)), [
    [0, 0.5],
    [0.5, 1],
  ]);
  assert.deepEqual(intervals(parts.filter(p => p.id === 6)), [
    [0, 0.5],
    [0.5, 1],
  ]);
  assert.deepEqual(intervals(parts.filter(p => p.id === 9)), [[0, 1]]);
  assert.deepEqual(parts[0].end.endpoint, {position: [20, 0]});
});

test('T junctions, duplicate points, and overlapping endpoints do not create empty intervals', () => {
  const value = snapshot([
    point(1, 40, 0),
    point(2, 0, 0),
    line(3, 1, 2),
    point(4, 10, 0),
    point(5, 30, 0),
    line(6, 4, 5),
    point(7, 10, 0),
    point(8, 10, 20),
    line(9, 7, 8),
  ]);
  const parts = segments(value);
  assert.deepEqual(intervals(parts.filter(p => p.id === 3)), [
    [0, 0.25],
    [0.25, 0.75],
    [0.75, 1],
  ]);
  assert.deepEqual(intervals(parts.filter(p => p.id === 6)), [[0, 1]]);
  assert.deepEqual(intervals(parts.filter(p => p.id === 9)), [[0, 1]]);
  assert.equal(parts[1].end.endpoint.point.id, 4);
});

test('line partitioning handles translated small and large models and shallow crossings', () => {
  for (const scale of [1e-6, 1, 1e6]) {
    const p = (id, x, y) => point(id, (x + 100) * scale, (y - 200) * scale);
    const value = snapshot([
      p(1, 0, 0),
      p(2, 40, 0),
      line(3, 1, 2),
      p(4, 0, -0.0001),
      p(5, 40, 0.0001),
      line(6, 4, 5),
    ]);
    const parts = segments(value).filter(p => p.id === 3);
    assert.equal(parts.length, 2);
    assert.ok(Math.abs(parts[0].end.t - 0.5) < 1e-7);
  }
});

test('zero-length lines add no artificial cuts or nonfinite hit distances', () => {
  const value = snapshot([
    point(1, 10, 0),
    point(2, 10, 0),
    line(3, 1, 2),
    point(4, 0, 0),
    point(5, 20, 0),
    line(6, 4, 5),
  ]);
  assert.deepEqual(intervals(segments(value)), [
    [0, 0.5],
    [0.5, 1],
  ]);
});

test('end trims keep the line ID and remove its length, while complete deletion removes directions', () => {
  const value = snapshot(
    [point(1, 0, 0), point(2, 40, 0), line(3, 1, 2), point(4, 20, 0)],
    [
      ['horizontal', 3],
      ['length', 3, 40],
      ['angle', 3, 0],
      ['fixed', ref(1)],
    ],
  );
  const parts = segments(value);
  for (const [index, expected] of [
    [0, [ref(4), ref(2)]],
    [1, [ref(1), ref(4)]],
  ]) {
    const change = trimSketchSegment([value], parts[index]);
    assert.deepEqual(change.entries, [['line', 3, expected]]);
    assert.deepEqual(change.ids, [3, index + 1]);
    assert.deepEqual(change.constraints, index === 0 ? [3] : []);
    assert.deepEqual(change.constraintReplacements, [
      {index: 0, ids: [3]},
      {index: 1, ids: []},
      {index: 2, ids: [3]},
    ]);
  }
  const whole = {...value, entities: value.entities.filter(e => e.id !== 4)};
  const change = trimSketchSegment([whole], segments(whole)[0]);
  assert.deepEqual(change.ids, [3, 1, 2]);
  assert.deepEqual(change.constraints, [3]);
  assert.deepEqual(change.entries, []);
  assert.ok(change.constraintReplacements.every(c => !c.ids.length));
});

test('multi-interval trim merges adjacent survivors and keeps circle wraparound as one surviving arc', () => {
  const local = snapshot([
    point(1, 0, 0),
    point(2, 10, 0),
    point(3, 0, 10),
    point(4, -10, 0),
    point(5, 0, -10),
    {kind: 'circle', id: 6, center: ref(1), radius: 10},
  ]);
  const picks = sketchSegments(
    [local],
    local.entities
      .filter(e => e.kind === 'point')
      .map(p => ({...p, layer: 'local'})),
  );
  const change = trimSketchSegment([local], [picks[1], picks[2]]);
  const arcs = change.entries.filter(e => e[0] === 'arc');
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0][1], 6);
  assert.deepEqual(arcs[0][2], [ref(1), 10, ref(3), ref(5), 'cw']);
  assert.ok(change.ids.includes(4));
  assert.ok(!change.ids.includes(1));
  const split = trimSketchSegment([local], [picks[0], picks[2]]);
  assert.deepEqual(
    split.entries.filter(e => e[0] === 'arc').map(e => e[1]),
    [7, 8],
  );
});

test('mixed point and interval deletion creates a valid boundary without dangling deleted point references', () => {
  const local = snapshot([
    point(1, 0, 0),
    point(2, 40, 0),
    point(3, 10, 0),
    point(4, 20, 0),
    line(5, 1, 2),
  ]);
  const change = trimSketchSegment([local], segments(local)[1], [4]);
  assert.ok(change.ids.includes(4));
  assert.ok(change.entries.some(e => e[0] === 'point' && e[2][0] === 20));
  assert.ok(
    change.entries
      .filter(e => e[0] === 'line')
      .every(e => e[2].every(p => p.id !== 4)),
  );
});

test('middle trims retire the original line and allocate two fresh IDs without renumbering points', () => {
  const value = snapshot(
    [
      point(1, 0, 0),
      point(2, 40, 0),
      point(3, 10, 0),
      point(4, 30, 0),
      line(5, 1, 2),
    ],
    [
      ['vertical', 5],
      ['length', 5, 40],
      ['angle', 5, 0],
    ],
  );
  const change = trimSketchSegment([value], segments(value)[1]);
  assert.deepEqual(change.ids, [5]);
  assert.deepEqual(change.entries, [
    ['line', 6, [ref(1), ref(3)]],
    ['line', 7, [ref(4), ref(2)]],
  ]);
  assert.deepEqual(change.constraintReplacements, [
    {index: 0, ids: [6, 7]},
    {index: 1, ids: []},
    {index: 2, ids: [6, 7]},
  ]);
  assert.deepEqual(
    change.replacements.map(r => r.original.id),
    [5],
  );
});

test('intersections become ordinary local endpoints only when a segment is deleted', () => {
  const value = snapshot([
    point(1, 0, 0),
    point(2, 40, 0),
    line(3, 1, 2),
    point(4, 10, -10),
    point(5, 10, 10),
    line(6, 4, 5),
    point(7, 30, -10),
    point(8, 30, 10),
    line(9, 7, 8),
  ]);
  const change = trimSketchSegment(
    [value],
    segments(value).filter(s => s.id === 3)[1],
  );
  assert.deepEqual(change.entries, [
    ['point', 10, [10, 0]],
    ['line', 11, [ref(1), ref(10)]],
    ['point', 12, [30, 0]],
    ['line', 13, [ref(12), ref(2)]],
  ]);
  assert.deepEqual(
    value.entities.filter(e => e.kind === 'line').map(e => e.id),
    [3, 6, 9],
  );
});

test('upstream points are referenceable boundaries, with local identities preferred at the same location', () => {
  const base = snapshot([point(1, 20, 0)], [], 'base');
  const local = snapshot([point(1, 0, 0), point(2, 40, 0), line(3, 1, 2)]);
  const change = trimSketchSegment([base, local], segments(base, local)[0]);
  assert.deepEqual(change.entries, [['line', 3, [ref(1, 'base'), ref(2)]]]);
  const coincident = {...local, entities: [...local.entities, point(4, 20, 0)]};
  assert.equal(segments(base, coincident)[0].end.endpoint.point.layer, 'local');
});

test('whole-line deletion keeps shared endpoints, geometric T junctions and unrelated standalone points', () => {
  for (const shared of [1, 4]) {
    const value = snapshot([
      point(1, 0, 0),
      point(2, 0, 20),
      line(3, 1, 2),
      point(4, -20, 0),
      point(5, 20, 0),
      line(6, shared, 5),
      point(7, 50, 50),
    ]);
    const change = trimSketchSegment(
      [value],
      segments(value).find(s => s.id === 3),
    );
    assert.deepEqual(change.ids, [3, 2]);
  }
});

test('deleting a point prunes newly disconnected line endpoints and their point constraints only', () => {
  const value = snapshot(
    [
      point(1, 0, 0),
      point(2, 20, 0),
      point(3, 0, 20),
      point(4, 20, 20),
      line(5, 1, 2),
      line(6, 1, 3),
      line(7, 3, 4),
      point(8, 70, 70),
    ],
    [
      ['fixed', ref(1)],
      ['x', ref(2), 20],
      ['y', ref(2), 0],
      ['coincident', [ref(1), ref(2)]],
      ['midpoint', [ref(8), ref(1), ref(4)]],
      ['horizontal', 5],
      ['vertical', 6],
      ['length', 5, 20],
      ['angle', 6, 90],
      ['fixed', ref(3)],
      ['horizontal', 7],
      ['x', ref(8), 70],
    ],
  );
  assert.deepEqual(deleteSketchEntity([value], 1), {
    kind: 'delete',
    ids: [1, 5, 6, 2],
    constraints: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  });
});

test('orphan cleanup respects upstream ownership and counts connections on upstream lines', () => {
  const base = snapshot(
    [
      point(1, -20, 0),
      point(2, 20, 0),
      {...line(3, 1, 2), points: [ref(1, 'base'), ref(2, 'base')]},
    ],
    [],
    'base',
  );
  const local = snapshot([
    point(1, 0, 0),
    point(2, 0, 20),
    line(3, 1, 2),
    {...line(4, 1, 2), points: [ref(1, 'base'), ref(2)]},
  ]);
  assert.deepEqual(deleteSketchEntity([base, local], 2).ids, [2, 3, 4]);
});

test('vertex deletion also prunes points that geometrically subdivided its removed lines', () => {
  const value = snapshot([
    point(1, 0, 0),
    point(2, 40, 0),
    line(3, 1, 2),
    point(4, 20, 0),
    point(5, 20, 1),
  ]);
  assert.deepEqual(deleteSketchEntity([value], 1).ids, [1, 3, 2, 4]);
});
