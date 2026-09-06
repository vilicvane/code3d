import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {init_planegcs_module} from '@salusoft89/planegcs';
import {sketch} from '../bld/library/index.js';
import {
  installSketchSolver,
  snapshotSketch,
  solveSketchSnapshot,
  SketchConstraintError,
} from '../bld/tooling/index.js';

let native;
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
const close = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const snapshot = value => snapshotSketch(value, () => 'local');
const position = (s, id) =>
  s.entities.find(e => e.kind === 'point' && e.id === id).position;
const entries = [
  ['point', 1, [0, 0]],
  ['point', 2, [38, 2]],
  ['line', 3, [1, 2]],
];

test('current geometry and explicit constraints are separate; variable and literal values solve identically', () => {
  const width = 40;
  const make = length =>
    snapshot(
      sketch(entries, {
        constraints: [
          ['fixed', 1],
          ['horizontal', 3],
          ['length', [3, length]],
        ],
      }),
    );
  const a = make(width),
    b = make(40);
  assert.deepEqual(a, b);
  close(position(a, 2)[0], width);
  close(position(a, 2)[1], 0);
  assert.equal(a.degreesOfFreedom, 0);
  assert.deepEqual(
    entries[1][2],
    [38, 2],
    'solving does not mutate author data',
  );
});

test('dimensions and direction survive drag and deterministic source replay', () => {
  const constraints = [
    ['horizontal', 3],
    ['length', [3, 40]],
  ];
  const original = snapshot(sketch(entries, {constraints}));
  const moved = solveSketchSnapshot([original], {
    id: 2,
    position: [60, 20],
  });
  const a = position(moved, 1),
    b = position(moved, 2);
  close(b[0] - a[0], 40);
  close(a[1], b[1]);
  position(original, 1).forEach((v, axis) => close(a[axis], v));
  position(original, 2).forEach((v, axis) => close(b[axis], v));
  assert.equal(moved.degreesOfFreedom, 2);
  const replay = snapshot(
    sketch(
      [
        ['point', 1, a],
        ['point', 2, b],
        ['line', 3, [1, 2]],
      ],
      {constraints},
    ),
  );
  for (const id of [1, 2])
    position(replay, id).forEach((v, axis) =>
      close(v, position(moved, id)[axis]),
    );
});

test('fixed geometry resists a soft drag without turning drag into a constraint', () => {
  const original = snapshot(
    sketch(entries, {
      constraints: [
        ['fixed', 1],
        ['horizontal', 3],
        ['length', [3, 40]],
      ],
    }),
  );
  for (const id of [1, 2]) {
    const moved = solveSketchSnapshot([original], {
      id,
      position: [80, -50],
    });
    for (const p of [1, 2])
      position(moved, p).forEach((v, i) => close(v, position(original, p)[i]));
    assert.deepEqual(moved.constraints, original.constraints);
    assert.equal(moved.degreesOfFreedom, 0);
  }
});

test('coordinate, angle and coincident constraints solve against current geometry', () => {
  const value = sketch([...entries, ['point', 4, [0.2, 0.3]]], {
    constraints: [
      ['x', [1, 5]],
      ['y', [1, -3]],
      ['length', [3, 10]],
      ['angle', [3, 90]],
      ['coincident', [1, 4]],
    ],
  });
  const s = snapshot(value);
  close(position(s, 1)[0], 5);
  close(position(s, 1)[1], -3);
  close(position(s, 2)[0], 5);
  close(position(s, 2)[1], 7);
  position(s, 4).forEach((v, axis) => close(v, position(s, 1)[axis]));
  assert.equal(s.degreesOfFreedom, 0);
});

test('derived solving locks upstream geometry and resolves layer-local IDs independently', () => {
  const base = sketch([['point', 1, [10, 20]]]);
  const child = base.derive(
    [
      ['point', 1, [14, 28]],
      ['line', 2, [base.point(1), 1]],
    ],
    {
      constraints: [
        ['vertical', 2],
        ['length', [2, 10]],
      ],
    },
  );
  const identity = s => (s === base ? 'base' : 'child');
  const a = snapshotSketch(base, identity),
    b = snapshotSketch(child, identity);
  close(position(b, 1)[0], 10);
  close(position(b, 1)[1], 30);
  const moved = solveSketchSnapshot([a, b], {
    id: 1,
    position: [80, 60],
  });
  close(position(moved, 1)[0], 10);
  close(position(moved, 1)[1], 30);
  assert.deepEqual(position(a, 1), [10, 20]);
  assert.equal(b.degreesOfFreedom, 0);
});

test('the first non-dragged point anchors a gesture without new persistent constraints', () => {
  const s = snapshot(sketch(entries, {constraints: [['horizontal', 3]]}));
  for (const id of [1, 2]) {
    const anchor = id === 1 ? 2 : 1;
    const moved = solveSketchSnapshot([s], {id, position: [60, 50]});
    assert.deepEqual(position(s, anchor), position(moved, anchor));
    close(position(moved, id)[1], position(s, anchor)[1]);
    close(position(moved, id)[0], 60);
    assert.deepEqual(moved.constraints, s.constraints);
    assert.equal(moved.degreesOfFreedom, 3);
  }
});

