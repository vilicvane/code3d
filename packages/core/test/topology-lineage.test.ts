import {
  defined,
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';
import type {Model} from '@code3d/core';

import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  bezier,
  box,
  circle,
  cut,
  intersect,
  loft,
  point,
  rectangle,
  regularPolygon,
  union,
} from '../bld/node/index.js';
import {
  isTopologyId,
  sameTopologyId,
  TopologyIdSet,
} from '../bld/tooling/index.js';
import {
  clearKernelOperationCache,
  kernelOperationCacheStats,
} from '../bld/library/kernel-cache.js';
import {
  topologySurfaceDirections,
  withTopologyShape,
} from '../bld/library/topology.js';

afterEach(() => clearKernelOperationCache());

test('topology paths compare by value and reject malformed author IDs', () => {
  const ids = new TopologyIdSet([1, [1, 1], [1, 1], [1, 2, 1]]);
  assert.equal(ids.size, 3);
  assert.ok(ids.has(structuredClone([1, 1])));
  assert.ok(!sameTopologyId(1, [1, 1]));
  const model = box(8, 8, 8).fillet(0.5, [1]);
  try {
    assert.deepEqual(model.surface([1, 1]).id, [1, 1]);
    for (const id of [
      0,
      -1,
      1.5,
      NaN,
      [],
      [1],
      [1, 0],
      [1, [2, 3]],
      null,
      [1, , 3],
      ['1', 2],
    ]) {
      assert.equal(isTopologyId(id), false);
      assert.throws(
        // @ts-expect-error Malformed IDs must fail at runtime as well.
        () => model.surface(id),
        /IDs must be positive integers or paths/,
      );
    }
    assert.throws(
      () => model.surface([2, 1]),
      /Unknown or retired surface S\[2,1\]/,
    );
  } finally {
    disposeModelObjects([model]);
  }
});

for (const sides of [4, 5]) {
  test(`loft retains both caps and all section edges/vertices for ${sides} sides`, () => {
    const start = regularPolygon(5, sides);
    const location = point([0, 12, 0]);
    const end = regularPolygon(3, sides).relate(p => p.on(location.up));
    const before = createModelSnapshotter()(start).mesh;
    const result = loft([start, end]);
    try {
      const topology = modelGeometry(result).value.topology;
      assert.deepEqual(topology.surfaces.ids, [
        ...Array.from({length: sides}, (_, i) => i + 1),
        [1, 1],
        [2, 1],
      ]);
      for (const [input, y] of [
        [1, 0],
        [2, 12],
      ]) {
        const cap = result.surface([input, 1]);
        assert.equal(cap.edges().length, sides);
        assert.equal(cap.vertices().length, sides);
        for (let id = 1; id <= sides; id++) {
          assert.deepEqual(cap.edge([input, id]).id, [input, id]);
          assert.deepEqual(cap.vertex([input, id]).id, [input, id]);
        }
        const [{position}] = topologySurfaceDirections(
          modelGeometry(result).value.shape,
          topology.surfaces,
          [[input, 1]],
        );
        assert.ok(Math.abs(position[1] - y) < 1e-7);
      }
      assert.throws(
        () => result.surface([1, 1]).edge([2, 1]),
        /does not belong/,
      );
      assert.deepEqual(createModelSnapshotter()(start).mesh, before);
      assertMeshIds(result);
    } finally {
      disposeModelObjects([start, location, end, result]);
    }
  });
}

test('curved-spine loft recovers cap boundaries from generated topology', () => {
  const spine = bezier([
    [0, 0, 0],
    [0, 8, 0],
    [10, 16, 0],
    [10, 24, 0],
  ]);
  const start = rectangle(6, 4).relate(p => p.center.align(spine.start));
  const end = rectangle(4, 3).relate(p => p.center.align(spine.end));
  const result = loft([start, end], {spine});
  try {
    for (const input of [1, 2]) {
      const cap = result.surface([input, 1]);
      assert.deepEqual(
        new TopologyIdSet(cap.edges().map(edge => edge.id)).size,
        4,
      );
      for (let id = 1; id <= 4; id++) {
        assert.deepEqual(cap.edge([input, id]).id, [input, id]);
        assert.deepEqual(cap.vertex([input, id]).id, [input, id]);
      }
    }
    assertMeshIds(result);
  } finally {
    disposeModelObjects([spine, start, end, result]);
  }
});

