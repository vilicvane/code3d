import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {init_planegcs_module} from '@salusoft89/planegcs';
import {sketch} from '../bld/node/index.js';
import {
  snapshotSketch,
  solveSketchSnapshot,
  sketchArcGeometry,
  SketchConstraintError,
  installSketchSolver,
  type Sketch,
  type SketchConstraint,
  type SketchEntry,
  type SketchPosition,
  type SketchSnapshot,
} from '../bld/tooling/index.js';

let native: Awaited<ReturnType<typeof init_planegcs_module>>;
before(async () => {
  native = await init_planegcs_module({
    locateFile: () =>
      fileURLToPath(
        import.meta
          .resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm'),
      ),
  });
  installSketchSolver(native);
});

const snapshot = (value: Sketch) => snapshotSketch(value, () => 'local');
const position = (view: SketchSnapshot, id: number) =>
  view.entities.filter(e => e.kind === 'point').find(e => e.id === id)!
    .position;
const near = (a: number, b: number, tolerance = 1e-7) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const polar = (angle: number, radius = 10): SketchPosition => [
  radius * Math.cos((angle * Math.PI) / 180),
  radius * Math.sin((angle * Math.PI) / 180),
];
const entries = (
  sweep: number,
  direction: 'cw' | 'ccw',
  start = 175,
): SketchEntry[] => [
  ['point', 1, [0, 0]],
  ['point', 2, polar(start)],
  ['point', 3, polar(start + (direction === 'ccw' ? sweep : -sweep))],
  ['arc', 4, [1, 10, 2, 3, direction]],
];
const curve = (view: SketchSnapshot) => {
  const arc = view.entities.find(e => e.kind === 'arc')!;
  return sketchArcGeometry(
    position(view, 1),
    position(view, 2),
    position(view, 3),
    arc.direction,
  );
};

test('sweep constrains the directed angle, not orientation or a second authored geometry value', () => {
  for (const direction of ['cw', 'ccw'] as const)
    for (const degrees of [0.001, 15, 90, 180, 270, 345, 359.999]) {
      const data = entries(degrees, direction);
      const view = snapshot(
        sketch(data, {constraints: [['sweep', 4, degrees]]}),
      );
      assert.equal(view.degreesOfFreedom, 4);
      assert.deepEqual(view.constraints, [['sweep', 4, degrees]]);
      near((Math.abs(curve(view).sweep) * 180) / Math.PI, degrees);
      for (const id of [1, 2, 3])
        position(view, id).forEach((v, axis) =>
          near(v, (data[id - 1][2] as SketchPosition)[axis]),
        );
    }
});

test('radius and sweep solve changed current geometry on both minor and major branches', () => {
  for (const direction of ['cw', 'ccw'] as const)
    for (const degrees of [30, 90, 180, 270, 330]) {
      const view = snapshot(
        sketch(entries(120, direction), {
          constraints: [
            ['fixed', 1],
            ['radius', 4, 10],
            ['sweep', 4, degrees],
          ],
        }),
      );
      assert.equal(view.degreesOfFreedom, 1);
      near(curve(view).radius, 10);
      near((Math.abs(curve(view).sweep) * 180) / Math.PI, degrees, 1e-5);
    }
});

test('sweep endpoint dragging rotates both endpoints continuously through half turns and zero with exact replay', () => {
  for (const direction of ['cw', 'ccw'] as const)
    for (const degrees of [90, 270]) {
      let view = snapshot(
        sketch(entries(degrees, direction), {
          constraints: [
            ['fixed', 1],
            ['radius', 4, 10],
            ['sweep', 4, degrees],
          ],
        }),
      );
      for (let step = 1; step <= 360; step++) {
        const start = 175 + step * 2;
        const end = start + (direction === 'ccw' ? degrees : -degrees);
        const target = polar(end);
        view = solveSketchSnapshot([view], {id: 3, position: target});
        position(view, 3).forEach((v, axis) => near(v, target[axis], 1e-5));
        position(view, 2).forEach((v, axis) =>
          near(v, polar(start)[axis], 1e-5),
        );
        near((Math.abs(curve(view).sweep) * 180) / Math.PI, degrees, 1e-5);
        const replay = solveSketchSnapshot([view]);
        for (const id of [1, 2, 3])
          position(replay, id).forEach((v, axis) =>
            near(v, position(view, id)[axis]),
          );
      }
    }
});

test('sweep preserves upstream centers and authored coordinate locks across scales', () => {
  for (const radius of [1e-6, 10, 1e6]) {
    const base = sketch([['point', 1, [0, 0]]]);
    const derived = base.derive(
      [
        ['point', 1, [radius, 0]],
        ['point', 2, [0, radius]],
        ['arc', 3, [base.point(1), radius, 1, 2, 'cw']],
      ],
      {
        constraints: [
          ['radius', 3, radius],
          ['sweep', 3, 270],
        ],
      },
    );
    const identity = (value: Sketch) => (value === base ? 'base' : 'local');
    const upstream = snapshotSketch(base, identity),
      local = snapshotSketch(derived, identity);
    assert.equal(local.degreesOfFreedom, 1);
    const moved = solveSketchSnapshot([upstream, local], {
      id: 2,
      position: [-radius, 0],
      locks: [
        {id: 1, parameter: 0, value: radius},
        {id: 1, parameter: 1, value: 0},
      ],
    });
    near(position(moved, 1)[0] / radius, 1);
    near(position(moved, 2)[1] / radius, 1);
    near(position(moved, 2)[0] / radius, 0);
    assert.deepEqual(position(upstream, 1), [0, 0]);
  }
});

