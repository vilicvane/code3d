import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  align,
  on,
  box,
  cut,
  cylinder,
  group,
  line,
  point,
  rectangle,
  rotate,
  type Model,
} from '@code3d/core';
import {
  clearKernelOperationCache,
  modelElementReference,
  rotateVector,
} from '@code3d/core/tooling';
import {
  repeat,
  linear,
  radial,
  flex,
  grid,
  fillFlex,
  fillGrid,
} from '@code3d/layout';
import {
  createModelSnapshotter,
  disposeModelObjects,
} from '../../core/test/model-test.ts';

const kept: Model[] = [];
const keep = <T extends Model>(model: T): T => (kept.push(model), model);
const retain = <T extends readonly Model[]>(models: T): T => (
  kept.push(...models),
  models
);
afterEach(() => {
  disposeModelObjects(kept.splice(0));
  clearKernelOperationCache();
});
const near = (actual: readonly number[], expected: readonly number[]) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < 1e-5,
      `${actual} != ${expected}`,
    ),
  );
};
const center = (model: Model) => {
  const {minimum, maximum} = model.bounds();
  return minimum.map((value, index) => (value + maximum[index]) / 2);
};
const snapshot = createModelSnapshotter();
const space = (x: number, z = 20) =>
  keep(box(x, 20, z).originOffset(-x / 2, 0, -z / 2));