test('mixed loft sections retire split edges and do not invent middle cap faces', () => {
  const start = circle(5);
  const middleLocation = point([0, 6, 0]);
  const endLocation = point([0, 12, 0]);
  const middle = regularPolygon(4, 6).relate(p => p.on(middleLocation.up));
  const end = rectangle(6, 4).relate(p => p.on(endLocation.up));
  const result = loft([start, middle, end]);
  try {
    assert.deepEqual(result.surface([1, 1]).id, [1, 1]);
    assert.deepEqual(result.surface([3, 1]).id, [3, 1]);
    assert.throws(() => result.surface([2, 1]), /Unknown or retired/);
    assert.throws(() => result.edge([1, 1]), /Unknown or retired/);
    assert.ok(result.surface([1, 1]).edges().length > 1);
    assertMeshIds(result);
  } finally {
    disposeModelObjects([
      start,
      middleLocation,
      endLocation,
      middle,
      end,
      result,
    ]);
  }
});

for (const operation of [
  union,
  intersect,
  (inputs: Parameters<typeof union>[0]) => cut(inputs[0], inputs.slice(1)),
]) {
  test(`${operation.name || 'cut'} preserves boundary contributions from both inputs`, () => {
    const left = box(10, 10, 10);
    const right = box(8, 8, 8).relate(p =>
      p.center.align(left.center).offset(6, 3, 2),
    );
    const result = operation([left, right]);
    try {
      const topology = modelGeometry(result).value.topology;
      for (const kind of ['surfaces', 'edges'] as const) {
        assert.ok(
          topology[kind].ids.some(id => Array.isArray(id) && id[0] === 1),
        );
        assert.ok(
          topology[kind].ids.some(id => Array.isArray(id) && id[0] === 2),
        );
      }
      assert.ok(topology.vertices.ids.some(id => typeof id === 'number'));
      assertMeshIds(result);
    } finally {
      disposeModelObjects([left, right, result]);
    }
  });
}

test('n-ary Boolean input paths exclude internal steps and cached prefixes remain reusable', () => {
  const first = box(4, 4, 4);
  const second = box(3, 3, 3).relate(p =>
    p.center.align(first.center).offset(10, 0, 0),
  );
  const third = box(2, 2, 2).relate(p =>
    p.center.align(first.center).offset(20, 0, 0),
  );
  const pair = union([first, second]);
  const before = kernelOperationCacheStats();
  const result = union([first, second, third]);
  const nested = union([pair, third]);
  const posed = nested.rotate(20, 30, 40).scaled(2);
  try {
    assert.ok(kernelOperationCacheStats().hits > before.hits);
    for (const [kind, count] of [
      ['surfaces', 6],
      ['edges', 12],
      ['vertices', 8],
    ] as const) {
      const ids = new TopologyIdSet(
        modelGeometry(result).value.topology[kind].ids,
      );
      assert.equal(ids.size, count * 3);
      for (const input of [1, 2, 3])
        for (let id = 1; id <= count; id++) assert.ok(ids.has([input, id]));
      const nestedIds = new TopologyIdSet(
        modelGeometry(nested).value.topology[kind].ids,
      );
      assert.ok(nestedIds.has([1, 1, 1]));
      assert.ok(nestedIds.has([1, 2, 1]));
      assert.ok(nestedIds.has([2, 1]));
    }
    assert.deepEqual(
      modelGeometry(posed).value.topology,
      modelGeometry(nested).value.topology,
    );
    assertMeshIds(posed);
  } finally {
    disposeModelObjects([first, second, third, pair, result, nested, posed]);
  }
});

