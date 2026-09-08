import ts from '@typescript/typescript6';

/** Locate a scalar inside a literal tuple without crossing an opaque expression. */
export function argumentExpression(
  arguments_: readonly ts.Expression[],
  path: readonly number[],
): ts.Expression | undefined {
  let expression = arguments_[path[0]];
  for (const index of path.slice(1)) {
    if (!expression) return undefined;
    expression = unwrapArgument(expression);
    if (!ts.isArrayLiteralExpression(expression)) return undefined;
    if (expression.elements.slice(0, index + 1).some(ts.isSpreadElement))
      return undefined;
    expression = expression.elements[index];
  }
  return expression && !ts.isOmittedExpression(expression)
    ? expression
    : undefined;
}

export function unwrapArgument(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  )
    expression = expression.expression;
  return expression;
}
