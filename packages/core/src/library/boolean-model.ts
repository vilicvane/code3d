import {
  requireModelKind,
  type ModelObject,
  type SolidModel,
} from './runtime.js';
export function booleanOperands(
  operation: 'union' | 'intersect',
  operands: readonly SolidModel<{}>[],
): Readonly<{
  first: ModelObject<{}, 'solid'>;
  others: readonly SolidModel<{}>[];
}> {
  if (operands.length < 2) {
    throw new Error(`${operation} requires at least two model operands.`);
  }
  return {
    first: requireModelKind(
      operands[0],
      'solid',
      `Every ${operation} operand must be a solid model.`,
    ),
    others: operands.slice(1),
  };
}
