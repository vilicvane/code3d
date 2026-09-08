import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolveAgentCursor} from '../src/agent/cursor.ts';

const file = '/model.ts';
test('cursor capture resolves offsets and editor positions in the resulting source', () => {
  const source = 'const model = box(10, 20, 30);\n';
  assert.deepEqual(
    resolveAgentCursor(source, {file, regex: 'model = (box\\([^;]+\\))'}),
    {
      file,
      start: 14,
      end: 29,
      text: 'box(10, 20, 30)',
      match: {start: 6, end: 29},
      range: {
        startLineNumber: 1,
        startColumn: 15,
        endLineNumber: 1,
        endColumn: 30,
      },
    },
  );
});

test('line ranges disambiguate repeated source and preserve full-file anchor semantics', () => {
  const source = 'return model;\r\nreturn model;\r\n';
  const cursor = {file, regex: 'return (model);'};
  assert.throws(() => resolveAgentCursor(source, cursor), {
    code: 'cursor_ambiguous',
  });
  const selected = resolveAgentCursor(source, {...cursor, lines: [2, 2]});
  assert.equal(selected.start, 22);
  assert.equal(selected.range.startLineNumber, 2);
  assert.equal(selected.range.startColumn, 8);
  assert.throws(
    () => resolveAgentCursor(source, {file, regex: '^(return)', lines: [2, 2]}),
    {code: 'cursor_not_found'},
  );
  assert.equal(
    resolveAgentCursor(source, {
      file,
      regex: '^(return)',
      flags: 'm',
      lines: [2, 2],
    }).text,
    'return',
  );
  assert.throws(() => resolveAgentCursor(source, {...cursor, lines: [2, 4]}), {
    code: 'cursor_lines_invalid',
  });
});

test('the entire match must lie within the line range', () => {
  assert.throws(
    () => resolveAgentCursor('a\nb', {file, regex: '(a)\\nb', lines: [1, 1]}),
    {code: 'cursor_not_found'},
  );
  assert.equal(
    resolveAgentCursor('a\nb', {file, regex: '(a)\\nb', lines: [1, 2]}).text,
    'a',
  );
});

test('exactly one capture is required even on an unmatched alternative', () => {
  for (const regex of [
    'model',
    '(model)()',
    '(?:(model)|(other))',
    '(?<one>model)(?<two>x)?',
  ])
    assert.throws(() => resolveAgentCursor('model', {file, regex}), {
      code: 'cursor_capture_count',
    });
  assert.equal(
    resolveAgentCursor('model', {file, regex: '(?:model(?=()))'}).text,
    '',
  );
  assert.equal(
    resolveAgentCursor('(model)', {file, regex: '\\((?<target>model)\\)'}).text,
    'model',
  );
  assert.equal(resolveAgentCursor('(', {file, regex: '([()])'}).text, '(');
  assert.throws(
    () => resolveAgentCursor('model', {file, regex: '(other)?model'}),
    {code: 'cursor_capture_unmatched'},
  );
});

test('empty captures are carets and uniqueness includes overlapping and zero-width matches', () => {
  const caret = resolveAgentCursor('model', {file, regex: 'model()'});
  assert.equal(caret.start, 5);
  assert.equal(caret.end, 5);
  assert.equal(caret.range.endColumn, 6);
  assert.throws(() => resolveAgentCursor('ababa', {file, regex: '(aba)'}), {
    code: 'cursor_ambiguous',
  });
  assert.throws(() => resolveAgentCursor('ab', {file, regex: '()'}), {
    code: 'cursor_ambiguous',
  });
  assert.equal(resolveAgentCursor('', {file, regex: '()'}).start, 0);
  assert.throws(() => resolveAgentCursor('😀', {file, regex: '()'}), {
    code: 'cursor_ambiguous',
  });
});

test('lookarounds may select their capture while remaining constrained to the requested lines', () => {
  assert.equal(
    resolveAgentCursor('box', {file, regex: '(?=(box))'}).text,
    'box',
  );
  assert.throws(
    () =>
      resolveAgentCursor('a\nb', {file, regex: '(?<=(a)\\n)b', lines: [2, 2]}),
    {code: 'cursor_capture_outside_lines'},
  );
});

test('Unicode and mixed line endings produce Monaco UTF-16 coordinates', () => {
  const selected = resolveAgentCursor('first\r\nsecond\r😀 = model;\n', {
    file,
    regex: '😀 = (model)',
  });
  assert.deepEqual(selected.range, {
    startLineNumber: 3,
    startColumn: 6,
    endLineNumber: 3,
    endColumn: 11,
  });
  assert.equal(selected.text, 'model');
});

test('invalid patterns and caller-controlled search flags are rejected clearly', () => {
  for (const flags of ['g', 'y', 'd', 'ii', 'uv', 'z'])
    assert.throws(
      () => resolveAgentCursor('model', {file, regex: '(model)', flags}),
      {code: 'cursor_regex_invalid'},
    );
  assert.throws(() => resolveAgentCursor('model', {file, regex: '(model'}), {
    code: 'cursor_regex_invalid',
  });
});