test('space layouts follow a related construction frame without outputting its geometry', () => {
  const host = keep(
    box(4, 20, 50).relate(self => align(self.origin, point([20, 30, 40]))),
  );
  const target = keep(
    box(40, 10, 25).relate(self => [
      align(self.vertex(3), host.vertex(7)),
      rotate(20, 35, 15),
    ]),
  );
  const prototype = keep(box(2, 10, 5));
  for (const models of [
    flex(repeat(prototype, 4), target, {axis: 'x', gap: 5}),
    fillFlex(prototype, target, {axis: 'x', gap: 5}),
    grid(repeat(prototype, 4), target, {axes: ['x', 'z'], columns: 2, gap: 5}),
    fillGrid(prototype, target, {axes: ['x', 'z'], gap: 5}),
  ]) {
    retain(models);
    const targetPose = snapshot(target).compositionTransform;
    for (const model of models) {
      near(model.position(target), [0, 0, 0]);
      const pose = snapshot(model).compositionTransform;
      near(pose.position, targetPose.position);
      for (const axis of [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as const)
        near(
          rotateVector(axis, pose.quaternion),
          rotateVector(axis, targetPose.quaternion),
        );
      near(model.bounds(target).minimum, model.bounds().minimum);
    }
    const scene = keep(group([host, ...models]));
    const output = snapshot(scene);
    assert.equal(output.children.length, 1 + models.length);
    assert.equal(
      output.children.every(child => child.kind === 'solid'),
      true,
    );
    assert.equal(
      output.children.some(child => child.nodeId === snapshot(target).nodeId),
      false,
    );
  }
});

test('ventilation fins use the target vertex constraint and preserve its unused end space', () => {
  const leftSide = keep(
    box(4, 20, 50).relate(self => align(self.origin, point([20, 30, 40]))),
  );
  const target = keep(
    box(40, 10, 25).relate(self => align(self.vertex(3), leftSide.vertex(7))),
  );
  const fins = retain(
    fillFlex(keep(box(2, 10, 25)), target, {axis: 'x', gap: 5}),
  );
  assert.equal(fins.length, 6);
  near(fins[0].bounds(leftSide).minimum, target.bounds(leftSide).minimum);
  near(fins.at(-1)!.bounds(leftSide).maximum, [39, 10, 25]);
  const scene = keep(group([leftSide, ...fins]));
  assert.equal(snapshot(scene).children.length, 7);
});

test('repeat supplies an explicit quantity without changing geometry', () => {
  const model = keep(box(2, 4, 6).originOffset(3, 2, 1));
  const values = repeat(model, 3);
  assert.equal(values.length, 3);
  values.forEach(value => near(value.bounds().minimum, [-4, -4, -4]));
  near(model.bounds().minimum, [-4, -4, -4]);
  assert.deepEqual(repeat(model, 0), []);
  for (const count of [-1, 1.5, Infinity])
    assert.throws(() => repeat(model, count), /Count/);
});

test('linear preserves named references, topology and shared layout origins', () => {
  const original = keep(box(2, 4, 6));
  const named = keep(original.expose({mount: original.up}));
  const values = retain(linear(repeat(named, 3), {axis: 'z', step: -8}));
  const scene = keep(group(values));
  assert.equal(new Set(values).size, 3);
  const vertex = modelElementReference(named.vertex(1))!.transform.position;
  const mount = modelElementReference(named.mount)!.transform.position;
  values.forEach((model, index) => {
    near(center(model), [0, 0, -8 * index]);
    near(model.position(scene), [0, 0, 0]);
    near(modelElementReference(model.vertex(1))!.transform.position, [
      vertex[0],
      vertex[1],
      vertex[2] - 8 * index,
    ]);
    near(modelElementReference(model.mount)!.transform.position, [
      mount[0],
      mount[1],
      mount[2] - 8 * index,
    ]);
  });
  near(scene.bounds().size, [2, 4, 22]);
  near(named.bounds().minimum, [-1, -2, -3]);
});

test('linear steps are independent of input sizes and compose into multi-axis arrays', () => {
  const a = keep(box(2, 4, 6)),
    b = keep(box(8, 2, 4));
  const pair = retain(linear([a, b], {axis: 'x', step: 10}));
  near(pair[1].bounds().minimum, [6, -1, -2]);
  const row = keep(group(retain(linear(repeat(a, 2), {axis: 'x', step: 10}))));
  const layer = keep(
    group(retain(linear(repeat(row, 2), {axis: 'y', step: 20}))),
  );
  const volume = keep(
    group(retain(linear(repeat(layer, 2), {axis: 'z', step: -30}))),
  );
  near(volume.bounds().minimum, [-1, -2, -33]);
  near(volume.bounds().maximum, [11, 22, 3]);
  assert.equal(retain(linear([a, a], {axis: 'x', step: 0})).length, 2);
});

test('radial uses collection length, excludes circle duplicates and includes arc endpoints', () => {
  const seed = keep(box(2, 4, 6));
  const circle = retain(radial(repeat(seed, 4), {axis: 'y', radius: 10}));
  [
    [10, 0, 0],
    [0, 0, -10],
    [-10, 0, 0],
    [0, 0, 10],
  ].forEach((expected, i) => near(center(circle[i]), expected));
  const assembled = keep(group(circle));
  near(assembled.bounds().minimum, [-11, -2, -13]);
  near(assembled.bounds().maximum, [11, 2, 13]);
  circle.forEach(model => near(model.position(assembled), [0, 0, 0]));
  const arc = retain(
    radial([seed, seed, seed], {
      radius: 10,
      axis: 'z',
      startAngle: 90,
      sweepAngle: -180,
    }),
  );
  [
    [0, 10, 0],
    [10, 0, 0],
    [0, -10, 0],
  ].forEach((expected, i) => near(center(arc[i]), expected));
  near(
    center(retain(radial([seed], {radius: 4, axis: 'x', startAngle: 90}))[0]),
    [0, 0, 4],
  );
});

test('radial rotate is a boolean and prototype rotation supplies extra orientation', () => {
  const seed = keep(box(2, 4, 6).rotate(0, 0, 90).originOffset(-5, -7, -9));
  const fixed = retain(
    radial([seed], {radius: 10, axis: 'x', startAngle: 90}),
  )[0];
  const rotated = retain(
    radial([seed], {radius: 10, axis: 'x', startAngle: 90, rotate: true}),
  )[0];
  near(center(fixed), [5, 7, 19]);
  near(center(rotated), [5, -9, 17]);
  near(fixed.bounds().size, [4, 2, 6]);
  near(rotated.bounds().size, [4, 6, 2]);
  const fin = keep(box(12, 8, 3).rotate(0, 90, 0));
  const tangent = retain(
    radial([fin], {axis: 'y', radius: 30, startAngle: 90, rotate: true}),
  )[0];
  near(center(tangent), [0, 0, -30]);
  near(tangent.bounds().size, [12, 8, 3]);
  near(center(seed), [5, 7, 9]);
});

test('content-sized flex begins at local zero and preserves unspecified coordinates', () => {
  const models = [
    keep(box(2, 4, 6).originOffset(10, -7, -9)),
    keep(box(4, 2, 8)),
    keep(box(6, 6, 2)),
  ];
  const arranged = retain(flex(models, {axis: 'x', gap: 3}));
  near(
    arranged.map(model => model.bounds().minimum[0]),
    [0, 5, 12],
  );
  near(center(arranged[0]).slice(1), [7, 9]);
  near(keep(group(arranged)).bounds().size.slice(0, 1), [18]);
  near(models[0].bounds().minimum, [-11, 5, 6]);
});

for (const [justifyContent, first, last, gap] of [
  ['start', 5, 90, 5],
  ['center', 10, 95, 5],
  ['end', 15, 100, 5],
  ['space-between', 5, 100, 7],
  ['space-around', 5 + 5 / 6, 100 - 5 / 6, 5 + 10 / 6],
  ['space-evenly', 5 + 10 / 7, 100 - 10 / 7, 5 + 10 / 7],
] as const) {
  test(`flex and fillFlex share ${justifyContent} spacing inside asymmetric padding`, () => {
    const target = space(100),
      seed = keep(box(10, 20, 4));
    const config = {
      axis: 'x' as const,
      gap: 5,
      padding: {start: 5},
      justifyContent,
    };
    const filled = retain(fillFlex(seed, target, config));
    const supplied = retain(flex(repeat(seed, 6), target, config));
    assert.equal(filled.length, 6);
    const boxes = filled.map(model => model.bounds());
    near([boxes[0].minimum[0], boxes[5].maximum[0]], [first, last]);
    boxes
      .slice(1)
      .forEach((box, i) => near([box.minimum[0] - boxes[i].maximum[0]], [gap]));
    supplied.forEach((model, i) =>
      near(model.bounds().minimum, boxes[i].minimum),
    );
    const nested = keep(group([keep(group(filled))]));
    near(
      [nested.bounds().minimum[0], nested.bounds().maximum[0]],
      [first, last],
    );
  });
}

test('flex aligns to the container cross bounds instead of the first input', () => {
  const target = keep(box(20, 10, 40).originOffset(-10, -5, 0));
  const models = [
    keep(box(2, 2, 2).originOffset(0, -100, -7)),
    keep(box(4, 4, 2).originOffset(0, 100, 9)),
  ];
  for (const [alignItems, expected] of [
    ['start', [0, 0]],
    ['center', [4, 3]],
    ['end', [8, 6]],
  ] as const) {
    const items = retain(
      flex(models, target, {axis: 'x', crossAxis: 'y', alignItems, gap: 1}),
    );
    near(
      items.map(model => model.bounds().minimum[1]),
      expected,
    );
    near(
      items.map(model => center(model)[2]),
      [7, -9],
    );
  }
  const intrinsic = retain(
    flex(models, {
      axis: 'x',
      crossAxis: 'y',
      alignItems: 'center',
      crossPadding: 2,
    }),
  );
  near(
    intrinsic.map(model => model.bounds().minimum[1]),
    [3, 2],
  );
});

test('wrapped flex sizes each line independently and aligns lines in the cross interval', () => {
  const target = space(20, 20);
  const models = [keep(box(8, 2, 2)), keep(box(8, 4, 4)), keep(box(8, 6, 6))];
  const items = retain(
    flex(models, target, {
      axis: 'x',
      crossAxis: 'z',
      wrap: true,
      gap: 2,
      rowGap: 3,
      padding: 1,
      justifyContent: 'space-between',
      alignItems: 'end',
      alignContent: 'end',
    }),
  );
  near(
    items.map(model => model.bounds().minimum[0]),
    [1, 11, 1],
  );
  near(
    items.map(model => model.bounds().minimum[2]),
    [9, 7, 14],
  );
  near(
    items.map(model => center(model)[1]),
    [0, 0, 0],
  );
  const starts = retain(
    flex(models, target, {axis: 'x', crossAxis: 'z', wrap: true, gap: 2}),
  );
  near(
    starts.map(model => model.bounds().minimum[2]),
    [0, 0, 6],
  );
  assert.throws(
    () => flex(models, {axis: 'x', crossAxis: 'z', wrap: true}),
    /requires a target/,
  );
  assert.throws(
    () => flex(models, space(7), {axis: 'x', crossAxis: 'z', wrap: true}),
    /fit/,
  );
  assert.throws(
    () => flex(models, space(20, 5), {axis: 'x', crossAxis: 'z', wrap: true}),
    /fit/,
  );
});

test('fills count complete models without decimal quantization, including zero-width models', () => {
  const seed = keep(box(0.1, 2, 2)),
    target = space(0.3);
  assert.equal(retain(fillFlex(seed, target, {axis: 'x', gap: 0})).length, 3);
  assert.equal(
    retain(fillFlex(seed, space(0.3 - 1e-8), {axis: 'x', gap: 0})).length,
    2,
  );
  assert.equal(
    retain(fillFlex(seed, space(0.5), {axis: 'x', gap: 0.1})).length,
    3,
  );
  assert.deepEqual(fillFlex(target, seed, {axis: 'x', gap: 0}), []);
  const dot = keep(point());
  assert.equal(retain(fillFlex(dot, target, {axis: 'x', gap: 0.1})).length, 4);
  assert.throws(
    () => fillFlex(dot, target, {axis: 'x', gap: 0}),
    /positive model width or gap/,
  );
  assert.throws(() => flex(repeat(seed, 4), target, {axis: 'x'}), /fit/);
  assert.throws(
    () => fillFlex(seed, target, {axis: 'x', gap: 0, padding: 1}),
    /Padding/,
  );
});

test('flex singleton alignment and empty inputs preserve quantity', () => {
  const seed = keep(box(2, 2, 2)),
    target = space(12);
  for (const [justifyContent, expected] of [
    ['start', 0],
    ['center', 5],
    ['end', 10],
    ['space-between', 0],
    ['space-around', 5],
    ['space-evenly', 5],
  ] as const)
    near(
      retain(flex([seed], target, {axis: 'x', justifyContent}))[0]
        .bounds()
        .minimum.slice(0, 1),
      [expected],
    );
  assert.deepEqual(flex([], {axis: 'x'}), []);
  assert.deepEqual(flex([], keep(group([])), {axis: 'x'}), []);
  assert.deepEqual(linear([], {axis: 'x', step: 1}), []);
  assert.deepEqual(radial([], {axis: 'y', radius: 4}), []);
});

test('grid derives shared column widths and row heights from unequal inputs', () => {
  const models = [
    keep(box(2, 2, 4)),
    keep(box(4, 2, 2)),
    keep(box(6, 2, 8)),
    keep(box(8, 2, 6)),
  ];
  const items = retain(
    grid(models, {
      axes: ['x', 'z'],
      columns: 2,
      gap: 2,
      justifyItems: 'center',
      alignItems: 'end',
    }),
  );
  near(
    items.map(model => model.bounds().minimum[0]),
    [2, 10, 0, 8],
  );
  near(
    items.map(model => model.bounds().minimum[2]),
    [0, 2, 6, 8],
  );
  near(keep(group(items)).bounds().size, [16, 2, 14]);
  items.forEach((model, i) =>
    near(model.bounds().size, models[i].bounds().size),
  );
});

test('fixed and fractional grid tracks allocate cells without scaling models', () => {
  const seed = keep(box(10, 2, 4));
  const items = retain(
    grid(repeat(seed, 3), space(100, 10), {
      axes: ['x', 'z'],
      columns: [20, {fr: 1}, {fr: 2}],
      rows: [10],
      columnGap: 5,
      justifyItems: 'end',
      alignItems: 'end',
    }),
  );
  near(
    items.map(model => model.bounds().maximum[0]),
    [20, 25 + 70 / 3, 100],
  );
  near(
    items.map(model => model.bounds().maximum[2]),
    [10, 10, 10],
  );
  items.forEach(model => near(model.bounds().size, [10, 2, 4]));
});

test('fractional grid tracks respect minimum model widths before sharing the remainder', () => {
  const models = [keep(box(80, 2, 4)), keep(box(10, 2, 4))];
  const config = {
    axes: ['x', 'z'] as const,
    columns: [{fr: 1}, {fr: 1}],
    justifyItems: 'end' as const,
  };
  const bounded = retain(grid(models, space(100), config));
  near(
    bounded.map(model => model.bounds().minimum[0]),
    [0, 90],
  );
  const intrinsic = retain(grid(models, config));
  near(
    intrinsic.map(model => model.bounds().maximum[0]),
    [80, 160],
  );
  assert.throws(() => grid(models, space(89), config), /fit/);
});

test('grid distinguishes cell alignment from alignment of the whole grid', () => {
  const models = [
    keep(box(10, 2, 5)),
    keep(box(20, 2, 5)),
    keep(box(10, 2, 15)),
    keep(box(20, 2, 15)),
  ];
  const target = space(100, 80);
  const items = retain(
    grid(models, target, {
      axes: ['x', 'z'],
      columns: 2,
      gap: 5,
      justifyContent: 'end',
      alignContent: 'center',
    }),
  );
  near(
    items.map(model => model.bounds().minimum[0]),
    [65, 80, 65, 80],
  );
  near(
    items.map(model => model.bounds().minimum[2]),
    [27.5, 27.5, 37.5, 37.5],
  );
  const spread = retain(
    grid(models, target, {
      axes: ['x', 'z'],
      columns: 2,
      justifyContent: 'space-between',
      alignContent: 'space-between',
    }),
  );
  near(
    spread.map(model => model.bounds().minimum[0]),
    [0, 80, 0, 80],
  );
  near(
    spread.map(model => model.bounds().minimum[2]),
    [0, 0, 65, 65],
  );
});

test('grid adds implicit rows, respects axis order and preserves the third axis', () => {
  const seed = keep(box(2, 4, 6).originOffset(-9, 0, 0));
  const items = retain(
    grid(repeat(seed, 5), {
      axes: ['z', 'y'],
      columns: 2,
      rows: 1,
      gap: 3,
      padding: {columns: {start: 1}, rows: 2},
    }),
  );
  near(
    items.map(model => model.bounds().minimum[2]),
    [1, 10, 1, 10, 1],
  );
  near(
    items.map(model => model.bounds().minimum[1]),
    [2, 2, 9, 9, 16],
  );
  near(
    items.map(model => center(model)[0]),
    [9, 9, 9, 9, 9],
  );
  assert.deepEqual(grid([], {axes: ['x', 'z'], columns: 2}), []);
});

test('fillGrid computes both axis capacities and reuses grid spacing', () => {
  const seed = keep(box(10, 2, 6)),
    target = space(40, 25);
  const config = {
    axes: ['x', 'z'] as const,
    columnGap: 5,
    rowGap: 2,
    alignContent: 'end' as const,
  };
  const filled = retain(fillGrid(seed, target, config));
  assert.equal(filled.length, 9);
  near(
    filled.map(model => model.bounds().minimum[0]),
    [0, 15, 30, 0, 15, 30, 0, 15, 30],
  );
  near(
    filled.map(model => model.bounds().minimum[2]),
    [3, 3, 3, 11, 11, 11, 19, 19, 19],
  );
  const explicit = retain(
    grid(repeat(seed, 9), target, {...config, columns: 3}),
  );
  explicit.forEach((model, index) =>
    near(model.bounds().minimum, filled[index].bounds().minimum),
  );
  const inset = retain(
    fillGrid(seed, target, {
      axes: ['x', 'z'],
      gap: 2,
      padding: {columns: 3, rows: {start: 4, end: 3}},
      justifyContent: 'end',
      alignContent: 'end',
    }),
  );
  assert.equal(inset.length, 6);
  near(keep(group(inset)).bounds().minimum, [3, -1, 8]);
  near(keep(group(inset)).bounds().maximum, [37, 1, 22]);
});

test('fillGrid handles exact floating fits and an axis that cannot hold one item', () => {
  const seed = keep(box(0.1, 2, 0.1));
  assert.equal(
    retain(fillGrid(seed, space(0.3, 0.3), {axes: ['x', 'z'], gap: 0})).length,
    9,
  );
  assert.equal(
    retain(fillGrid(seed, space(0.3, 0.3 - 1e-8), {axes: ['x', 'z'], gap: 0}))
      .length,
    6,
  );
  assert.deepEqual(
    fillGrid(keep(box(10, 2, 30)), space(40, 20), {axes: ['x', 'z'], gap: 0}),
    [],
  );
  assert.throws(
    () =>
      fillGrid(keep(line([0, 0, 10])), space(40, 20), {
        axes: ['x', 'z'],
        gap: 0,
      }),
    /positive model width or gap/,
  );
});

test('assembled groups retain internal relations when filled, nested and rotated', () => {
  const base = keep(box(10, 2, 6));
  const cap = keep(box(2, 4, 2).relate(self => on(self, base.up)));
  const unit = keep(group([base, cap]));
  const parts = retain(fillFlex(unit, space(40), {axis: 'x', gap: 5}));
  assert.equal(parts.length, 3);
  const row = keep(group(parts));
  const nested = keep(group([keep(group([row]))]));
  near(nested.bounds().minimum, [0, -1, -3]);
  near(nested.bounds().maximum, [40, 5, 3]);
  const rotated = keep(nested.rotate(0, 0, 90));
  near(rotated.bounds().minimum, [-5, 0, -3]);
  near(rotated.bounds().maximum, [1, 40, 3]);
  parts.forEach(part => {
    near(part.position(row), [0, 0, 0]);
    const [baseChild, capChild] = snapshot(part).children;
    near(
      [capChild.transform.position[1] - baseChild.transform.position[1]],
      [3],
    );
  });
  near(unit.bounds().minimum, [-5, -1, -3]);
});

test('rotated geometry, mixed kinds and named elements remain ordinary model values', () => {
  const body = keep(box(4, 10, 6).originOffset(3, 2, 1).rotate(0, 0, 90));
  const named = keep(body.expose({mount: body.up}));
  const items = retain(
    flex([named, keep(rectangle(3, 8)), keep(line([0, 0, 7]))], {
      axis: 'x',
      gap: 2,
    }),
  );
  near(items[0].bounds().size, [10, 4, 6]);
  assert.ok(items[0].mount);
  near(items[1].bounds().minimum.slice(0, 1), [12]);
  near(items[2].bounds().minimum.slice(0, 1), [17]);
  const holes = retain(
    linear(repeat(keep(cylinder(2, 10)), 3), {axis: 'x', step: 8}),
  );
  assert.ok(snapshot(keep(cut(keep(box(30, 8, 12)), holes))).mesh);
  near(keep(group(holes).rotate(0, 0, 90)).bounds().size, [10, 20, 4]);
});

test('invalid layout dimensions and track controls fail at the author boundary', () => {
  const seed = keep(box(2, 2, 2)),
    target = space(20);
  assert.throws(() => linear([seed], {axis: 'x', step: NaN}), /Step/);
  assert.throws(() => radial([seed], {axis: 'y', radius: -1}), /Radius/);
  assert.throws(
    () => radial([seed], {axis: 'y', radius: 1, sweepAngle: 361}),
    /Sweep/,
  );
  assert.throws(() => flex([seed], {axis: 'x', gap: -1}), /Gap/);
  assert.throws(
    () => flex([seed], {axis: 'x', padding: {start: -1}}),
    /Start padding/,
  );
  assert.throws(() => flex([seed], {axis: 'x', crossAxis: 'x'}), /axes/);
  assert.throws(() => grid([seed], {axes: ['x', 'z'], columns: 0}), /track/);
  assert.throws(() => grid([seed], {axes: ['x', 'z'], columns: []}), /track/);
  assert.throws(() => grid([seed], {axes: ['x', 'z'], columns: [1]}), /fit/);
  assert.throws(
    () => grid([seed], {axes: ['x', 'z'], columns: [{fr: 0}]}),
    /positive/,
  );
  assert.throws(() => grid([seed], {columns: 1, axes: ['x', 'x']}), /axes/);
  assert.throws(
    () => grid([seed], target, {axes: ['x', 'z'], columns: [30]}),
    /fit/,
  );
  assert.throws(() => fillFlex(seed, target, {axis: 'x', gap: NaN}), /Gap/);
  assert.throws(
    () => fillGrid(seed, target, {axes: ['x', 'z'], gap: 0, rowGap: -1}),
    /Row gap/,
  );
  assert.throws(() => flex([keep(group([]))], {axis: 'x'}), /Empty geometry/);
});

test('JavaScript callers cannot silently fall back to layout directions, columns or fill gaps', () => {
  const seed = keep(box(2, 2, 2)),
    target = space(10);
  const cases = [
    [linear, [[seed], {step: 2}], /axis/],
    [radial, [[seed], {radius: 2}], /axis/],
    [flex, [[seed], {}], /axis/],
    [fillFlex, [seed, target, {gap: 0}], /axis/],
    [grid, [[seed], {columns: 2}], /axes/],
    [fillGrid, [seed, target, {gap: 0}], /axes/],
    [flex, [[seed], {axis: 'x', alignItems: 'center'}], /crossAxis/],
    [flex, [[seed], target, {axis: 'x', wrap: true}], /crossAxis/],
    [
      fillFlex,
      [seed, target, {axis: 'x', gap: 0, alignItems: 'end'}],
      /crossAxis/,
    ],
    [fillFlex, [seed, target, {axis: 'x'}], /Gap/],
    [fillGrid, [seed, target, {axes: ['x', 'z']}], /requires gap/],
    [
      fillGrid,
      [seed, target, {axes: ['x', 'z'], columnGap: 0}],
      /requires gap/,
    ],
    [fillGrid, [seed, target, {axes: ['x', 'z'], rowGap: 0}], /requires gap/],
    [grid, [[seed], {axes: ['x', 'z']}], /Columns are required/],
    [grid, [[seed], target, {axes: ['x', 'z']}], /Columns are required/],
    [flex, [[seed]], /configuration is required/],
    [flex, [[seed], target], /configuration is required/],
    [grid, [[seed]], /configuration is required/],
    [grid, [[seed], target], /configuration is required/],
  ] as const;
  for (const [arrange, args, message] of cases)
    assert.throws(() => Reflect.apply(arrange, undefined, args), message);
});
