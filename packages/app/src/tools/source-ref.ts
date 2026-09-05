import type {SourceRef} from '@code3d/core/tooling';

type SourceTextChange = Readonly<{
  rangeOffset: number;
  rangeLength: number;
  text: string;
}>;

/**
 * Tool insertions beside an expression do not extend its range. An empty
 * insertion slot does grow, so another edit can replace what it just inserted.
 * User typing may extend tokens at either boundary before the next compile.
 */
export function rebaseSourceRef(
  sourceRef: SourceRef,
  changes: readonly SourceTextChange[],
  growAtBoundaries: boolean,
): SourceRef | undefined {
  let shift = 0;
  let internalDelta = 0;
  for (const change of [...changes].sort(
    (left, right) => left.rangeOffset - right.rangeOffset,
  )) {
    const changeStart = change.rangeOffset;
    const changeEnd = changeStart + change.rangeLength;
    const delta = change.text.length - change.rangeLength;
    if (
      change.rangeLength === 0 &&
      changeStart === sourceRef.start &&
      (growAtBoundaries || sourceRef.start === sourceRef.end)
    ) {
      internalDelta += delta;
    } else if (changeEnd <= sourceRef.start) {
      shift += delta;
    } else if (changeStart >= sourceRef.end) {
      if (
        growAtBoundaries &&
        change.rangeLength === 0 &&
        changeStart === sourceRef.end
      ) {
        internalDelta += delta;
      }
    } else if (changeStart === sourceRef.start && changeEnd === sourceRef.end) {
      const start = sourceRef.start + shift;
      return {
        file: sourceRef.file,
        start,
        end: start + change.text.length,
      };
    } else if (sourceRef.start <= changeStart && changeEnd <= sourceRef.end) {
      internalDelta += delta;
    } else {
      return undefined;
    }
  }
  return {
    file: sourceRef.file,
    start: sourceRef.start + shift,
    end: sourceRef.end + shift + internalDelta,
  };
}
