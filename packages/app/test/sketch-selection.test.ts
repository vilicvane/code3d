import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {SketchCurve} from '@code3d/core/tooling';
import type {SketchSegment} from '../src/tools/sketch-segments.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let select: typeof import('../src/tools/sketch-selection.ts').boxSelectSketch;
before(async () => {
  server = await createAppTestServer();
  ({boxSelectSketch: select} = await server.ssrLoadModule<
    typeof import('../src/tools/sketch-selection.ts')
  >('/src/tools/sketch-selection.ts'));
});
after(async () => server?.close());

function segment(curve: SketchCurve, id = 1): SketchSegment {
  return {
    layer: 'local',
    id,
    kind: curve.kind,
    curve,
    start: {t: 0, endpoint: {position: [0, 0]}},
    end: {t: 1, endpoint: {position: [0, 0]}},
  };
}
const line = segment({
  kind: 'line',
  points: [
    [-10, 0],
    [10, 0],
  ],
});

test('window selection contains finite geometry while crossing selection intersects it', () => {
  const point = {layer: 'base', id: 2, position: [0, 0] as const};
  assert.deepEqual(select([point], [line], [-2, -2], [2, 2]), [point]);
  assert.deepEqual(select([point], [line], [2, -2], [-2, 2]), [point, line]);
  assert.deepEqual(select([], [line], [-10, -1], [10, 1]), [line]);
  assert.deepEqual(select([], [line], [2, 1], [-2, 2]), []);
});

test('circles and finite directed arcs use analytic intersections, not a bounding box', () => {
  const circle = segment({kind: 'circle', center: [0, 0], radius: 10});
  const arc = segment({
    kind: 'arc',
    center: [0, 0],
    radius: 10,
    start: 0,
    sweep: Math.PI / 2,
  });
  assert.deepEqual(select([], [circle], [2, -2], [-2, 2]), []);
  assert.deepEqual(select([], [arc], [3, 1], [1, 3]), []);
  assert.deepEqual(select([], [circle], [11, -1], [9, 1]), [circle]);
  assert.deepEqual(select([], [circle], [11, 0], [10, 1]), [circle]);
  assert.deepEqual(select([], [arc], [-9, -1], [-11, 1]), []);
  assert.deepEqual(select([], [arc], [-1, -1], [11, 11]), [arc]);
  const clockwise = segment({
    ...arc.curve,
    kind: 'arc',
    center: [0, 0],
    radius: 10,
    start: Math.PI / 2,
    sweep: -Math.PI / 2,
  });
  assert.deepEqual(select([], [clockwise], [8, 6], [6, 8]), [clockwise]);
});

test('individual trim intervals retain their identities and the input arrays stay unchanged', () => {
  const short = {
    ...segment({
      kind: 'line',
      points: [
        [-10, 0],
        [0, 0],
      ],
    }),
    end: {...line.end, t: 0.5},
  };
  const rest = {
    ...segment({
      kind: 'line',
      points: [
        [0, 0],
        [10, 0],
      ],
    }),
    start: {...line.start, t: 0.5},
  };
  const input = [short, rest];
  assert.deepEqual(select([], input, [-11, -1], [1, 1]), [short]);
  assert.deepEqual(input, [short, rest]);
});
