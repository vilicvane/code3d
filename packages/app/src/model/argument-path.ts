import ts from '@typescript/typescript6';

/** Locate a scalar inside literal arrays or objects without crossing opaque code. */
export function argumentExpression(
  arguments_: readonly ts.Expression[],
  path: readonly (number | string)[],
): ts.Expression | undefined {
  if (typeof path[0] !== 'number') return undefined;
  let expression = arguments_[path[0]];
  for (const key of path.slice(1)) {
    if (!expression) return undefined;
    expression = unwrapArgument(expression);
    if (typeof key === 'number') {
      if (!ts.isArrayLiteralExpression(expression)) return undefined;
      if (expression.elements.slice(0, key + 1).some(ts.isSpreadElement))
        return undefined;
      expression = expression.elements[key];
    } else {
      if (!ts.isObjectLiteralExpression(expression)) return undefined;
      const member = literalObjectProperty(expression, key);
      if (member.kind !== 'present') return undefined;
      expression = member.property.initializer;
    }
  }
  return expression && !ts.isOmittedExpression(expression)
    ? expression
    : undefined;
}

/** Only a unique assignment in an unambiguous literal has an editable path. */
export function literalObjectProperty(
  object: ts.ObjectLiteralExpression,
  key: string,
):
  | Readonly<{kind: 'present'; property: ts.PropertyAssignment}>
  | Readonly<{kind: 'omitted'}>
  | Readonly<{kind: 'unknown'}> {
  if (
    object.properties.some(
      property =>
        ts.isSpreadAssignment(property) ||
        ('name' in property &&
          (!property.name || !staticPropertyName(property.name))),
    )
  )
    return {kind: 'unknown'};
  const matches = object.properties.filter(
    property =>
      'name' in property &&
      property.name &&
      staticPropertyName(property.name) === key,
  );
  if (
    matches.length > 1 ||
    (matches[0] && !ts.isPropertyAssignment(matches[0]))
  )
    return {kind: 'unknown'};
  return matches[0]
    ? {kind: 'present', property: matches[0] as ts.PropertyAssignment}
    : {kind: 'omitted'};
}

function staticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isComputedPropertyName(name)) {
    const value = unwrapArgument(name.expression);
    return ts.isStringLiteralLike(value) || ts.isNumericLiteral(value)
      ? value.text
      : undefined;
  }
  return ts.isIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
    ? name.text
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
