import {structuredPatch} from 'diff';
import type {SourceRef} from '@code3d/core/tooling';
import type {SourceTextEdit} from './tools/tool-system';

export type SourceDiffLine = Readonly<{
  kind: ' ' | '+' | '-';
  text: string;
  oldLine?: number;
  newLine?: number;
  sourceRef: SourceRef;
}>;

export type SourceEditDiff = Readonly<{
  file: string;
  added: number;
  removed: number;
  hunks: readonly Readonly<{
    oldStart: number;
    newStart: number;
    lines: readonly SourceDiffLine[];
  }>[];
}>;

/** Reconstruct the pre-transaction file from the applied, non-overlapping edits. */
export function sourceEditDiff(
  file: string,
  source: string,
  edits: readonly SourceTextEdit[],
): SourceEditDiff {
  let before = '';
  let cursor = 0;
  let delta = 0;
  for (const edit of [...edits].sort(
    (left, right) => left.sourceRef.start - right.sourceRef.start,
  )) {
    const start = edit.sourceRef.start + delta;
    before += source.slice(cursor, start) + edit.expectedText;
    cursor = start + edit.text.length;
    delta += edit.text.length - (edit.sourceRef.end - edit.sourceRef.start);
  }
  before += source.slice(cursor);

  const lineStarts = [0];
  for (const match of source.matchAll(/\n/g)) lineStarts.push(match.index + 1);
  const patch = structuredPatch(
    file,
    file,
    before,
    source,
    undefined,
    undefined,
    {
      context: 2,
      stripTrailingCr: true,
    },
  );
  let added = 0;
  let removed = 0;
  const hunks = patch.hunks.map(hunk => {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    const lines: SourceDiffLine[] = [];
    for (const line of hunk.lines) {
      // The patch's EOF marker is metadata, not another source line.
      if (line.startsWith('\\')) continue;
      const kind = line[0] as SourceDiffLine['kind'];
      const start = lineStarts[Math.min(newLine - 1, lineStarts.length - 1)];
      const end = kind === '-' ? start : start + line.slice(1).length;
      lines.push({
        kind,
        text: line.slice(1),
        oldLine: kind === '+' ? undefined : oldLine++,
        newLine: kind === '-' ? undefined : newLine++,
        sourceRef: {file, start, end},
      });
      if (kind === '+') added++;
      if (kind === '-') removed++;
    }
    return {oldStart: hunk.oldStart, newStart: hunk.newStart, lines};
  });
  return {file, added, removed, hunks};
}
