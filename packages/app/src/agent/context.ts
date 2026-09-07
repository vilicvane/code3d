import type {AgentCursor} from '@code3d/agent';
import type {SourceRef} from '@code3d/core/tooling';

/** Match the current editor selection using exactly one capture and a unique line range. */
export function contextCursor(source: string, ref: SourceRef): AgentCursor {
  const start =
    ref.start === 0 ? 0 : source.lastIndexOf('\n', ref.start - 1) + 1;
  const newline = source.indexOf('\n', ref.end);
  let end = newline < 0 ? source.length : newline;
  if (end > ref.end && source[end - 1] === '\r') end--;
  const escape = (value: string) =>
    value
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replaceAll('\r', '\\r')
      .replaceAll('\n', '\\n');
  return {
    file: ref.file,
    flags: 'mu',
    lines: [
      source.slice(0, start).split('\n').length,
      source.slice(0, end).split('\n').length,
    ],
    regex:
      '^' +
      escape(source.slice(start, ref.start)) +
      '(' +
      escape(source.slice(ref.start, ref.end)) +
      ')' +
      escape(source.slice(ref.end, end)) +
      '$',
  };
}