test('an existing fixed point prevents an extra automatic gesture anchor', () => {
  for (const fixed of [
    [['fixed', 4]],
    [
      ['x', [4, 0]],
      ['y', [4, 0]],
    ],
  ]) {
    const s = snapshot(
      sketch([...entries, ['point', 4, [0, 0]]], {
        constraints: [...fixed, ['length', [3, 40]]],
      }),
    );
    const moved = solveSketchSnapshot([s], {id: 2, position: [60, 20]});
    close(position(moved, 2)[0], 60);
    close(position(moved, 2)[1], 20);
    assert.notDeepEqual(position(moved, 1), position(s, 1));
    assert.deepEqual(position(moved, 4), position(s, 4));
  }
});

test('either endpoint can rotate continuously through 180 degrees with a temporary opposite anchor', () => {
  const initial = snapshot(
    sketch(entries, {constraints: [['length', [3, 40]]]}),
  );
  for (const id of [1, 2]) {
    const anchor = id === 1 ? 2 : 1;
    const center = position(initial, anchor),
      start = position(initial, id);
    const angle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    let previous = initial;
    for (let step = 1; step <= 288; step++) {
      const theta = angle + (step * Math.PI) / 72;
      const target = [
        center[0] + 40 * Math.cos(theta),
        center[1] + 40 * Math.sin(theta),
      ];
      const moved = solveSketchSnapshot([previous], {id, position: target});
      position(moved, anchor).forEach((v, axis) => close(v, center[axis]));
      position(moved, id).forEach((v, axis) => close(v, target[axis]));
      assert.ok(
        Math.hypot(
          ...position(moved, id).map(
            (v, axis) => v - position(previous, id)[axis],
          ),
        ) < 2,
      );
      assert.equal(moved.degreesOfFreedom, initial.degreesOfFreedom);
      previous = moved;
    }
  }
});

test('gesture coordinate locks are numeric, per-axis and absent from ordinary evaluation', () => {
  for (const axis of [0, 1]) {
    const original = snapshot(sketch([['point', 1, [22, 19]]]));
    const moved = solveSketchSnapshot([original], {
      id: 1,
      position: [30, 40],
      locks: [{id: 1, axis, value: original.entities[0].position[axis]}],
    });
    assert.equal(position(moved, 1)[axis], position(original, 1)[axis]);
    assert.equal(position(moved, 1)[1 - axis], [30, 40][1 - axis]);
    assert.equal(moved.degreesOfFreedom, 2);
    assert.deepEqual(moved.constraints, []);
    assert.deepEqual(
      position(
        solveSketchSnapshot([original], {
          id: 1,
          position: [30, 40],
        }),
        1,
      ),
      [30, 40],
    );
  }
});

test('a dragged coordinate lock coexists with the first non-dragged anchor and hard constraints', () => {
  const original = snapshot(
    sketch(
      [
        ['point', 1, [0, 0]],
        ['point', 2, [20, 0]],
        ['line', 3, [1, 2]],
      ],
      {constraints: [['horizontal', 3]]},
    ),
  );
  const moved = solveSketchSnapshot([original], {
    id: 2,
    position: [40, 30],
    locks: [{id: 2, axis: 1, value: 0}],
  });
  assert.deepEqual(position(moved, 1), [0, 0]);
  close(position(moved, 2)[0], 40);
  assert.equal(position(moved, 2)[1], 0);
  assert.equal(moved.degreesOfFreedom, original.degreesOfFreedom);
});

test('coordinate locks and permanent coordinate constraints together prevent an extra drag anchor', () => {
  for (const permanentY of [false, true]) {
    const original = snapshot(
      sketch([...entries, ['point', 4, [0, 0]]], {
        constraints: [
          ['length', [3, 40]],
          ...(permanentY ? [['y', [4, 0]]] : []),
        ],
      }),
    );
    const moved = solveSketchSnapshot([original], {
      id: 2,
      position: [60, 20],
      locks: [
        {id: 4, axis: 0, value: 0},
        ...(!permanentY ? [{id: 4, axis: 1, value: 0}] : []),
      ],
    });
    position(moved, 2).forEach((v, axis) => close(v, [60, 20][axis]));
    assert.notDeepEqual(position(moved, 1), position(original, 1));
    position(moved, 4).forEach(v => close(v, 0));
    assert.equal(moved.degreesOfFreedom, original.degreesOfFreedom);
  }
});

