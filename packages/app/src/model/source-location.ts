import type {SourceRef} from '@code3d/core/tooling';
import {normalizeProjectPath} from '../project/project';
export function sourceRef(file: string, start: number, end: number): SourceRef {
  return {file: normalizeProjectPath(file), start, end};
}

export function sameSourceRef(left: SourceRef, right: SourceRef): boolean {
  return (
    left.file === right.file &&
    left.start === right.start &&
    left.end === right.end
  );
}
