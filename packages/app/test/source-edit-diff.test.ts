import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sourceEditDiff} from '../src/source-edit-diff.ts';
import type {SourceTextEdit} from '../src/tools/tool-system.ts';

const file = '/model.ts';
function edit(
  source: string,
  start: number,
  end: number,
  text: string,
): SourceTextEdit {
  return {
    sourceRef: {file, start, end},
    expectedText: source.slice(start, end),
    text,
  };
}
function apply(source: string, edits: readonly SourceTextEdit[]): string {
  for (const edit of [...edits].sort(
    (a, b) => b.sourceRef.start - a.sourceRef.start,
  )) {
    source =
      source.slice(0, edit.sourceRef.start) +
      edit.text +
      source.slice(edit.sourceRef.end);
  }
  return source;
}
function diff(before: string, after: string) {
  return sourceEditDiff(file, after, [edit(before, 0, before.length, after)]);
}

test('replacing a whole sketch array only counts the actual changed line', () => {
  const before =
    "const s = sketch([\n  ['point', 1, [0, 0]],\n  ['point', 2, [20, 10]],\n  ['line', 3, [1, 2]],\n]);\n";
  const after = before.replace('[20, 10]', '[30, 10]');
  const result = diff(before, after);
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
  const added = result.hunks
    .flatMap(h => h.lines)
    .filter(line => line.kind === '+');
  assert.equal(added[0].newLine, 3);
  assert.equal(
    after.slice(added[0].sourceRef.start, added[0].sourceRef.end),
    "  ['point', 2, [30, 10]],",
  );
});

test('multiple partial edits on the same line count once, regardless of edit order and length changes', () => {
  const before = 'const s = box(1, 2, 3);\ns.fillet(2);\n';
  const edits = [
    edit(before, before.indexOf('2,'), before.indexOf('2,') + 1, '200'),
    edit(before, before.indexOf('1,'), before.indexOf('1,') + 1, '10'),
  ];
  const result = sourceEditDiff(file, apply(before, edits), edits);
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
  assert.equal(
    result.hunks[0].lines.find(line => line.kind === '-')!.text,
    'const s = box(1, 2, 3);',
  );
});

test('insertions and removals at different offsets produce one per-file diff', () => {
  const before = 'one\ntwo\nthree\nfour\nfive\n';
  const edits = [
    edit(before, 0, 0, 'zero\n'),
    edit(before, 4, 8, ''),
    edit(before, 14, 18, 'FOUR'),
  ];
  const after = apply(before, edits);
  const result = sourceEditDiff(file, after, edits);
  assert.equal(result.added, 2);
  assert.equal(result.removed, 2);
  for (const line of result.hunks.flatMap(h => h.lines)) {
    assert.ok(line.sourceRef.start >= 0 && line.sourceRef.end <= after.length);
    if (line.kind !== '-')
      assert.equal(
        after.slice(line.sourceRef.start, line.sourceRef.end),
        line.text,
      );
  }
});

for (const [name, before, after, added, removed] of [
  ['no changes', 'one\ntwo\n', 'one\ntwo\n', 0, 0],
  ['empty file', '', '', 0, 0],
  ['insert into empty file', '', 'one\ntwo\n', 2, 0],
  ['remove entire file', 'one\ntwo\n', '', 0, 2],
  ['append at EOF', 'one\n', 'one\ntwo\n', 1, 0],
  ['delete at EOF', 'one\ntwo', 'one\n', 0, 1],
  ['CRLF', 'one\r\ntwo\r\n', 'one\r\nthree\r\n', 1, 1],
  ['line ending normalization', 'one\r\ntwo\r\n', 'one\ntwo\n', 0, 0],
  ['indentation is a real change', 'one\n  two\n', 'one\n    two\n', 1, 1],
  ['EOF newline does not add a phantom line', 'one', 'one\n', 1, 1],
] as const) {
  test(name, () => {
    const result = diff(before, after);
    assert.equal(result.added, added);
    assert.equal(result.removed, removed);
    for (const line of result.hunks.flatMap(h => h.lines)) {
      assert.ok(Number.isInteger(line.sourceRef.start));
      assert.ok(
        line.sourceRef.start >= 0 && line.sourceRef.end <= after.length,
      );
      if (line.kind !== '-')
        assert.equal(
          after.slice(line.sourceRef.start, line.sourceRef.end),
          line.text,
        );
    }
  });
}

test('separated changes keep short context hunks and current line navigation offsets', () => {
  const before = Array.from(
    {length: 30},
    (_, index) => `line ${index + 1}`,
  ).join('\n');
  const after = before
    .replace('line 2\n', 'new line 2\n')
    .replace('line 28\n', 'new line 28\n');
  const result = diff(before, after);
  assert.equal(result.hunks.length, 2);
  assert.equal(result.added, 2);
  assert.equal(result.removed, 2);
  assert.ok(result.hunks.every(hunk => hunk.lines.length <= 6));
  assert.deepEqual(
    result.hunks
      .flatMap(h => h.lines)
      .filter(line => line.kind === '+')
      .map(line => line.newLine),
    [2, 28],
  );
});
