import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {
  SketchEntitySnapshot,
  SketchPosition,
  SketchSnapshot,
} from '@code3d/core/tooling';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let snap: typeof import('../src/tools/sketch-snap.ts');
before(async () => {
  server = await createAppTestServer();
  snap = await server.ssrLoadModule('/src/tools/sketch-snap.ts');
});
after(async () => server?.close());

const ref = (id: number, layer = 'local') => ({layer, id});
const point = (id: number, position: SketchPosition): SketchEntitySnapshot => ({
  kind: 'point',
  id,
  position,
});
const line = (id: number, a: number, b: number): SketchEntitySnapshot => ({
  kind: 'line',
  id,
  points: [ref(a), ref(b)],
});
const layer = (...entities: SketchEntitySnapshot[]): SketchSnapshot => ({
  id: 'local',
  entities,
  constraints: [],
  redundant: [],
  degreesOfFreedom: 0,
});
const context = (value: SketchSnapshot) => ({
  ...snap.sketchSnapTargets([value]),
  scale: 100,
  gridStep: 1,
  enabled: true,
});
const near = (a: SketchPosition, b: SketchPosition) =>
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9, `${a} != ${b}`);

test('finite line intersections and authored midpoints beat the grid without inventing references', () => {
  const value = layer(
    point(1, [1, 11]),
    point(2, [19, 11]),
    line(3, 1, 2),
    point(4, [7, 3]),
    point(5, [7, 23]),
    line(6, 4, 5),
  );
  const options = context(value);
  const intersection = snap.snapSketchPointer(
    [7.02, 11.01],
    {kind: 'cartesian'},
    options,
  );
  assert.equal(intersection.hint, 'Intersection');
  assert.deepEqual(intersection.endpoint, {position: [7, 11]});
  const midpoint = snap.snapSketchPointer(
    [10.02, 11.01],
    {kind: 'cartesian'},
    options,
  );
  assert.equal(midpoint.hint, 'Midpoint');
  assert.deepEqual(midpoint.endpoint, {position: [10, 11]});
  const disjoint = layer(
    ...value.entities.slice(0, 3),
    point(4, [7, 12]),
    point(5, [7, 23]),
    line(6, 4, 5),
  );
  assert.ok(
    !context(disjoint).features.some(
      feature => feature.hint === 'Intersection',
    ),
  );
});

test('line-circle, circle-circle, tangent and finite arc contacts use analytic curve positions', () => {
  const circle: SketchEntitySnapshot = {
    kind: 'circle',
    id: 2,
    center: ref(1),
    radius: 5,
  };
  const values = [
    layer(
      point(1, [0, 0]),
      circle,
      point(3, [3, -10]),
      point(4, [3, 10]),
      line(5, 3, 4),
    ),
    layer(point(1, [0, 0]), circle, point(3, [6, 0]), {
      kind: 'circle',
      id: 4,
      center: ref(3),
      radius: 5,
    }),
    layer(
      point(1, [0, 0]),
      point(2, [5, 0]),
      point(3, [0, 5]),
      {
        kind: 'arc',
        id: 4,
        center: ref(1),
        radius: 5,
        points: [ref(2), ref(3)],
        direction: 'ccw',
      },
      point(5, [3, -10]),
      point(6, [3, 10]),
      line(7, 5, 6),
    ),
  ];
  for (const value of values) {
    const result = snap.snapSketchPointer(
      [3.01, 4.02],
      {kind: 'cartesian'},
      context(value),
    );
    assert.equal(result.hint, 'Intersection');
    near(snap.endpointPosition(result.endpoint), [3, 4]);
  }
  const arcFeatures = context(values[2]).features;
  assert.equal(
    arcFeatures.filter(feature => feature.hint === 'Intersection').length,
    1,
  );
  near(arcFeatures.find(feature => feature.hint === 'Midpoint')!.position, [
    Math.SQRT1_2 * 5,
    Math.SQRT1_2 * 5,
  ]);
  const tangent = context(
    layer(
      point(1, [0, 0]),
      circle,
      point(3, [-10, 5]),
      point(4, [10, 5]),
      line(5, 3, 4),
    ),
  );
  assert.equal(
    tangent.features.filter(feature => feature.hint === 'Intersection').length,
    1,
  );
  assert.equal(
    snap.snapSketchPointer([0.02, 5.01], {kind: 'cartesian'}, tangent).hint,
    'Intersection',
  );
});

