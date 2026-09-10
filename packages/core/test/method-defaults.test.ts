import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  box,
  extrude,
  group,
  rectangle,
  type Constraint,
  type Model,
} from '@code3d/core';
import type {ModelSnapshotObject} from '@code3d/core/tooling';
import {createModelSnapshotter, disposeModelObjects} from './model-test.ts';

const snapshot = createModelSnapshotter();

function equivalent(
  actual: ModelSnapshotObject,
  expected: ModelSnapshotObject,
) {
  assert.equal(actual.kind, expected.kind);
  assert.deepEqual(actual.origin, expected.origin);
  assert.deepEqual(actual.transform, expected.transform);
  assert.deepEqual(actual.compositionTransform, expected.compositionTransform);
  assert.deepEqual(actual.mesh, expected.mesh);
  assert.equal(actual.children.length, expected.children.length);
  actual.children.forEach((child, index) =>
    equivalent(child, expected.children[index]),
  );
}

// Reflect exercises ordinary JavaScript calls; public-api.ts checks that the
// same missing arguments remain errors in authored TypeScript.
for (const [name, create, method, defaults, overrides, invalid] of [
  [
    'rotate',
    () => box(20, 30, 40),
    'rotate',
    [0, 0, 0],
    [20, 30, 40],
    [null, NaN, Infinity, '2'],
  ],
  [
    'originOffset',
    () => box(20, 30, 40),
    'originOffset',
    [0, 0, 0],
    [2, 3, 4],
    [null, NaN, Infinity, '2'],
  ],
  [
    'group rotate',
    () => group([box(20, 30, 40)]),
    'rotate',
    [0, 0, 0],
    [20, 30, 40],
    [null, NaN, Infinity, '2'],
  ],
  [
    'group originOffset',
    () => group([box(20, 30, 40)]),
    'originOffset',
    [0, 0, 0],
    [2, 3, 4],
    [null, NaN, Infinity, '2'],
  ],
  [
    'scaled',
    () => box(20, 30, 40),
    'scaled',
    [1],
    [2],
    [null, 0, -1, NaN, Infinity, '2'],
  ],
  [
    'extrude',
    () => rectangle(20, 30),
    'extrude',
    [10],
    [-3],
    [null, 0, NaN, Infinity, '2'],
  ],
  [
    'fillet',
    () => box(20, 30, 40),
    'fillet',
    [1],
    [2],
    [null, 0, -1, NaN, Infinity, '2'],
  ],
  [
    'chamfer',
    () => box(20, 30, 40),
    'chamfer',
    [1],
    [2],
    [null, 0, -1, NaN, Infinity, '2'],
  ],
  [
    'shell',
    () => box(20, 30, 40),
    'shell',
    [1],
    [-2],
    [null, 0, NaN, Infinity, '2'],
  ],
] as const) {
  test(`${name} defaults match explicit arguments and retain validation`, t => {
    const receiver = create();
    const models: Model[] = [receiver];
    t.after(() => disposeModelObjects(models));
    const invoke = (args: readonly unknown[]): Model => {
      const model: Model = Reflect.apply(
        Reflect.get(receiver, method),
        receiver,
        args,
      );
      models.push(model);
      return model;
    };
    const before = snapshot(receiver);
    const inputs: readonly unknown[][] = [
      [],
      [undefined],
      overrides.slice(0, 1),
      [...overrides],
      ...defaults.map((_, index) =>
        overrides.map((value, i) => (i === index ? undefined : value)),
      ),
    ];
    for (const args of inputs) {
      const actual = invoke(args);
      const expected = invoke(
        defaults.map((value, index) =>
          args[index] === undefined ? value : args[index],
        ),
      );
      equivalent(snapshot(actual), snapshot(expected));
      equivalent(snapshot(receiver), before);
    }
    for (const value of invalid) assert.throws(() => invoke([value]));
  });
}

test('extrude utility and selected topology methods share their numeric defaults', t => {
  const face = rectangle(20, 30);
  const solid = box(20, 30, 40);
  const models: Model[] = [face, solid];
  t.after(() => disposeModelObjects(models));
  const pairs: readonly [Model, Model][] = [
    [Reflect.apply(extrude, undefined, [face]), face.extrude(10)],
    [Reflect.apply(extrude, undefined, [face, undefined]), face.extrude(10)],
    [Reflect.apply(extrude, undefined, [[face]])[0], face.extrude(10)],
    [
      Reflect.apply(extrude, undefined, [[face], undefined])[0],
      face.extrude(10),
    ],
    [
      Reflect.apply(solid.fillet, solid, [undefined, [1]]),
      solid.fillet(1, [1]),
    ],
    [
      Reflect.apply(solid.chamfer, solid, [undefined, [1]]),
      solid.chamfer(1, [1]),
    ],
    [Reflect.apply(solid.shell, solid, [undefined, [1]]), solid.shell(1, [1])],
  ];
  for (const [actual, expected] of pairs) {
    models.push(actual, expected);
    equivalent(snapshot(actual), snapshot(expected));
  }
});

for (const operation of [
  'offset',
  'rotate',
  'pivot',
  'pivotVertex',
  'around',
] as const) {
  test(`constraint ${operation} defaults preserve solved placement`, t => {
    const base = box(20, 30, 40);
    const source = box(4, 6, 8).originOffset(1, 2, 3);
    const models: Model[] = [base, source];
    t.after(() => disposeModelObjects(models));
    const place = (args: readonly unknown[]): Model => {
      const model = source.relate(self => {
        const constraint = self.on(base.up);
        if (operation === 'pivot') {
          const chain = Reflect.apply(constraint.pivot, constraint, args);
          return chain.rotate(0, 0, 25);
        }
        const receiver =
          operation === 'pivotVertex'
            ? constraint.pivotVertex(1)
            : operation === 'around'
              ? constraint.around(base.axis)
              : constraint;
        const method = operation === 'offset' ? 'offset' : 'rotate';
        return Reflect.apply(
          Reflect.get(receiver, method),
          receiver,
          args,
        ) as Constraint;
      });
      models.push(model);
      return model;
    };
    const defaults =
      operation === 'pivot'
        ? [[0, 0, 0]]
        : operation === 'around'
          ? [0]
          : [0, 0, 0];
    for (const args of [[], [undefined]])
      equivalent(snapshot(place(args)), snapshot(place(defaults)));
    if (operation === 'pivot') {
      equivalent(
        snapshot(place([[2, undefined, 4]])),
        snapshot(place([[2, 0, 4]])),
      );
    } else if (operation !== 'around') {
      equivalent(
        snapshot(place([3, undefined, 5])),
        snapshot(place([3, 0, 5])),
      );
    }
    for (const invalid of [null, NaN, Infinity, '2']) {
      assert.throws(() =>
        place(operation === 'pivot' ? [[invalid, 0, 0]] : [invalid]),
      );
    }
  });
}
