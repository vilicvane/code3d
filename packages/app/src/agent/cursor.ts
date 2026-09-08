import {AgentError, type AgentCursor} from '@code3d/agent';

export type ResolvedAgentCursor = Readonly<{
  file: string;
  /** UTF-16 offsets in the exact source passed to the resolver; end is exclusive. */
  start: number;
  end: number;
  text: string;
  match: Readonly<{start: number; end: number}>;
  /** 1-based Monaco positions; these do not change the user's actual selection. */
  range: Readonly<{
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }>;
}>;

/** Run in a disposable worker: arbitrary native regex matching must not block the App. */
export function resolveAgentCursor(
  source: string,
  cursor: AgentCursor,
): ResolvedAgentCursor {
  const flags = cursor.flags ?? 'u';
  if (!/^[imsuv]*$/.test(flags))
    throw new AgentError(
      'cursor_regex_invalid',
      'Cursor flags support i, m, s, u and v; matching and indices are managed by the App.',
    );
  let regex: RegExp;
  let groups: number;
  try {
    regex = new RegExp(cursor.regex, flags + 'dg');
    // The first, empty branch always matches without executing the user's pattern.
    // Native match arrays still allocate a slot for every capture in the other branch.
    groups =
      new RegExp('(?:)|(?:' + cursor.regex + ')', flags).exec('')!.length - 1;
  } catch {
    throw new AgentError(
      'cursor_regex_invalid',
      'Cursor regex or flags are invalid.',
    );
  }
  if (groups !== 1)
    throw new AgentError(
      'cursor_capture_count',
      'Cursor regex must have exactly one capture group. Use (?:...) for other groups.',
    );

  const lines = sourceLines(source);
  const [first, last] = cursor.lines ?? [1, lines.length];
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    first < 1 ||
    last < first ||
    last > lines.length
  )
    throw new AgentError(
      'cursor_lines_invalid',
      'Cursor line range is outside the resulting source.',
    );
  const lower = lines[first - 1].start;
  const upper = lines[last - 1].end;
  regex.lastIndex = lower;
  let found: RegExpExecArray | undefined;
  for (;;) {
    const match = regex.exec(source);
    if (!match || match.index > upper) break;
    if (match.index + match[0].length <= upper) {
      if (found)
        throw new AgentError(
          'cursor_ambiguous',
          'Cursor regex has more than one full match in the requested line range.',
        );
      found = match;
    }
    // Check overlapping matches too, and advance empty matches without looping forever.
    const unicode = regex.unicode || flags.includes('v');
    regex.lastIndex =
      match.index +
      (unicode && (source.codePointAt(match.index) ?? 0) > 0xffff ? 2 : 1);
  }
  if (!found)
    throw new AgentError(
      'cursor_not_found',
      'Cursor regex has no full match in the requested line range.',
    );
  const capture = found.indices![1];
  if (!capture)
    throw new AgentError(
      'cursor_capture_unmatched',
      'The unique full match did not participate in the capture group.',
    );
  const [start, end] = capture;
  if (start < lower || end > upper)
    throw new AgentError(
      'cursor_capture_outside_lines',
      'The captured selection must be inside the requested line range.',
    );
  const from = positionAt(lines, start);
  const to = positionAt(lines, end);
  return {
    file: cursor.file,
    start,
    end,
    text: source.slice(start, end),
    match: {start: found.index, end: found.index + found[0].length},
    range: {
      startLineNumber: from.line,
      startColumn: from.column,
      endLineNumber: to.line,
      endColumn: to.column,
    },
  };
}

type SourceLine = {start: number; end: number};
function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const newline of source.matchAll(/\r\n|\r|\n/g)) {
    lines.push({start, end: newline.index});
    start = newline.index + newline[0].length;
  }
  lines.push({start, end: source.length});
  return lines;
}

function positionAt(
  lines: readonly SourceLine[],
  offset: number,
): {line: number; column: number} {
  let lower = 0;
  let upper = lines.length;
  while (lower + 1 < upper) {
    const middle = (lower + upper) >>> 1;
    if (lines[middle].start <= offset) lower = middle;
    else upper = middle;
  }
  return {
    line: lower + 1,
    column: Math.min(offset, lines[lower].end) - lines[lower].start + 1,
  };
}
