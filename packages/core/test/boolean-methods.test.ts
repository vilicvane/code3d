import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  align,
  box,
  circle,
  cut,
  intersect,
  offset,
  union,
  type SolidModel,
} from '../bld/node/index.js';
import {clearKernelOperationCache} from '../bld/library/kernel-cache.js';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';

afterEach(() => clearKernelOperationCache());

const functions = {
  union: (stock: SolidModel, others: readonly SolidModel[]) =>
    union([stock, ...others]),
  intersect: (stock: SolidModel, others: readonly SolidModel[]) =>
    intersect([stock, ...others]),
  cut,
};

for (const [operation, singleVolume, batchVolume] of [
  ['union', 1400, 1800],
  ['intersect', 600, 360],
  ['cut', 400, 160],
] as const) {
  test(`${operation} methods preserve the receiver frame, topology and value semantics for single and array inputs`, () => {
    const tag = Symbol('boolean test');
    const base = () => box(10, 10, 10).originOffset(2, 1, 0).rotate(0, 0, 90);
    const stock = base()
      .material('#f00818')
      .withMetadata({[tag]: 'stock'});
    const a = base().relate(self => [
      align(self.frame, stock.frame),
      offset(4, 0, 0),
    ]);
    const b = base().relate(self => [
      align(self.frame, stock.frame),
      offset(0, 4, 0),
    ]);
    const outputs: SolidModel[] = [];
    const original = stock.bounds();
    const snapshot = createModelSnapshotter();
    try {
      for (const [input, expected] of [
        [a, singleVolume],
        [[a], singleVolume],
        [[a, b], batchVolume],
      ] as const) {
        const result = stock[operation](input);
        outputs.push(result);
        const equivalent = functions[operation](
          stock,
          Array.isArray(input) ? input : [input as SolidModel],
        );
        outputs.push(equivalent);
        assert.notEqual(result, stock);
        assert.ok(Math.abs(result.volume - expected) < 1e-6);
        assert.deepEqual(result.bounds(), equivalent.bounds());
        assert.deepEqual(
          modelGeometry(result).value.topology,
          modelGeometry(equivalent).value.topology,
        );
        assert.deepEqual(snapshot(result).material, snapshot(stock).material);
        assert.equal(result.metadata[tag], 'stock');
        const record = snapshot(result).operation;
        assert.equal(record.kind, operation);
        assert.deepEqual(
          record.inputs.map(value => value.role),
          [
            'receiver',
            ...Array(Array.isArray(input) ? input.length : 1).fill(
              operation === 'cut' ? 'tool' : 'operand',
            ),
          ],
        );
      }
      assert.deepEqual(stock.bounds(), original);
      assert.ok(Math.abs(stock.volume - 1000) < 1e-6);
    } finally {
      disposeModelObjects([...outputs, stock, a, b]);
    }
  });
}

test('boolean methods reject empty and non-solid operands without consuming their inputs', () => {
  const stock = box(10, 10, 10);
  const face = circle(2);
  const far = box(10, 10, 10).originOffset(-30, 0, 0);
  try {
    for (const operation of ['union', 'intersect', 'cut'] as const) {
      assert.throws(() => stock[operation]([]), /requires at least one/);
      // @ts-expect-error Runtime checks cover untyped author inputs too.
      assert.throws(() => stock[operation](face), /must be a solid model/);
      // @ts-expect-error Runtime checks cover array members too.
      assert.throws(() => stock[operation]([face]), /must be a solid model/);
    }
    assert.throws(() => stock.intersect(far), /no common solid volume/);
    assert.ok(Math.abs(stock.volume - 1000) < 1e-6);
    assert.ok(Math.abs(far.volume - 1000) < 1e-6);
  } finally {
    disposeModelObjects([stock, face, far]);
  }
});
