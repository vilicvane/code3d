import type {EmbindHandle} from '@code3d/opencascade';
import {
  defined,
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';
import type {Model} from '@code3d/core';

import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {getOC, measureShapeVolumeProperties} from 'replicad';
import {
  box,
  circle,
  cylinder,
  loft,
  rectangle,
  regularPolygon,
  sphere,
  union,
} from '../bld/node/index.js';
import {sameTopologyId} from '../bld/tooling/index.js';
import {
  clearKernelOperationCache,
  kernelOperationCacheStats,
} from '../bld/library/kernel-cache.js';
import {shapeSubshapes} from '../bld/library/kernel-shapes.js';

afterEach(() => clearKernelOperationCache());

function volume(model: Model) {
  const properties = measureShapeVolumeProperties(
    modelGeometry(model).value.shape.asShape3D(),
  );
  try {
    return properties.volume;
  } finally {
    properties.delete();
  }
}

function closeTo(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
}

function assertSolid(model: Model, expectedShells = 1) {
  const oc = getOC();
  const shape = modelGeometry(model).value.shape.wrapped;
  assert.equal(shape.ShapeType(), oc.TopAbs_ShapeEnum.TopAbs_SOLID);
  const check = new oc.BRepCheck_Analyzer(shape, true, false, false);
  const shells = new oc.TopExp_Explorer(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_SHELL,
  );
  try {
    assert.ok(check.IsValid());
    let count = 0;
    while (shells.More()) {
      count++;
      shells.Next();
    }
    assert.equal(count, expectedShells);
  } finally {
    shells.delete();
    check.delete();
  }
}

test('inward shell creates uniform walls and one or multiple openings without changing its input', () => {
  const base = box(30, 20, 10);
  const open = base.shell(1, [6]);
  const through = base.shell(1, [5, 6]);
  try {
    assertSolid(open);
    assertSolid(through);
    closeTo(volume(base), 6000);
    closeTo(volume(open), 6000 - 28 * 18 * 9);
    closeTo(volume(through), 6000 - 28 * 18 * 10);
    assert.deepEqual(
      modelGeometry(open).value.localBounds,
      modelGeometry(base).value.localBounds,
    );
    assert.equal(open.surfaces().length, 11);
    assert.equal(through.surfaces().length, 10);
    const snapshot = createModelSnapshotter();
    const operation = snapshot(open).operation;
    assert.equal(operation.kind, 'shell');
    assert.deepEqual(operation.selections, [
      {
        kind: 'surface',
        inputNodeId: snapshot(base).nodeId,
        ids: [6],
      },
    ]);
  } finally {
    disposeModelObjects([base, open, through]);
  }
});

test('omitted and empty openings form enclosed box and spherical cavities', () => {
  const base = box(30, 20, 10);
  const ball = sphere(10);
  const closed = base.shell(1);
  const explicit = base.shell(1, []);
  const hollowBall = ball.shell(1);
  try {
    assertSolid(closed, 2);
    assertSolid(hollowBall, 2);
    closeTo(volume(closed), 6000 - 28 * 18 * 8);
    closeTo(volume(hollowBall), (4 * Math.PI * (1000 - 729)) / 3);
    assert.equal(modelGeometry(closed).id, modelGeometry(explicit).id);
    assert.deepEqual(
      modelGeometry(closed).value.localBounds,
      modelGeometry(base).value.localBounds,
    );
  } finally {
    disposeModelObjects([base, ball, closed, explicit, hollowBall]);
  }
});

test('negative thickness offsets outward with rounded joins and preserves the original boundary', () => {
  const base = box(30, 20, 10);
  const open = base.shell(-1, [6]);
  const closed = base.shell(-1);
  try {
    assertSolid(open);
    assertSolid(closed, 2);
    closeTo(volume(closed), 2200 + 60 * Math.PI + (4 * Math.PI) / 3);
    const bounds = modelGeometry(open).value.localBounds;
    for (const [axis, min, max] of [
      [0, -16, 16],
      [1, -11, 11],
      [2, -6, 5],
    ]) {
      closeTo(bounds[0][axis], min);
      closeTo(bounds[1][axis], max);
    }
    for (const id of modelGeometry(base).value.topology.surfaces.ids) {
      assert.ok(typeof id === 'number');
      assert.ok(
        modelGeometry(closed).value.topology.surfaces.ids.some(candidate =>
          sameTopologyId(candidate, [1, id]),
        ),
      );
    }
  } finally {
    disposeModelObjects([base, open, closed]);
  }
});

test('curved walls and connected boolean operands can be shelled', () => {
  const stock = cylinder(10, 20);
  const a = box(30, 20, 10);
  const b = box(20, 20, 20);
  const joined = union([a, b]);
  const cup = stock.shell(1, [2]);
  const body = joined.shell(1);
  try {
    assertSolid(cup);
    assertSolid(body, 2);
    closeTo(volume(cup), Math.PI * (100 * 20 - 81 * 19));
  } finally {
    disposeModelObjects([stock, a, b, joined, cup, body]);
  }
});

test('bent spline lofts can form offset walls', () => {
  const start = circle(20);
  const via = circle(20).relate(profile =>
    profile.on(start.up).pivot(50, 0, 0).rotate(0, 0, 45),
  );
  const end = circle(20).relate(profile =>
    profile.on(start.up).pivot(50, 0, 0).rotate(0, 0, 90),
  );
  const base = loft([start, via, end]);
  const hollow = base.shell(2, [
    [1, 1],
    [3, 1],
  ]);
  try {
    assertSolid(hollow);
    assert.ok(volume(hollow) > 0);
    assert.ok(volume(hollow) < volume(base));
    assert.ok(hollow.surfaces().length > base.surfaces().length);
  } finally {
    disposeModelObjects([start, via, end, base, hollow]);
  }
});

test('a mixed-profile loft can enclose a cavity even when its open shell produces no walls', () => {
  const start = circle(20);
  const via = regularPolygon(20, 8).relate(profile =>
    profile.on(start.up).pivot(50, 0, 0).rotate(0, 0, 45),
  );
  const end = rectangle(40, 40).relate(profile =>
    profile.on(start.up).pivot(50, 0, 0).rotate(0, 0, 90),
  );
  const base = loft([start, via, end]);
  try {
    assertSolid(base);
    const originalVolume = volume(base);
    const before = kernelOperationCacheStats().entries;
    for (const thickness of [2, 0.5]) {
      // OCCT reports IsDone/IsValid, but returns the original solid without
      // generated walls. Reducing the thickness does not resolve this case.
      assert.throws(
        () =>
          base.shell(thickness, [
            [1, 1],
            [3, 1],
          ]),
        /S\[1,1\], S\[3,1\]\.\nOpenCascade generated no offset walls.*not hollow/,
      );
    }
    assert.equal(kernelOperationCacheStats().entries, before);
    closeTo(volume(base), originalVolume);
    assert.ok(defined(createModelSnapshotter()(base).mesh).triangles.length);
    const closed = base.shell(2);
    try {
      assertSolid(closed, 2);
      assert.ok(volume(closed) > 0);
      assert.ok(volume(closed) < originalVolume);
      // Spline-offset bounding boxes can overestimate the solid. Verify that
      // the actual outer boundary faces survive the cavity subtraction.
      const outerFaces = shapeSubshapes(
        modelGeometry(base).value.shape,
        'face',
      );
      const resultFaces = shapeSubshapes(
        modelGeometry(closed).value.shape,
        'face',
      );
      try {
        assert.ok(
          outerFaces.every(outer =>
            resultFaces.some(face => face.wrapped.IsSame(outer.wrapped)),
          ),
        );
      } finally {
        outerFaces.forEach(face => face.delete());
        resultFaces.forEach(face => face.delete());
      }
    } finally {
      disposeModelObjects([closed]);
    }
  } finally {
    disposeModelObjects([start, via, end, base]);
  }
});

test('shell preserves one-to-one topology and caches canonical selections through independent lifetimes', () => {
  const base = box(30, 20, 10);
  const first = base.shell(1, [6, 5, 6]);
  const second = base.shell(1, [5, 6]);
  const thicker = base.shell(2, [5, 6]);
  const rotated = first.rotate(15, 25, 35);
  const moved = rotated.scaled(2);
  try {
    assert.equal(modelGeometry(first).id, modelGeometry(second).id);
    assert.notEqual(modelGeometry(first).id, modelGeometry(thicker).id);
    assert.notEqual(
      modelGeometry(first).value.shape,
      modelGeometry(second).value.shape,
    );
    const topology = modelGeometry(first).value.topology;
    assert.deepEqual(topology, modelGeometry(second).value.topology);
    assert.deepEqual(topology, modelGeometry(moved).value.topology);
    for (const id of [1, 2, 3, 4])
      assert.ok(
        topology.surfaces.ids.some(candidate =>
          sameTopologyId(candidate, [1, id]),
        ),
      );
    // A removed cap's one-to-one Modified history identifies the remaining rim.
    for (const id of [5, 6])
      assert.ok(
        topology.surfaces.ids.some(candidate =>
          sameTopologyId(candidate, [1, id]),
        ),
      );
    assert.ok(topology.surfaces.ids.some(id => typeof id === 'number'));
    clearKernelOperationCache();
    const replay = base.shell(1, [5, 6]);
    try {
      assert.deepEqual(modelGeometry(replay).value.topology, topology);
      closeTo(volume(second), 960);
      closeTo(volume(replay), 960);
    } finally {
      disposeModelObjects([replay]);
    }
  } finally {
    disposeModelObjects([base, first, second, thicker, rotated, moved]);
  }
});

test('cached shells remain usable after the preceding model is disposed', () => {
  const base = box(30, 20, 10);
  for (const ids of [[], [6]]) {
    const first = base.shell(1, ids);
    const expectedVolume = volume(first);
    disposeModelObjects([first]);
    const repeat = base.shell(1, ids);
    try {
      closeTo(volume(repeat), expectedVolume);
      assertSolid(repeat, ids.length ? 1 : 2);
    } finally {
      disposeModelObjects([repeat]);
    }
  }
  disposeModelObjects([base]);
});

test('shell rejects invalid thickness, retired IDs and removing every face', () => {
  const base = box(30, 20, 10);
  try {
    for (const thickness of [0, NaN, Infinity, -Infinity]) {
      assert.throws(() => base.shell(thickness), /nonzero finite/);
    }
    for (const id of [0, -1, 1.5, NaN]) {
      assert.throws(
        () => base.shell(1, [id]),
        /Surface IDs must be positive integers/,
      );
    }
    assert.throws(() => base.shell(1, [7]), /Unknown or retired surface S7/);
    assert.throws(
      () => base.shell(1, [1, 2, 3, 4, 5, 6]),
      /At least one surface must remain/,
    );
  } finally {
    disposeModelObjects([base]);
  }
});

test('failed offsets never enter the cache and leave inputs usable for correction', () => {
  const base = box(30, 20, 10);
  const rounded = base.fillet(2);
  try {
    const before = kernelOperationCacheStats().entries;
    for (let i = 0; i < 2; i++) {
      assert.throws(() => base.shell(11, [6]), /generated no offset walls/);
      assert.throws(() => base.shell(11), /Could not construct shell/);
      // OCCT reports IsDone on this offset but its face topology is invalid.
      assert.throws(
        () => rounded.shell(1, [[1, 6]]),
        /invalid or self-intersecting/,
      );
    }
    assert.equal(kernelOperationCacheStats().entries, before);
    const corrected = base.shell(1, [6]);
    try {
      assertSolid(corrected);
      closeTo(volume(base), 6000);
    } finally {
      disposeModelObjects([corrected]);
    }
  } finally {
    disposeModelObjects([base, rounded]);
  }
});

test('disconnected boolean results cannot be shelled as one solid', () => {
  const a = box(10, 10, 10);
  const shiftedOrigin = a.originOffset(30, 0, 0);
  const b = shiftedOrigin.rotate(0, 0, 180);
  const disconnected = union([a, b]);
  try {
    assert.throws(() => disconnected.shell(1), /one connected solid/);
  } finally {
    disposeModelObjects([a, shiftedOrigin, b, disconnected]);
  }
});

test('shell releases native builders, analyzers and volume properties on success and failure', t => {
  const oc = getOC();
  const handles: EmbindHandle[] = [];
  for (const name of [
    'BRepOffsetAPI_MakeThickSolid',
    'BRepOffsetAPI_MakeOffsetShape',
    'BRepCheck_Analyzer',
    'GProp_GProps',
  ] as const) {
    t.mock.property(
      oc,
      name,
      new Proxy(oc[name], {
        construct(target, args) {
          const value = Reflect.construct(target, args) as InstanceType<
            typeof target
          >;
          handles.push(value);
          return value;
        },
      }),
    );
  }
  const base = box(30, 20, 10);
  const outputs = [];
  try {
    for (const thickness of [1, -1]) {
      outputs.push(base.shell(thickness), base.shell(thickness, [6]));
    }
    assert.throws(() => base.shell(11, [6]), /Could not construct shell/);
    assert.throws(() => base.shell(11), /Could not construct shell/);
    assert.ok(handles.length > 20);
    assert.ok(handles.every(handle => handle.isDeleted()));
    for (const output of outputs)
      assert.ok(
        defined(createModelSnapshotter()(output).mesh).triangles.length,
      );
  } finally {
    disposeModelObjects([base, ...outputs]);
  }
});
