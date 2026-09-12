import ts from '@typescript/typescript6';
import type {SourceRef, Vec3} from '@code3d/core/tooling';
import type {ToolArgumentEditTarget} from '../model/tool-schema';
import {unwrapArgument} from '../model/argument-path';

export type TransformationConstructor =
  | 'offset'
  | 'rotate'
  | 'pivot'
  | 'pivotVertex'
  | 'pivotPoint'
  | 'aroundEdge'
  | 'aroundLine';

export type NumericArgumentValue = number | readonly NumericArgumentValue[];

/** Resolve a semantic call focus to identifier|(), never an arbitrary argument. */
export function callIdentifierOffset(
  source: string,
  at: number | string,
): number | undefined {
  const parsed = ts.createSourceFile(
    'tool.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let selected: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const matches =
        typeof at === 'number'
          ? node.getStart(parsed) <= at && at < node.end
          : node.expression.getText(parsed) === at ||
            (ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === at);
      if (
        matches &&
        (!selected ||
          (typeof at === 'number'
            ? node.end - node.getStart(parsed) <
              selected.end - selected.getStart(parsed)
            : node.expression.end > selected.expression.end))
      )
        selected = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return selected?.expression.end;
}

export type TransformationInsertion = Readonly<{
  sourceRef: SourceRef;
  container: 'array' | 'array-start' | 'return';
  name: string;
  importAddition?: Readonly<{
    sourceRef: SourceRef;
    specifier: string;
    statement: boolean;
  }>;
}>;

/** Locate a returned relation value and a safe binding for a new Core constructor. */
export function transformationInsertion(
  file: string,
  source: string,
  reference: SourceRef,
  operation: TransformationConstructor,
): TransformationInsertion | undefined {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let selected: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      node.getStart(parsed) === reference.start &&
      node.end === reference.end &&
      ts.isExpression(node)
    )
      selected = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return (
    selected && createTransformationInsertions(parsed)(selected)?.[operation]
  );
}

/** Compile source-only insertion metadata once; the executor consumes plain values. */
export function createTransformationInsertions(
  parsed: ts.SourceFile,
): (
  selected: ts.Expression,
) =>
  | Readonly<Record<TransformationConstructor, TransformationInsertion>>
  | undefined {
  const names = new Set<string>();
  const declarations = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    )
      declarations.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return selected => {
    let value: ts.Node = selected;
    while (
      value.parent &&
      (ts.isParenthesizedExpression(value.parent) ||
        ts.isAsExpression(value.parent) ||
        ts.isSatisfiesExpression(value.parent))
    )
      value = value.parent;
    const parent = value.parent;
    if (!parent) return undefined;
    const container = ts.isArrayLiteralExpression(value)
      ? 'array-start'
      : ts.isArrayLiteralExpression(parent)
        ? 'array'
        : ts.isReturnStatement(parent) ||
            (ts.isArrowFunction(parent) && parent.body === value)
          ? 'return'
          : undefined;
    if (!container) return undefined;
    const sourceRef = {
      file: parsed.fileName,
      start: value.getStart(parsed) + (container === 'array-start' ? 1 : 0),
      end: container === 'array-start' ? value.getStart(parsed) + 1 : value.end,
    };
    return Object.fromEntries(
      (
        [
          'offset',
          'rotate',
          'pivot',
          'pivotVertex',
          'pivotPoint',
          'aroundEdge',
          'aroundLine',
        ] as const
      ).map(operation => [
        operation,
        constructorInsertion(
          parsed,
          sourceRef,
          container,
          names,
          declarations,
          operation,
        ),
      ]),
    ) as Record<TransformationConstructor, TransformationInsertion>;
  };
}