test('splits and merges retire ambiguous sources instead of choosing an input', () => {
  const stock = box(10, 10, 10);
  const tool = box(2, 20, 20);
  const split = cut(stock, [tool]);
  const merged = union([stock, stock]);
  try {
    const {shape, topology} = modelGeometry(stock).value;
    const faces = topologySurfaceDirections(
      shape,
      topology.surfaces,
      topology.surfaces.ids,
    );
    const top =
      topology.surfaces.ids[faces.findIndex(face => face.direction[1] > 0.9)];
    assert.ok(typeof top === 'number');
    assert.throws(() => split.surface([1, top]), /Unknown or retired/);
    assert.ok(split.surfaces().some(face => typeof face.id === 'number'));
    for (const kind of ['surfaces', 'edges', 'vertices'] as const) {
      assert.ok(
        modelGeometry(merged).value.topology[kind].ids.every(
          id => typeof id === 'number',
        ),
      );
    }
  } finally {
    disposeModelObjects([stock, tool, split, merged]);
  }
});

test('single-input modifications prefix inherited paths and accept path selections', () => {
  const source = box(40, 10, 40);
  const rounded = source.fillet(2, [2, 3, 4, 6, 7, 8, 11, 12]);
  const chamfered = rounded.chamfer(1, [
    [1, 10],
    [1, 10],
  ]);
  try {
    assert.deepEqual(chamfered.surface([1, 1, 1]).id, [1, 1, 1]);
    assert.deepEqual(
      createModelSnapshotter()(chamfered).operation.selections[0].ids,
      [[1, 10]],
    );
    assert.throws(() => chamfered.edge([1, 1, 10]), /Unknown or retired/);
    assert.ok(modelGeometry(chamfered).value.topology.edges.ids.includes(1));
    assertMeshIds(chamfered);
  } finally {
    disposeModelObjects([source, rounded, chamfered]);
  }
});

function assertMeshIds(model: Model) {
  const mesh = structuredClone(createModelSnapshotter()(model).mesh);
  for (const [kind, ids] of [
    ['vertex', defined(mesh).vertexIds],
    ['edge', defined(mesh).edgeGroups.map(group => group.edgeId)],
    ['surface', defined(mesh).surfaceGroups.map(group => group.surfaceId)],
  ] as const) {
    const {shape, topology} = modelGeometry(model).value;
    for (const id of ids) {
      assert.ok(
        withTopologyShape(
          shape,
          topology,
          {kind, id},
          selected => !selected.wrapped.IsNull(),
        ),
      );
    }
  }
}

test('shell accepts loft cap paths and adds one operation level to retained boundaries', () => {
  const start = rectangle(28, 20);
  const end = rectangle(18, 12).relate(p => p.on(point([0, 32, 0]).up));
  const body = loft([start, end]);
  const hollow = body.shell(1, [
    [2, 1],
    [1, 1],
    [2, 1],
  ]);
  const repeated = body.shell(1, [
    [1, 1],
    [2, 1],
  ]);
  const closed = body.shell(1);
  try {
    assert.equal(modelGeometry(hollow).id, modelGeometry(repeated).id);
    assert.deepEqual(
      createModelSnapshotter()(hollow).operation.selections[0].ids,
      [
        [1, 1],
        [2, 1],
      ],
    );
    assert.deepEqual(closed.surface([1, 1, 1]).id, [1, 1, 1]);
    assert.deepEqual(closed.surface([1, 2, 1]).id, [1, 2, 1]);
    assert.ok(
      modelGeometry(closed).value.topology.surfaces.ids.some(
        id => typeof id === 'number',
      ),
    );
    assertMeshIds(hollow);
    assertMeshIds(closed);
  } finally {
    disposeModelObjects([start, end, body, hollow, repeated, closed]);
  }
});

test('ruled loft retains intermediate section edges without creating a cap', () => {
  const start = rectangle(20, 12);
  const middle = rectangle(14, 10).relate(p => p.on(point([0, 10, 0]).up));
  const end = rectangle(10, 6).relate(p => p.on(point([0, 20, 0]).up));
  const body = loft([start, middle, end], {ruled: true});
  try {
    for (const input of [1, 2, 3])
      for (let id = 1; id <= 4; id++) {
        assert.deepEqual(body.edge([input, id]).id, [input, id]);
        assert.deepEqual(body.vertex([input, id]).id, [input, id]);
      }
    assert.throws(() => body.surface([2, 1]), /Unknown or retired/);
    assert.deepEqual(body.surface([3, 1]).id, [3, 1]);
  } finally {
    disposeModelObjects([start, middle, end, body]);
  }
});
