import ts from '@typescript/typescript6';
import type {SourceRef, Vec3} from '@code3d/core/tooling';
import type {ToolArgumentEditTarget} from '../model/tool-schema';
import {unwrapArgument} from '../model/argument-path';

export type NumericArgumentValue = number | readonly NumericArgumentValue[];

export type CallArgumentDefaults = Readonly<{
  sourceRef: SourceRef;
  values: readonly NumericArgumentValue[];
}>;

/** Fill omitted values while retaining explicitly authored expressions and trivia. */
export function completeCallArgumentsSource(
  source: string,
  defaults: readonly NumericArgumentValue[],
): string {
  const {expression, prefixLength} = parseExpression(source);
  const edits: {start: number; end: number; text: string}[] = [];
  const visit = (
    container: ts.CallExpression | ts.ArrayLiteralExpression,
    values: readonly NumericArgumentValue[],
  ) => {
    const elements = ts.isCallExpression(container)
      ? container.arguments
      : container.elements;
    for (
      let index = 0;
      index < Math.min(elements.length, values.length);
      index++
    ) {
      const element = elements[index];
      if (ts.isSpreadElement(element)) return;
      if (ts.isOmittedExpression(element)) {
        const position = element.getStart() - prefixLength;
        edits.push({
          start: position,
          end: position,
          text: numericArgumentSource(values[index]),
        });
      } else if (typeof values[index] !== 'number') {
        const nested = unwrapArgument(element);
        if (ts.isArrayLiteralExpression(nested))
          visit(nested, values[index] as readonly NumericArgumentValue[]);
      }
    }
    if (elements.length < values.length) {
      const position = container.getEnd() - prefixLength - 1;
      const prefix = elements.length && !elements.hasTrailingComma ? ', ' : '';
      edits.push({
        start: position,
        end: position,
        text:
          prefix +
          values.slice(elements.length).map(numericArgumentSource).join(', '),
      });
    }
  };
  visit(unwrapArgument(expression) as ts.CallExpression, defaults);
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

/** Replace the current operation's opaque inputs after an explicit spatial edit. */
export function setCallArgumentsSource(
  source: string,
  values: readonly NumericArgumentValue[],
): string {
  const {expression, prefixLength} = parseExpression(source);
  const call = unwrapArgument(expression) as ts.CallExpression;
  const start = call.arguments.pos - prefixLength;
  const end = call.getEnd() - prefixLength - 1;
  return (
    source.slice(0, start) +
    values.map(numericArgumentSource).join(', ') +
    source.slice(end)
  );
}

export function replaceNumericArgument(
  values: readonly NumericArgumentValue[],
  path: readonly number[],
  value: number,
): readonly NumericArgumentValue[] {
  return values.map((current, index) =>
    index !== path[0]
      ? current
      : path.length === 1
        ? value
        : replaceNumericArgument(
            current as readonly NumericArgumentValue[],
            path.slice(1),
            value,
          ),
  );
}

function numericArgumentSource(value: NumericArgumentValue): string {
  return typeof value === 'number'
    ? formatSourceNumber(value)
    : `[${value.map(numericArgumentSource).join(', ')}]`;
}

/** Materialize only the containers and preceding defaults needed by this edit. */
export function argumentInsertionSource(
  expression: string,
  target: Extract<ToolArgumentEditTarget, {kind: 'omitted'}>,
): string {
  const value = (target.prefixes ?? [[]]).reduceRight(
    (value, prefix, index) => {
      const contents = [...prefix.map(formatSourceNumber), value].join(', ');
      return index === 0 ? contents : `[${contents}]`;
    },
    expression,
  );
  return target.needsComma ? `, ${value}` : value;
}

/** Validate one tuple value, without evaluating code outside its author scope. */
export function sourceExpressionError(source: string): string | undefined {
  const parsed = ts.createSourceFile(
    'expression.ts',
    `[${source}\n]`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics = (
    parsed as ts.SourceFile & {
      parseDiagnostics: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;
  if (diagnostics.length)
    return ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ');
  const statement = parsed.statements[0];
  if (
    parsed.statements.length !== 1 ||
    !statement ||
    !ts.isExpressionStatement(statement) ||
    !ts.isArrayLiteralExpression(statement.expression) ||
    statement.expression.elements.length !== 1 ||
    statement.expression.elements.hasTrailingComma ||
    ts.isSpreadElement(statement.expression.elements[0])
  )
    return 'Enter a single expression';
  return undefined;
}

/** Adjust only the outer offset call, preserving author expressions and trivia. */
export function offsetCallSource(
  source: string,
  method: 'offset' | 'originOffset',
  delta: Vec3,
  currentArguments?: Vec3,
): string {
  if (delta.every(value => value === 0)) return source;
  const {expression, prefixLength} = parseExpression(source);
  const receiver = unparenthesize(expression);
  if (
    currentArguments &&
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === method &&
    receiver.arguments.some(argument => ts.isSpreadElement(argument))
  ) {
    return setCallArgumentsSource(
      source,
      currentArguments.map((value, axis) => value + delta[axis]),
    );
  }
  // A spread has no stable per-axis argument span. Append one editable offset;
  // later gestures will edit that outer call, never append another one.
  if (
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === method &&
    receiver.arguments.length <= 3 &&
    receiver.arguments.every(argument => !ts.isSpreadElement(argument))
  ) {
    let result = source;
    if (receiver.arguments.length < delta.length) {
      const position = receiver.getEnd() - prefixLength - 1;
      const missing = delta.slice(receiver.arguments.length);
      const needsComma =
        receiver.arguments.length > 0 && !receiver.arguments.hasTrailingComma;
      result =
        result.slice(0, position) +
        (needsComma ? ', ' : '') +
        missing.map(formatSourceNumber).join(', ') +
        result.slice(position);
    }
    for (let index = receiver.arguments.length - 1; index >= 0; index--) {
      if (delta[index] !== 0) {
        const argument = receiver.arguments[index];
        result = replaceNode(
          argument,
          adjustExpression(argument, delta[index]),
          result,
          prefixLength,
        );
      }
    }
    return result;
  }
  const target = isMemberReceiver(expression) ? source : `(${source})`;
  return `${target}.${method}(${delta.map(formatSourceNumber).join(', ')})`;
}

/** Change a scalar expression without dropping comments or repeating evaluation. */
export function offsetExpression(source: string, delta: number): string {
  if (delta === 0) return source;
  const {expression, prefixLength} = parseExpression(source);
  return replaceNode(
    expression,
    adjustExpression(expression, delta),
    source,
    prefixLength,
  );
}

function parseExpression(source: string) {
  const prefix = 'const value = ';
  const parsed = ts.createSourceFile(
    'expression.ts',
    `${prefix}${source};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = parsed.statements[0] as ts.VariableStatement;
  return {
    expression: statement.declarationList.declarations[0].initializer!,
    prefixLength: prefix.length,
  };
}

function replaceNode(
  node: ts.Node,
  replacement: string,
  source: string,
  start: number,
): string {
  return (
    source.slice(0, node.getStart() - start) +
    replacement +
    source.slice(node.end - start)
  );
}

function adjustExpression(node: ts.Expression, increment: number): string {
  const text = node.getText();
  if (increment === 0) return text;
  if (ts.isParenthesizedExpression(node)) {
    return replaceNode(
      node.expression,
      adjustExpression(node.expression, increment),
      text,
      node.getStart(),
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
        (node.operatorToken.kind === ts.SyntaxKind.PlusToken ? right : -right) +
        increment;
      const parsed = node.getSourceFile();
      const before = parsed.text.slice(
        node.getStart(),
        node.operatorToken.getStart(),
      );
      const between = parsed.text.slice(
        node.operatorToken.end,
        node.right.getStart(),
      );
      const retained = before + between;
      return total === 0
        ? /[\r\n]/.test(retained)
          ? retained
          : retained.trimEnd()
        : `${before}${total < 0 ? '-' : '+'}${between}${formatSourceNumber(Math.abs(total))}`;
    }
  }
  const operand = isAdditiveOperand(node) ? text : `(${text})`;
  return `${operand} ${increment < 0 ? '-' : '+'} ${formatSourceNumber(Math.abs(increment))}`;
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
