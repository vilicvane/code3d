import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';

let server, sketchConstraintDisplays;
before(async () => {
  server = await createAppTestServer();
  ({sketchConstraintDisplays} = await server.ssrLoadModule(
    '/src/tools/sketch-constraints.ts',
  ));
});
after(async () => server?.close());
const ref = (id, layer = 'local') => ({layer, id});
const point = (id, position, layer = 'local') => ({
  ...ref(id, layer),
  position,
});
const line = (id, a, b) => ({kind: 'line', id, points: [a, b]});
const layer = (id, entities, constraints) => ({
  id,
  entities,
  constraints,
  degreesOfFreedom: 0,
  redundant: [],
});

test('every persistent constraint exposes its actual participants and value, without changing snapshots', () => {
  const points = [point(1, [0, 0]), point(2, [40, 0]), point(3, [20, 0])];
  const constraints = [
    ['fixed', ref(1)],
    ['horizontal', 4],
    ['vertical', 4],
    ['coincident', [ref(1), ref(2)]],
    ['midpoint', [ref(3), ref(1), ref(2)]],
    ['length', [4, 40]],
    ['angle', [4, 180]],
    ['x', [ref(1), -2]],
    ['y', [ref(2), 3.5]],
  ];
  const layers = [layer('local', [line(4, ref(1), ref(2))], constraints)];
  const before = structuredClone({layers, points});
  const displays = sketchConstraintDisplays(layers, points);
  assert.deepEqual(
    displays.map(d => d.kind),
    constraints.map(c => c[0]),
  );
  assert.equal(new Set(displays.map(d => d.key)).size, constraints.length);
  assert.deepEqual(
    displays.map(d => d.label),
    ['', '', '', '', '', '40', '180°', 'X=-2', 'Y=3.5'],
  );
  for (const index of [1, 2, 5, 6]) {
    assert.deepEqual(displays[index].line, ref(4));
    assert.deepEqual(displays[index].points, points.slice(0, 2));
    assert.deepEqual(displays[index].anchor, [20, 0]);
  }
  assert.deepEqual(displays[0].points, [points[0]]);
  assert.deepEqual(displays[3].guides, [
    [
      [0, 0],
      [40, 0],
    ],
  ]);
  assert.deepEqual(displays[4].points, [points[2], points[0], points[1]]);
  assert.deepEqual(displays[4].guides, [
    [
      [20, 0],
      [0, 0],
    ],
    [
      [20, 0],
      [40, 0],
    ],
  ]);
  assert.deepEqual({layers, points}, before);
});

test('derived relations retain ownership and distinct upstream/local addresses with equal numeric IDs', () => {
  const upstream = point(1, [10, 20], 'base');
  const local = point(1, [30, 40]);
  const displays = sketchConstraintDisplays(
    [
      layer('base', [], [['fixed', ref(1, 'base')]]),
      layer(
        'local',
        [line(2, ref(1, 'base'), ref(1))],
        [
          ['coincident', [ref(1), ref(1, 'base')]],
          ['length', [2, 20]],
        ],
      ),
    ],
    [upstream, local],
  );
  assert.equal(displays[0].layer, 'base');
  assert.deepEqual(displays[0].points, [upstream]);
  assert.equal(displays[1].layer, 'local');
  assert.deepEqual(displays[1].points, [local, upstream]);
  assert.match(displays[1].title, /point 1 \(upstream\)/);
  assert.deepEqual(displays[2].line, ref(2));
  assert.deepEqual(displays[2].points, [upstream, local]);
});

test('preview positions move glyphs and midpoint guides without inventing drag locks or extra rectangle relations', () => {
  const layers = [layer('local', [], [['midpoint', [ref(1), ref(2), ref(3)]]])];
  const start = sketchConstraintDisplays(layers, [
    point(1, [0, 0]),
    point(2, [-10, -10]),
    point(3, [10, 10]),
  ]);
  const next = sketchConstraintDisplays(layers, [
    point(1, [5, 5]),
    point(2, [-15, -5]),
    point(3, [25, 15]),
  ]);
  assert.equal(next.length, 1);
  assert.equal(next[0].key, start[0].key);
  assert.deepEqual(next[0].anchor, [5, 5]);
  assert.deepEqual(next[0].guides, [
    [
      [5, 5],
      [-15, -5],
    ],
    [
      [5, 5],
      [25, 15],
    ],
  ]);
  assert.deepEqual(
    sketchConstraintDisplays([layer('local', [], [])], [point(1, [0, 0])]),
    [],
  );
});
