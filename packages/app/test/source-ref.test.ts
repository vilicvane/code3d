import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SourceRef} from '@code3d/core/tooling';
import {rebaseSourceRef} from '../src/tools/source-ref.ts';

function ref(start: number, end: number): SourceRef {
  return {file: '/model.ts', start, end};
}

test('appending openings preserves the neighboring thickness and expands only the insertion slot and call', () => {
  const original = 'shell(1.5)';
  const source = 'shell(1.5, [4])';
  const changes = [{rangeOffset: 9, rangeLength: 0, text: ', [4]'}];
  const textAt = (originalRef: SourceRef) => {
    const current = rebaseSourceRef(originalRef, changes, false);
    assert.ok(current);
    return source.slice(current.start, current.end);
  };
  assert.equal(textAt(ref(6, 9)), '1.5');
  assert.equal(textAt(ref(9, 9)), ', [4]');
  assert.equal(textAt(ref(0, original.length)), source);
  assert.equal(textAt(ref(9, 10)), ')');
});

test('successive tool edits can change thickness and replace the just-inserted openings before recompiling', () => {
  const inserted = [{rangeOffset: 9, rangeLength: 0, text: ', [4]'}];
  const thickness = rebaseSourceRef(ref(6, 9), inserted, false);
  const openings = rebaseSourceRef(ref(9, 9), inserted, false);
  assert.ok(thickness);
  assert.ok(openings);
  const changed = [
    {
      rangeOffset: thickness.start,
      rangeLength: thickness.end - thickness.start,
      text: '100',
    },
  ];
  const current = rebaseSourceRef(openings, changed, false);
  assert.ok(current);
  const source = 'shell(100, [4])';
  assert.equal(source.slice(current.start, current.end), ', [4]');
  const result =
    source.slice(0, current.start) + ', [4, 6]' + source.slice(current.end);
  assert.equal(result, 'shell(100, [4, 6])');
});

test('user typing extends numeric tokens while tool insertion before a token shifts it', () => {
  const insert = [{rangeOffset: 6, rangeLength: 0, text: '-'}];
  const source = 'shell(-1.5)';
  const user = rebaseSourceRef(ref(6, 9), insert, true);
  const tool = rebaseSourceRef(ref(6, 9), insert, false);
  assert.ok(user);
  assert.ok(tool);
  assert.equal(source.slice(user.start, user.end), '-1.5');
  assert.equal(source.slice(tool.start, tool.end), '1.5');
  assert.deepEqual(
    rebaseSourceRef(
      ref(6, 9),
      [{rangeOffset: 9, rangeLength: 0, text: '0'}],
      true,
    ),
    ref(6, 10),
  );
});

test('batch edits preserve enclosing calls and reject partial overlaps', () => {
  const changes = [
    {rangeOffset: 9, rangeLength: 0, text: ', [4]'},
    {rangeOffset: 6, rangeLength: 3, text: '2'},
  ];
  assert.deepEqual(rebaseSourceRef(ref(6, 9), changes, false), ref(6, 7));
  assert.deepEqual(rebaseSourceRef(ref(0, 10), changes, false), ref(0, 13));
  assert.equal(
    rebaseSourceRef(
      ref(6, 9),
      [{rangeOffset: 7, rangeLength: 4, text: ''}],
      false,
    ),
    undefined,
  );
});
