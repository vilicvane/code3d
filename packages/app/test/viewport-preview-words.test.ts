import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  previewOperations,
  previewWords,
} from '../src/ui/viewport-empty-state.ts';

test('each round starts with model and sketch and shuffles every remaining operation once', () => {
  const operations = [...previewOperations];
  let random = 0;
  const words = previewWords(() => random);
  const round = () =>
    Array.from({length: operations.length + 2}, () => words.next().value);
  const first = round();
  random = 0.999;
  const second = round();
  for (const sequence of [first, second]) {
    assert.deepEqual(sequence.slice(0, 2), ['model', 'sketch']);
    assert.deepEqual(sequence.slice(2).sort(), [...operations].sort());
    assert.equal(new Set(sequence).size, sequence.length);
  }
  assert.notDeepEqual(first.slice(2), second.slice(2));
  assert.deepEqual(previewOperations, operations);
});
