import type {
  ModelOperationInputRole,
  ModelOperationSnapshot,
} from '@code3d/core/tooling';

export function sameOperationCall(
  left: ModelOperationSnapshot | undefined,
  right: ModelOperationSnapshot | undefined,
): boolean {
  return (
    left === right ||
    !!(
      left &&
      right &&
      (left.id === right.id ||
        (left.siteId !== undefined &&
          left.siteId === right.siteId &&
          left.execution === right.execution))
    )
  );
}

export function isCompositionInputRole(
  role: ModelOperationInputRole | undefined,
): boolean {
  return (
    role === 'receiver' ||
    role === 'operand' ||
    role === 'tool' ||
    role === 'child' ||
    role === 'collection' ||
    role === 'section' ||
    role === 'spine'
  );
}
