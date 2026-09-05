import ts from '@typescript/typescript6';
import type {Vec3} from '@code3d/core/tooling';

/** Adjust only the outer offset, preserving author expressions and trivia. */
export function offsetRelationSource(source: string, delta: Vec3): string {
  if (delta.every(value => value === 0)) return source;
  const prefix = 'const relation = ';
  const parsed = ts.createSourceFile(
    'relation.ts',
    `${prefix}${source};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = parsed.statements[0] as ts.VariableStatement;
  const expression = statement.declarationList.declarations[0].initializer!;
  const receiver = unparenthesize(expression);
  const text = (node: ts.Node) => node.getText(parsed);
  const replace = (
    node: ts.Node,
    replacement: string,
    within: string,
    start: number,
  ) =>
    within.slice(0, node.getStart(parsed) - start) +
    replacement +
    within.slice(node.end - start);

  const adjust = (node: ts.Expression, increment: number): string => {
    if (increment === 0) return text(node);
    if (ts.isParenthesizedExpression(node)) {
      return replace(
        node.expression,
        adjust(node.expression, increment),
        text(node),
        node.getStart(parsed),
      );
    }
    const number = sourceNumber(node);
    if (number !== undefined) return formatSourceNumber(number + increment);
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
        node.operatorToken.kind === ts.SyntaxKind.MinusToken)
    ) {
      const right = sourceNumber(node.right);
      if (right !== undefined) {
        const total =
          (node.operatorToken.kind === ts.SyntaxKind.PlusToken
            ? right
            : -right) + increment;
        const before = parsed.text.slice(
          node.getStart(parsed),
          node.operatorToken.getStart(parsed),
        );
        const between = parsed.text.slice(
          node.operatorToken.end,
          node.right.getStart(parsed),
        );
        const retained = before + between;
        return total === 0
          ? /[\r\n]/.test(retained)
            ? retained
            : retained.trimEnd()
          : `${before}${total < 0 ? '-' : '+'}${between}${formatSourceNumber(Math.abs(total))}`;
      }
    }
    const operand = isAdditiveOperand(node) ? text(node) : `(${text(node)})`;
    return `${operand} ${increment < 0 ? '-' : '+'} ${formatSourceNumber(Math.abs(increment))}`;
  };

  // A spread has no stable per-axis argument span. Append one editable offset;
  // later gestures will edit that outer call, never append another one.
  if (
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === 'offset' &&
    receiver.arguments.length === 3 &&
    receiver.arguments.every(argument => !ts.isSpreadElement(argument))
  ) {
    let result = source;
    for (let index = 2; index >= 0; index--) {
      if (delta[index] !== 0) {
        const argument = receiver.arguments[index];
        result = replace(
          argument,
          adjust(argument, delta[index]),
          result,
          prefix.length,
        );
      }
    }
    return result;
  }
  const target = isMemberReceiver(expression) ? source : `(${source})`;
  return `${target}.offset(${delta.map(formatSourceNumber).join(', ')})`;
}

function unparenthesize(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node)
    ? unparenthesize(node.expression)
    : node;
}

function sourceNumber(node: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    ts.isNumericLiteral(node.operand) &&
    (node.operator === ts.SyntaxKind.PlusToken ||
      node.operator === ts.SyntaxKind.MinusToken)
  ) {
    // Do not discard author comments between a sign and its literal.
    if (/\/\*|\/\//.test(node.getText())) return undefined;
    return (
      Number(node.operand.text) *
      (node.operator === ts.SyntaxKind.MinusToken ? -1 : 1)
    );
  }
  return undefined;
}

function isMemberReceiver(node: ts.Expression): boolean {
  return (
    ts.isIdentifier(node) ||
    ts.isCallExpression(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node)
  );
}

function isAdditiveOperand(node: ts.Expression): boolean {
  return (
    isMemberReceiver(node) ||
    ts.isNumericLiteral(node) ||
    ts.isPrefixUnaryExpression(node) ||
    ts.isAwaitExpression(node) ||
    (ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.PlusToken,
        ts.SyntaxKind.MinusToken,
        ts.SyntaxKind.AsteriskToken,
        ts.SyntaxKind.SlashToken,
        ts.SyntaxKind.PercentToken,
        ts.SyntaxKind.AsteriskAsteriskToken,
      ].includes(node.operatorToken.kind))
  );
}

export function formatSourceNumber(value: number): string {
  if (!Number.isFinite(value))
    throw new Error('An expression value must be a finite number.');
  return String(Number((Object.is(value, -0) ? 0 : value).toPrecision(12)));
}