test('changed coordinate locks are satisfied before a temporary anchor is chosen', () => {
  const original = snapshot(
    sketch(
      [
        ['point', 1, [22, 0]],
        ['point', 2, [62, 19]],
        ['line', 3, [1, 2]],
      ],
      {constraints: [['horizontal', 3]]},
    ),
  );
  assert.equal(position(original, 2)[1], 0);
  const moved = solveSketchSnapshot([original], {
    id: 2,
    position: [70, 30],
    locks: [{id: 2, axis: 1, value: 19}],
  });
  position(moved, 1).forEach((v, axis) => close(v, [22, 19][axis]));
  position(moved, 2).forEach((v, axis) => close(v, [70, 19][axis]));
  assert.deepEqual(moved.constraints, original.constraints);
  assert.equal(moved.degreesOfFreedom, original.degreesOfFreedom);
});

test('gesture locks respect explicit fixed and coordinate constraints rather than replacing them', () => {
  const original = snapshot(
    sketch(
      [
        ['point', 1, [0, 0]],
        ['point', 2, [40, 0]],
        ['line', 3, [1, 2]],
      ],
      {
        constraints: [
          ['fixed', 1],
          ['length', [3, 40]],
        ],
      },
    ),
  );
  const moved = solveSketchSnapshot([original], {
    id: 2,
    position: [24, 32],
    locks: [
      {id: 1, axis: 0, value: 0},
      {id: 1, axis: 1, value: 0},
    ],
  });
  assert.deepEqual(position(moved, 1), [0, 0]);
  position(moved, 2).forEach((v, axis) => close(v, [24, 32][axis]));
  assert.throws(
    () =>
      solveSketchSnapshot([original], {
        id: 2,
        position: [24, 32],
        locks: [{id: 1, axis: 0, value: 10}],
      }),
    SketchConstraintError,
  );
  const located = snapshot(
    sketch([['point', 1, [0, 0]]], {
      constraints: [['x', [1, 10]]],
    }),
  );
  assert.throws(
    () =>
      solveSketchSnapshot([located], {
        id: 1,
        position: [20, 20],
        locks: [{id: 1, axis: 0, value: 0}],
      }),
    SketchConstraintError,
  );
});

test('conflicting dimensions report solve-local constraint indices and redundant constraints stay solvable', () => {
  assert.throws(
    () =>
      sketch(entries, {
        constraints: [
          ['length', [3, 40]],
          ['length', [3, 50]],
        ],
      }),
    error => {
      assert.ok(error instanceof SketchConstraintError);
      assert.deepEqual([...error.constraints].sort(), [0, 1]);
      return true;
    },
  );
  const s = snapshot(
    sketch(entries, {
      constraints: [
        ['horizontal', 3],
        ['horizontal', 3],
      ],
    }),
  );
  assert.equal(s.degreesOfFreedom, 3);
  assert.ok(s.redundant.length > 0);
});

test('normalization handles translated small and large models', () => {
  for (const scale of [1e-6, 1, 1e6]) {
    const p = (x, y) => [(8000 + x) * scale, (-9000 + y) * scale];
    const s = snapshot(
      sketch(
        [
          ['point', 1, p(0, 0)],
          ['point', 2, p(38, 2)],
          ['line', 3, [1, 2]],
        ],
        {
          constraints: [
            ['fixed', 1],
            ['horizontal', 3],
            ['length', [3, 40 * scale]],
          ],
        },
      ),
    );
    close((position(s, 2)[0] - position(s, 1)[0]) / scale, 40);
    close((position(s, 2)[1] - position(s, 1)[1]) / scale, 0);
  }
});

test('invalid constraint references, dimensions and collapsed geometry fail clearly', () => {
  assert.throws(
    () => sketch(entries, {constraints: [['horizontal', 1]]}),
    /missing local line/,
  );
  assert.throws(
    () => sketch(entries, {constraints: [['fixed', 9]]}),
    /local or upstream/,
  );
  for (const value of [0, -1, Infinity, NaN])
    assert.throws(
      () => sketch(entries, {constraints: [['length', [3, value]]]}),
      /positive.*finite/,
    );
  assert.throws(
    () =>
      sketch([
        ['point', 1, [0, 0]],
        ['line', 2, [1, 1]],
      ]),
    /zero length/,
  );
});

test('repeated successes and failures release native systems, vectors and geometry', () => {
  const run = count => {
    for (let i = 0; i < count; i++) {
      snapshot(
        sketch(entries, {
          constraints: [
            ['fixed', 1],
            ['horizontal', 3],
            ['length', [3, 40]],
          ],
        }),
      );
      assert.throws(
        () =>
          sketch(entries, {
            constraints: [
              ['length', [3, 40]],
              ['length', [3, 50]],
            ],
          }),
        SketchConstraintError,
      );
    }
  };
  run(100);
  const size = native.HEAPU8.buffer.byteLength;
  const handles = native.count_emval_handles();
  run(2000);
  assert.equal(native.HEAPU8.buffer.byteLength, size);
  assert.equal(native.count_emval_handles(), handles);
});
