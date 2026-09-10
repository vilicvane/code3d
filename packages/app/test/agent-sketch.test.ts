import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {CompiledSketch} from '../src/model/sketch-trace.ts';
import {createAppTestServer} from './vite-test-server.ts';

test('sketch observations keep layer addresses, solved geometry, authored inputs and bounded pages distinct', async t => {
  const server = await createAppTestServer();
  t.after(() => server.close());
  const {observeSketch, inspectSketch, describeSketch} =
    await server.ssrLoadModule<typeof import('../src/agent/sketch.ts')>(
      '/src/agent/sketch.ts',
    );
  const base: CompiledSketch = {
    id: 'base',
    geometryId: 'base',
    frameNodeId: 'base-frame',
    context: [],
    entities: [
      {kind: 'point', id: 1, position: [0, 0]},
      {kind: 'circle', id: 2, center: {layer: 'base', id: 1}, radius: 20},
    ],
    constraints: [],
    degreesOfFreedom: 3,
    redundant: [],
    references: {},
    data: [],
  };
  const child: CompiledSketch = {
    id: 'child',
    geometryId: 'child',
    frameNodeId: 'child-frame',
    context: [],
    base: 'base',
    entities: [
      {kind: 'point', id: 1, position: [0, 0], alias: {layer: 'base', id: 1}},
      {kind: 'circle', id: 2, center: {layer: 'child', id: 1}, radius: 8},
    ],
    constraints: [
      ['radius', 2, 8],
      ['radius', 2, 8],
    ],
    degreesOfFreedom: 0,
    redundant: [1],
    references: {base: 'upstream'},
    data: [{id: 2, parameters: [3]}],
  };
  const models = observeSketch(
    'child',
    new Map([
      [base.id, base],
      [child.id, child],
      ['sibling', {...base, id: 'sibling'}],
    ]),
  );
  assert.deepEqual(
    models.map(model => [model.key, model.role, model.layer.id]),
    [
      ['s0', 'result', 'child'],
      ['s1', 'upstream', 'base'],
    ],
  );
  assert.deepEqual(describeSketch(models[0]).references, {base: 'upstream'});
  assert.deepEqual(describeSketch(models[0]).bounds, {
    min: [-8, -8],
    max: [8, 8],
    size: [16, 16],
  });
  const first = inspectSketch(models[0], {limit: 2});
  assert.equal(first.total, 5);
  assert.equal(first.nextOffset, 2);
  assert.equal(first.counts.region, 1);
  const circle = first.items.find(item => item.kind === 'circle')!;
  assert.equal(circle.radius, 8);
  assert.deepEqual(circle.authoredParameters, [3]);
  assert.deepEqual(circle.center, {layer: 'child', id: 1});
  const remaining = inspectSketch(models[0], {offset: 2});
  assert.equal(remaining.nextOffset, undefined);
  assert.deepEqual(remaining.items[1], {
    kind: 'constraint',
    index: 1,
    value: ['radius', 2, 8],
    redundant: true,
  });
  assert.deepEqual(
    remaining.items.find(item => item.kind === 'region')!.holes,
    [{curves: 1}],
  );
  assert.deepEqual(inspectSketch(models[0], {offset: 5}).items, []);
  assert.throws(() => inspectSketch(models[0], {kind: 'edge'}), {
    code: 'sketch_filter_unsupported',
  });
});

test('empty and open sketches remain observable, with finite analytic arcs and explicit region failures', async t => {
  const server = await createAppTestServer();
  t.after(() => server.close());
  const {inspectSketch, observeSketch} = await server.ssrLoadModule<
    typeof import('../src/agent/sketch.ts')
  >('/src/agent/sketch.ts');
  const empty: CompiledSketch = {
    id: 'empty',
    geometryId: 'empty',
    frameNodeId: 'empty-frame',
    context: [],
    entities: [],
    constraints: [],
    degreesOfFreedom: 0,
    redundant: [],
    references: {},
    data: [],
  };
  const result = inspectSketch(
    observeSketch('empty', new Map([['empty', empty]]))[0],
    {},
  );
  assert.equal(result.bounds, null);
  assert.equal(result.counts.region, 0);
  assert.deepEqual(result.items, []);
  const arc: CompiledSketch = {
    ...empty,
    id: 'arc',
    entities: [
      {kind: 'point', id: 1, position: [0, 0]},
      {kind: 'point', id: 2, position: [10, 0]},
      {kind: 'point', id: 3, position: [0, 10]},
      {
        kind: 'arc',
        id: 4,
        center: {layer: 'arc', id: 1},
        radius: 10,
        points: [
          {layer: 'arc', id: 2},
          {layer: 'arc', id: 3},
        ],
        direction: 'ccw',
      },
    ],
  };
  const open = inspectSketch(
    observeSketch('arc', new Map([['arc', arc]]))[0],
    {},
  );
  const geometry = open.items.find(item => item.kind === 'arc')!.geometry;
  assert.equal(geometry.kind, 'arc');
  assert.ok(Math.abs(geometry.sweep - Math.PI / 2) < 1e-10);
  assert.equal(open.regions.available, false);
  assert.ok(open.regions.reason);
  assert.equal(open.counts.region, null);
  assert.deepEqual(open.bounds, {min: [0, 0], max: [10, 10], size: [10, 10]});
});
