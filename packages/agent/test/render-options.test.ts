import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseApplyInput, resolveRenderView} from '../bld/index.js';

test('render vectors are validated without changing repeated request identity', () => {
  const input = {
    render: {view: {direction: [2, 3, 4], up: [0, 2, 0]}},
    type: true,
  };
  const parsed = parseApplyInput(input);
  assert.deepEqual(parsed, input);
  assert.deepEqual(parseApplyInput(parsed), parsed);
  for (const view of [
    'diagonal',
    {direction: [0, 0, 0]},
    {direction: [1, NaN, 1]},
    {direction: [1, 2]},
    {direction: [0, 2, 0], up: [0, -1, 0]},
  ])
    assert.throws(() => parseApplyInput({render: {view}}), {
      code: 'invalid_input',
    });
  assert.deepEqual(resolveRenderView('top'), {
    direction: [0, 1, 0],
    up: [0, 0, -1],
  });
});