function constructorInsertion(
  parsed: ts.SourceFile,
  sourceRef: SourceRef,
  container: TransformationInsertion['container'],
  names: ReadonlySet<string>,
  declarations: ReadonlySet<string>,
  operation: TransformationConstructor,
): TransformationInsertion {
  const file = parsed.fileName;
  const imports = parsed.statements.filter(ts.isImportDeclaration);
  const core = imports.filter(
    node =>
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '@code3d/core' &&
      !node.importClause?.isTypeOnly,
  );
  for (const declaration of core) {
    const bindings = declaration.importClause?.namedBindings;
    if (
      bindings &&
      ts.isNamespaceImport(bindings) &&
      !declarations.has(bindings.name.text)
    )
      return {sourceRef, container, name: `${bindings.name.text}.${operation}`};
    if (bindings && ts.isNamedImports(bindings)) {
      const binding = bindings.elements.find(
        value =>
          !value.isTypeOnly &&
          (value.propertyName ?? value.name).text === operation &&
          !declarations.has(value.name.text),
      );
      if (binding) return {sourceRef, container, name: binding.name.text};
    }
  }
  let name = operation as string;
  if (names.has(name)) {
    const base = `code3d${operation[0].toUpperCase()}${operation.slice(1)}`;
    name = base;
    for (let index = 2; names.has(name); index++) name = `${base}${index}`;
  }
  const specifier = name === operation ? operation : `${operation} as ${name}`;
  const bindings = core
    .map(node => node.importClause?.namedBindings)
    .find(
      (value): value is ts.NamedImports => !!value && ts.isNamedImports(value),
    );
  const at = imports.at(-1)?.getEnd() ?? 0;
  return {
    sourceRef,
    container,
    name,
    importAddition: {
      sourceRef: bindings
        ? {file, start: bindings.getStart(parsed), end: bindings.getEnd()}
        : {file, start: at, end: at},
      specifier,
      statement: !bindings,
    },
  };
}

export function transformationImportSource(
  source: string,
  specifier: string,
  statement: boolean,
): string {
  if (statement) return `\nimport {${specifier}} from '@code3d/core';\n`;
  const prefix = source.slice(0, source.lastIndexOf('}'));
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true);
  scanner.setText(prefix);
  let last = ts.SyntaxKind.OpenBraceToken;
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  )
    last = token;
  const separator =
    last === ts.SyntaxKind.OpenBraceToken || last === ts.SyntaxKind.CommaToken
      ? ''
      : ',';
  return `${prefix}${separator} ${specifier}}`;
}

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

