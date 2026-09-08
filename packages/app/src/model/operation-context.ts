import type {ModelOperationInputRole} from '@code3d/core/tooling';

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
