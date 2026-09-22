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
  others: readonly ModelObject<{}, 'solid'>[];
}> {
  if (operands.length < 2) {
    throw new Error(`${operation} requires at least two model operands.`);
  }
  const runtimeOperands = operands.map(operand =>
    requireModelKind(
      operand,
      'solid',
      `Every ${operation} operand must be a solid model.`,
    ),
  );
  return {first: runtimeOperands[0], others: runtimeOperands.slice(1)};
}