test('endpoints and centers retain identity, with local ownership preferred and circle quadrants available', () => {
  const base = {...layer(point(1, [0, 0])), id: 'base'};
  const local = layer(point(1, [0, 0]), {
    kind: 'circle',
    id: 2,
    center: ref(1),
    radius: 5,
  });
  const options = {...context(local), ...snap.sketchSnapTargets([base, local])};
  assert.deepEqual(
    snap.snapSketchPointer([0.01, 0.01], {kind: 'cartesian'}, options).endpoint,
    {point: {layer: 'local', id: 1, position: [0, 0]}},
  );
  assert.deepEqual(
    snap.snapSketchPointer([0.01, -5.02], {kind: 'cartesian'}, options),
    {endpoint: {position: [0, -5]}, hint: 'Quadrant'},
  );
});

test('screen tolerance, explicit coordinates and polar dimensions still govern feature snapping', () => {
  const options = {
    points: [],
    features: [{position: [3, 4] as const, hint: 'Intersection' as const}],
    scale: 100,
    gridStep: 1,
    enabled: true,
  };
  assert.equal(
    snap.snapSketchPointer([3.08, 4], {kind: 'cartesian'}, options).hint,
    'Intersection',
  );
  assert.notEqual(
    snap.snapSketchPointer([3.1, 4], {kind: 'cartesian'}, options).hint,
    'Intersection',
  );
  assert.equal(
    snap.snapSketchPointer(
      [3.01, 4],
      {kind: 'cartesian'},
      {...options, enabled: false},
    ).hint,
    undefined,
  );
  assert.notEqual(
    snap.snapSketchPointer([3.01, 4], {kind: 'cartesian', x: 3.02}, options)
      .hint,
    'Intersection',
  );
  assert.equal(
    snap.snapSketchPointer(
      [3.01, 4],
      {kind: 'polar', origin: [0, 0], length: 5},
      options,
    ).hint,
    'Intersection',
  );
  assert.notEqual(
    snap.snapSketchPointer(
      [3.01, 4],
      {kind: 'polar', origin: [0, 0], length: 5.1},
      options,
    ).hint,
    'Intersection',
  );
  assert.notEqual(
    snap.snapSketchPointer(
      [3.01, 4],
      {kind: 'polar', origin: [0, 0], direction: {kind: 'axis', axis: 'x'}},
      options,
    ).hint,
    'Intersection',
  );
});

test('drag candidates exclude aliases and curves owned by the dragged point', () => {
  const value = layer(
    point(1, [0, 0]),
    {kind: 'point', id: 2, position: [0, 0], alias: ref(1)},
    point(3, [10, 0]),
    line(4, 2, 3),
    {kind: 'circle', id: 5, center: ref(2), radius: 5},
    point(6, [10, 10]),
    point(7, [20, 10]),
    line(8, 6, 7),
  );
  const targets = snap.sketchSnapTargets([value], ref(1));
  assert.deepEqual(
    targets.points.map(point => point.id),
    [7, 6, 3],
  );
  assert.deepEqual(targets.features, [{position: [15, 10], hint: 'Midpoint'}]);
  const radiusTargets = snap.sketchSnapTargets([value], ref(5));
  assert.equal(radiusTargets.points.length, 5);
  assert.ok(
    !radiusTargets.features.some(feature => feature.hint === 'Quadrant'),
  );
});