test('sweep rejects non-arc targets, full circles, non-finite values and genuine contradictions', () => {
  for (const value of [0, -1, 360, 361, Infinity, NaN])
    assert.throws(
      () => sketch(entries(90, 'ccw'), {constraints: [['sweep', 4, value]]}),
      /strictly between/,
    );
  for (const target of [1, 5, 6, 99])
    assert.throws(
      () =>
        sketch(
          [...entries(90, 'ccw'), ['line', 5, [1, 2]], ['circle', 6, [1, 10]]],
          {
            constraints: [['sweep', target, 90]],
          },
        ),
      /missing local arc/,
    );
  for (const constraints of [
    [
      ['sweep', 4, 90],
      ['sweep', 4, 270],
    ],
    [
      ['fixed', 1],
      ['fixed', 2],
      ['fixed', 3],
      ['sweep', 4, 270],
    ],
  ] as const satisfies readonly (readonly SketchConstraint[])[])
    assert.throws(
      () => sketch(entries(90, 'ccw'), {constraints}),
      SketchConstraintError,
    );
});

test('equal sweep constraints remain redundant without changing geometry or losing source indices', () => {
  const view = snapshot(
    sketch(entries(270, 'cw'), {
      constraints: [
        ['radius', 4, 10],
        ['sweep', 4, 270],
        ['sweep', 4, 270],
      ],
    }),
  );
  assert.equal(view.degreesOfFreedom, 3);
  assert.ok(view.redundant.some(i => i === 1 || i === 2));
  near((Math.abs(curve(view).sweep) * 180) / Math.PI, 270);
});

test('dimensions already determined by known points are checked directly, including true conflicts', () => {
  for (const fixed of [
    [
      ['fixed', 1],
      ['fixed', 2],
      ['fixed', 3],
    ],
    [
      ['x', 1, 0],
      ['y', 1, 0],
      ['x', 2, 10],
      ['y', 2, 0],
      ['x', 3, 0],
      ['y', 3, 10],
    ],
  ] as const satisfies readonly (readonly SketchConstraint[])[]) {
    const view = snapshot(
      sketch(entries(90, 'ccw', 0), {
        constraints: [...fixed, ['radius', 4, 10], ['sweep', 4, 90]],
      }),
    );
    assert.equal(view.degreesOfFreedom, 0);
    // ArcRules can additionally make one of six point coordinates redundant.
    assert.ok(view.redundant.includes(fixed.length));
    assert.ok(view.redundant.includes(fixed.length + 1));
    const moved = solveSketchSnapshot([view], {id: 3, position: [-10, 0]});
    near(position(moved, 3)[0], 0);
    near(position(moved, 3)[1], 10);
    for (const bad of [
      ['radius', 4, 11],
      ['sweep', 4, 270],
    ] as const)
      assert.throws(
        () => sketch(entries(90, 'ccw', 0), {constraints: [...fixed, bad]}),
        (error: unknown) =>
          error instanceof SketchConstraintError &&
          error.constraints.includes(fixed.length),
      );
  }
});

test('sweep indices remain local to their arcs, independently of entity ordering and circles', () => {
  const view = snapshot(
    sketch(
      [
        ['circle', 99, [1, 3]],
        ...entries(90, 'ccw', 0),
        ['arc', 8, [1, 10, 2, 3, 'cw']],
      ],
      {
        constraints: [
          ['sweep', 8, 270],
          ['radius', 99, 3],
          ['sweep', 4, 90],
        ],
      },
    ),
  );
  assert.equal(view.entities.filter(e => e.kind === 'arc').length, 2);
  near(position(view, 2)[0], 10);
  near(position(view, 3)[1], 10);
});

test('repeated successful and conflicting sweep systems release native heap and handles', () => {
  const run = (i: number) => {
    const direction = i % 2 ? 'cw' : 'ccw';
    const value = sketch(entries(270, direction), {
      constraints: [
        ['fixed', 1],
        ['radius', 4, 10],
        ['sweep', 4, 270],
      ],
    });
    solveSketchSnapshot([snapshot(value)], {id: 3, position: polar(210)});
    assert.throws(
      () =>
        sketch(entries(270, direction), {
          constraints: [
            ['sweep', 4, 270],
            ['sweep', 4, 90],
          ],
        }),
      SketchConstraintError,
    );
  };
  for (let i = 0; i < 100; i++) run(i);
  const heap = native.HEAPU8.buffer.byteLength,
    handles = native.count_emval_handles();
  for (let i = 0; i < 2000; i++) run(i);
  assert.equal(native.HEAPU8.buffer.byteLength, heap);
  assert.equal(native.count_emval_handles(), handles);
});
