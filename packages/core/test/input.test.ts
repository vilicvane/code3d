import assert from 'node:assert/strict';
import {test} from 'node:test';
import {beginModelInputs, input} from '../src/library/input.ts';

test('numeric inputs use defaults standalone and share named values within an evaluation', () => {
  assert.equal(input('Width', 40), 40);
  const scope = beginModelInputs({Width: 60});
  try {
    assert.equal(input('Width', 40), 60);
    assert.equal(input('Height', 16), 16);
    assert.equal(input('Width', 40) > 50 ? 1 : 2, 1);
    assert.equal(input('toString', 7), 7);
    assert.deepEqual(
      [...scope.definitions.values()],
      [
        {name: 'Width', defaultValue: 40},
        {name: 'Height', defaultValue: 16},
        {name: 'toString', defaultValue: 7},
      ],
    );
    assert.throws(() => input('Width', 30), /conflicting declarations/);
  } finally {
    scope.finish();
  }
  assert.equal(input('Width', 40), 40);
});

test('input ranges validate declarations and values and retain each actual read', () => {
  const options = {min: 2, max: 60, step: 0.5};
  const reads: string[] = [];
  const scope = beginModelInputs({Height: 20.5}, name => reads.push(name));
  try {
    assert.equal(input('Height', 16, options), 20.5);
    assert.equal(input('Height', 16, options), 20.5);
    assert.deepEqual(reads, ['Height', 'Height']);
    assert.deepEqual(scope.definitions.get('Height'), {
      name: 'Height',
      defaultValue: 16,
      ...options,
    });
    assert.throws(
      () => input('Height', 16, {...options, step: 1}),
      /conflicting declarations/,
    );
    const invalid = beginModelInputs({Height: 70});
    try {
      assert.throws(() => input('Height', 16, options), /outside its range/);
      assert.equal(
        invalid.definitions.has('Height'),
        true,
        'an invalid override still exposes the resettable field',
      );
    } finally {
      invalid.finish();
    }
    assert.equal(input('Height', 16, options), 20.5);
  } finally {
    scope.finish();
  }
  assert.equal(input('Height', 16, options), 16);
  assert.throws(() => input('Height', 16, {min: 20}), /default is outside/);
  assert.throws(
    () => input('Height', 16, {min: 20, max: 10}),
    /min less than max/,
  );
  assert.throws(() => input('Height', 16, {step: 0}), /positive step/);
  assert.throws(() => input('Height', 16, {step: NaN}), /finite step/);
  assert.throws(() => input('Height', 16, {max: Infinity}), /finite max/);
});

test('input scopes restore after model errors and diagnose invalid numeric values', () => {
  const outer = beginModelInputs({Width: 10});
  try {
    const inner = beginModelInputs({Width: Infinity});
    try {
      assert.throws(() => input('Width', 40), /finite number/);
    } finally {
      inner.finish();
    }
    assert.equal(input('Width', 40), 10);
  } finally {
    outer.finish();
  }
  assert.throws(() => input('Width', NaN), /finite numeric default/);
  assert.throws(() => input(' ', 1), /non-empty name/);
});