/** Complete a selector on first angle input; subsequent edits retain every other argument. */
export function completeRotationSource(
  source: string,
  axisOnly: boolean,
  index: number,
  value: number,
): string {
  const {expression, prefixLength} = parseExpression(source);
  const call = unwrapArgument(expression);
  const completed =
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === 'rotate';
  if (!completed) {
    const target = isMemberReceiver(expression) ? source : `(${source})`;
    return `${target}.rotate(${Array.from({length: axisOnly ? 1 : 3}, (_, i) => formatSourceNumber(i === index ? value : 0)).join(', ')})`;
  }
  const argument = call.arguments[index];
  if (argument && !ts.isSpreadElement(argument))
    return replaceNode(
      argument,
      formatSourceNumber(value),
      source,
      prefixLength,
    );
  if (call.arguments.some(ts.isSpreadElement))
    throw new Error('A spread rotation cannot be edited before it evaluates.');
  const position = call.end - prefixLength - 1;
  const missing = Array.from(
    {length: Math.max(index + 1, axisOnly ? 1 : 3) - call.arguments.length},
    (_, i) =>
      formatSourceNumber(call.arguments.length + i === index ? value : 0),
  );
  return (
    source.slice(0, position) +
    (call.arguments.length && !call.arguments.hasTrailingComma ? ', ' : '') +
    missing.join(', ') +
    source.slice(position)
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

/** Keep the selected reference and authored expressions; report a new factory import. */
export function referenceOffsetSource(
  source: string,
  method: 'pivot' | 'pivotOffset' | 'axisOffset',
  values: Vec3,
  delta: Vec3,
  explicit: boolean,
  pivotConstructor?: string,
  append?: 'chain' | TransformationInsertion['container'],
): Readonly<{text: string; usesConstructor: boolean}> {
  if (delta.every(value => value === 0))
    return {text: source, usesConstructor: false};
  if (append) {
    if (append !== 'chain' && !pivotConstructor)
      throw new Error('The pivot constructor is not available in this scope.');
    const call = `${append === 'chain' ? 'pivot' : pivotConstructor}([${method === 'pivot' ? values.map(formatSourceNumber).join(', ') : '0, 0, 0'}])${method === 'pivot' ? '' : `.${method}(${values.map(formatSourceNumber).join(', ')})`}.rotate(0, 0, 0)`;
    return {
      text:
        append === 'chain'
          ? `${source}.${call}`
          : insertTransformationSource(source, call, append),
      usesConstructor: append !== 'chain',
    };
  }
  const {expression, prefixLength} = parseExpression(source);
  const rotation = unwrapArgument(expression);
  if (!ts.isCallExpression(rotation))
    throw new Error('Expected a rotation call.');
  const callee = rotation.expression;
  const member =
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'rotate' &&
    ts.isCallExpression(unwrapArgument(callee.expression));
  if (!member) {
    if (!pivotConstructor)
      throw new Error('The pivot constructor is not available in this scope.');
    const args = source.slice(
      rotation.arguments.pos - prefixLength,
      rotation.end - prefixLength - 1,
    );
    return {
      text: `${pivotConstructor}([${method === 'pivot' ? values.map(formatSourceNumber).join(', ') : '0, 0, 0'}])${method === 'pivot' ? '' : `.${method}(${values.map(formatSourceNumber).join(', ')})`}.rotate(${args})`,
      usesConstructor: true,
    };
  }
  const selector = unwrapArgument(callee.expression);
  if (method === 'pivot') {
    if (!explicit) {
      const at = callee.expression.end - prefixLength;
      return {
        text:
          source.slice(0, at) +
          `.pivot([${values.map(formatSourceNumber).join(', ')}])` +
          source.slice(at),
        usesConstructor: false,
      };
    }
    if (!ts.isCallExpression(selector))
      throw new Error('Expected a pivot selector.');
    const argument =
      selector.arguments[0] && unwrapArgument(selector.arguments[0]);
    const elements =
      argument &&
      ts.isArrayLiteralExpression(argument) &&
      !argument.elements.some(ts.isSpreadElement)
        ? argument.elements
        : undefined;
    const next = values.map((value, index) => {
      const current = elements?.[index];
      return current &&
        !ts.isOmittedExpression(current) &&
        current.getText() !== 'undefined'
        ? offsetExpression(
            source.slice(
              current.getStart() - prefixLength,
              current.end - prefixLength,
            ),
            delta[index],
          )
        : formatSourceNumber(value);
    });
    return {
      text:
        source.slice(0, selector.arguments.pos - prefixLength) +
        `[${next.join(', ')}]` +
        source.slice(selector.end - prefixLength - 1),
      usesConstructor: false,
    };
  }
  if (
    ts.isCallExpression(selector) &&
    ts.isPropertyAccessExpression(selector.expression) &&
    selector.expression.name.text === method
  ) {
    const opaque = selector.arguments.some(ts.isSpreadElement);
    const next = values.map((value, index) => {
      const current = selector.arguments[index];
      return current && !opaque
        ? offsetExpression(
            source.slice(
              current.getStart() - prefixLength,
              current.end - prefixLength,
            ),
            delta[index],
          )
        : formatSourceNumber(value);
    });
    return {
      text:
        source.slice(0, selector.arguments.pos - prefixLength) +
        next.join(', ') +
        source.slice(selector.end - prefixLength - 1),
      usesConstructor: false,
    };
  }
  const at = callee.expression.end - prefixLength;
  return {
    text:
      source.slice(0, at) +
      `${explicit ? '' : '.pivot([0, 0, 0])'}.${method}(${values.map(formatSourceNumber).join(', ')})` +
      source.slice(at),
    usesConstructor: false,
  };
}

/** Locate the self binding in the enclosing relate callback. */
export function relationSelfExpression(
  file: string,
  source: string,
  ref: SourceRef,
): string | undefined {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let result: string | undefined;
  const visit = (node: ts.Node) => {
    if (node.getStart(parsed) > ref.start || node.end < ref.end) return;
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isCallExpression(node.parent) &&
      ts.isPropertyAccessExpression(node.parent.expression) &&
      node.parent.expression.name.text === 'relate'
    ) {
      const name = node.parameters[0]?.name;
      if (name && ts.isIdentifier(name)) result = name.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return result;
}

export type RotationReferenceEdit = Readonly<{
  /** A reference chain may not yet end in rotate. Complete it in the same edit. */
  draft?: boolean;
  selector: 'pivotVertex' | 'pivotPoint' | 'aroundEdge' | 'aroundLine';
  expression: string;
  factory?: TransformationInsertion;
  previous: 'point' | 'axis';
  explicit: boolean;
  append?: 'chain' | TransformationInsertion['container'];
}>;

/** Replace only the rotation reference; keep same-family angles and offset expressions. */
export function rotationReferenceSource(
  source: string,
  edit: RotationReferenceEdit,
): Readonly<{text: string; usesConstructor: boolean}> {
  const axis = edit.selector === 'aroundLine' || edit.selector === 'aroundEdge';
  const angles = axis ? '0' : '0, 0, 0';
  const selector = `${edit.selector}(${edit.expression})`;
  if (edit.append) {
    const call = `${edit.factory?.name ?? edit.selector}(${edit.expression}).rotate(${angles})`;
    if (edit.append === 'chain')
      return {
        text: `${source}.${selector}.rotate(${angles})`,
        usesConstructor: false,
      };
    if (!edit.factory)
      throw new Error(
        'The rotation constructor is not available in this scope.',
      );
    return {
      text: insertTransformationSource(source, call, edit.append),
      usesConstructor: true,
    };
  }
  const {expression, prefixLength} = parseExpression(source);
  const rotation = unwrapArgument(expression);
  if (!ts.isCallExpression(rotation))
    throw new Error('Expected a rotation call.');
  if (axis !== (edit.previous === 'axis'))
    throw new Error('A different rotation tool must append a new operation.');
  if (
    edit.draft &&
    !(
      ts.isPropertyAccessExpression(rotation.expression) &&
      rotation.expression.name.text === 'rotate'
    )
  )
    return rotationReferenceSource(`${source}.rotate(${angles})`, {
      ...edit,
      draft: false,
    });
  const args = source.slice(
    rotation.arguments.pos - prefixLength,
    rotation.end - prefixLength - 1,
  );
  const callee = rotation.expression;
  const member =
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'rotate' &&
    ts.isCallExpression(unwrapArgument(callee.expression));
  if (!member) {
    if (!edit.factory)
      throw new Error(
        'The rotation constructor is not available in this scope.',
      );
    return {
      text: `${edit.factory.name}(${edit.expression}).rotate(${args})`,
      usesConstructor: true,
    };
  }
  let selected = unwrapArgument(callee.expression);
  let displacement = '';
  if (
    ts.isCallExpression(selected) &&
    ts.isPropertyAccessExpression(selected.expression) &&
    ['pivotOffset', 'axisOffset'].includes(selected.expression.name.text)
  ) {
    displacement = source.slice(
      selected.expression.expression.end - prefixLength,
      selected.end - prefixLength,
    );
    selected = unwrapArgument(selected.expression.expression);
  }
  if (!edit.explicit)
    return {
      text:
        source.slice(0, callee.expression.end - prefixLength) +
        `.${selector}.rotate(${args})`,
      usesConstructor: false,
    };
  if (!ts.isCallExpression(selected))
    throw new Error('Expected a rotation reference selector.');
  const selectedCallee = selected.expression;
  // A selector is either a Constraint method or a free (possibly aliased/namespace) constructor.
  const chain =
    ts.isPropertyAccessExpression(selectedCallee) &&
    ts.isCallExpression(unwrapArgument(selectedCallee.expression));
  if (chain)
    return {
      text:
        source.slice(0, selectedCallee.name.getStart() - prefixLength) +
        selector +
        displacement +
        `.rotate(${args})`,
      usesConstructor: false,
    };
  if (!edit.factory)
    throw new Error('The rotation constructor is not available in this scope.');
  return {
    text: `${edit.factory.name}(${edit.expression})${displacement}.rotate(${args})`,
    usesConstructor: true,
  };
}

/** A single source insertion policy shared by drag, reference selection and array gaps. */
export function insertTransformationSource(
  source: string,
  call: string,
  container: TransformationInsertion['container'],
): string {
  return container === 'array-start'
    ? `${call}, `
    : container === 'array'
      ? `${source}, ${call}`
      : `[${source}, ${call}]`;
}
