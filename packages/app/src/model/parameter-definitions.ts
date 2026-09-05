import ts from '@typescript/typescript6';
import type {SourceRef} from '@code3d/core/tooling';
import {normalizeProjectPath} from '../project/project';
import type {ToolSignatureSchema} from './tool-schema';

export type SourceParameterTarget = Readonly<{
  sourceRef: SourceRef;
  value: number;
  label: string;
}>;

export type ParameterDefinitionMap = ReadonlyMap<string, SourceParameterTarget>;

export function indexParameterDefinitions(
  call: ts.CallExpression,
  signature: ToolSignatureSchema,
  checker: ts.TypeChecker,
  cache: Map<ts.Symbol, SourceParameterTarget | null>,
  definitions: Map<string, SourceParameterTarget>,
  sourceFile: ts.SourceFile,
): void {
  for (const parameter of signature.parameters) {
    if (isSelectionParameter(parameter.kind)) continue;
    const argument = call.arguments[parameter.index];
    if (!argument) continue;
    const visit = (node: ts.Node): void => {
      if (isParameterReference(node)) {
        const target = parameterTargetForReference(node, checker, cache);
        if (target) {
          definitions.set(
            sourceNodeKey(node.getStart(sourceFile), node.getEnd()),
            target,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(argument);
  }
}

export function sourceNodeKey(start: number, end: number): string {
  return `${start}:${end}`;
}

type ParameterReference =
  ts.Identifier | ts.PropertyAccessExpression | ts.ElementAccessExpression;

function isParameterReference(node: ts.Node): node is ParameterReference {
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    return true;
  }
  return ts.isIdentifier(node) && isValueIdentifier(node);
}

function parameterTargetForReference(
  reference: ParameterReference,
  checker: ts.TypeChecker,
  cache: Map<ts.Symbol, SourceParameterTarget | null>,
): SourceParameterTarget | undefined {
  const symbol = symbolAtParameterReference(reference, checker);
  return symbol ? parameterTargetForSymbol(symbol, checker, cache) : undefined;
}

function parameterTargetForSymbol(
  input: ts.Symbol,
  checker: ts.TypeChecker,
  cache: Map<ts.Symbol, SourceParameterTarget | null>,
): SourceParameterTarget | undefined {
  const symbol =
    input.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(input)
      : input;
  const cached = cache.get(symbol);
  if (cached !== undefined) return cached ?? undefined;

  // A null entry also breaks circular alias/initializer chains while resolving.
  cache.set(symbol, null);
  const declarations = symbol.getDeclarations() ?? [];
  if (declarations.length !== 1) return undefined;
  const declaration = declarations[0];

  if (ts.isShorthandPropertyAssignment(declaration)) {
    const valueSymbol = checker.getShorthandAssignmentValueSymbol(declaration);
    const target = valueSymbol
      ? parameterTargetForSymbol(valueSymbol, checker, cache)
      : undefined;
    cache.set(symbol, target ?? null);
    return target;
  }

  if (ts.isBindingElement(declaration)) {
    const valueSymbol = bindingElementValueSymbol(declaration, checker);
    const target = valueSymbol
      ? parameterTargetForSymbol(valueSymbol, checker, cache)
      : undefined;
    cache.set(symbol, target ?? null);
    return target;
  }

  const initializer = parameterDefinitionInitializer(declaration);
  if (!initializer) return undefined;
  const valueExpression = unwrapDefinitionExpression(initializer);
  const value = numericExpressionValue(valueExpression);
  if (value !== undefined) {
    const target = sourceParameterTarget(declaration, valueExpression, value);
    cache.set(symbol, target);
    return target;
  }
  if (!isParameterReference(valueExpression)) return undefined;

  const target = parameterTargetForReference(valueExpression, checker, cache);
  cache.set(symbol, target ?? null);
  return target;
}

function bindingElementValueSymbol(
  declaration: ts.BindingElement,
  checker: ts.TypeChecker,
  resolving = new Set<ts.Symbol>(),
): ts.Symbol | undefined {
  const pattern = declaration.parent;
  if (ts.isObjectBindingPattern(pattern)) {
    const name = declaration.propertyName ?? declaration.name;
    const property =
      ts.isIdentifier(name) ||
      ts.isStringLiteralLike(name) ||
      ts.isNumericLiteral(name)
        ? name.text
        : undefined;
    const object = bindingPatternObject(pattern, checker, resolving);
    return property !== undefined && object
      ? objectPropertySymbol(object, property, checker)
      : undefined;
  }
  const type = checker.getTypeAtLocation(pattern);
  const index = pattern.elements.indexOf(declaration);
  return index >= 0
    ? checker.getPropertyOfType(type, String(index))
    : undefined;
}

function bindingPatternObject(
  pattern: ts.ObjectBindingPattern,
  checker: ts.TypeChecker,
  resolving: Set<ts.Symbol>,
): ts.ObjectLiteralExpression | undefined {
  const parent = pattern.parent;
  if (ts.isVariableDeclaration(parent) && parent.name === pattern) {
    return parent.initializer
      ? concreteObjectExpression(parent.initializer, checker, resolving)
      : undefined;
  }
  if (
    ts.isBindingElement(parent) &&
    parent.name === pattern &&
    ts.isObjectBindingPattern(parent.parent)
  ) {
    const container = bindingPatternObject(parent.parent, checker, resolving);
    const name = parent.propertyName;
    if (!container || !name) return undefined;
    const property =
      ts.isIdentifier(name) ||
      ts.isStringLiteralLike(name) ||
      ts.isNumericLiteral(name)
        ? name.text
        : undefined;
    if (property === undefined) return undefined;
    const symbol = objectPropertySymbol(container, property, checker);
    return symbol
      ? concreteObjectForSymbol(symbol, checker, resolving)
      : undefined;
  }
  return undefined;
}

function symbolAtParameterReference(
  reference: ParameterReference,
  checker: ts.TypeChecker,
  resolving = new Set<ts.Symbol>(),
): ts.Symbol | undefined {
  if (ts.isPropertyAccessExpression(reference)) {
    return propertyValueSymbol(
      reference.expression,
      reference.name.text,
      checker,
      resolving,
    );
  }
  if (ts.isElementAccessExpression(reference)) {
    const propertyName = elementAccessPropertyName(
      reference.argumentExpression,
      checker,
    );
    return propertyName === undefined
      ? undefined
      : propertyValueSymbol(
          reference.expression,
          propertyName,
          checker,
          resolving,
        );
  }
  return checker.getSymbolAtLocation(reference);
}

function propertyValueSymbol(
  receiver: ts.Expression,
  name: string,
  checker: ts.TypeChecker,
  resolving: Set<ts.Symbol>,
): ts.Symbol | undefined {
  const object = concreteObjectExpression(receiver, checker, resolving);
  if (object) {
    return objectPropertySymbol(object, name, checker);
  }
  const receiverValue = definitionValueExpression(receiver, checker, resolving);
  if (
    receiverValue &&
    !ts.isNewExpression(receiverValue) &&
    receiverValue.kind !== ts.SyntaxKind.ThisKeyword &&
    receiverValue.kind !== ts.SyntaxKind.SuperKeyword
  ) {
    return undefined;
  }

  const symbol = checker.getPropertyOfType(
    checker.getTypeAtLocation(receiver),
    name,
  );
  const declarations = symbol?.getDeclarations() ?? [];
  return declarations.some(
    declaration =>
      ts.isPropertyAssignment(declaration) ||
      ts.isShorthandPropertyAssignment(declaration),
  )
    ? undefined
    : symbol;
}

function objectPropertySymbol(
  object: ts.ObjectLiteralExpression,
  name: string,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const properties = object.properties.filter(
    (
      property,
    ): property is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property)) &&
      propertyName(property.name) === name,
  );
  return properties.length === 1
    ? checker.getSymbolAtLocation(properties[0].name)
    : undefined;
}

function concreteObjectExpression(
  input: ts.Expression,
  checker: ts.TypeChecker,
  resolving: Set<ts.Symbol>,
): ts.ObjectLiteralExpression | undefined {
  const value = definitionValueExpression(input, checker, resolving);
  return value && ts.isObjectLiteralExpression(value) ? value : undefined;
}

function definitionValueExpression(
  input: ts.Expression,
  checker: ts.TypeChecker,
  resolving: Set<ts.Symbol>,
): ts.Expression | undefined {
  const expression = unwrapDefinitionExpression(input);
  if (!isParameterReference(expression)) return expression;

  const inputSymbol = symbolAtParameterReference(
    expression,
    checker,
    resolving,
  );
  if (!inputSymbol) return undefined;
  return definitionValueForSymbol(inputSymbol, checker, resolving);
}

function definitionValueForSymbol(
  input: ts.Symbol,
  checker: ts.TypeChecker,
  resolving: Set<ts.Symbol>,
): ts.Expression | undefined {
  const symbol =
    input.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(input)
      : input;
  if (resolving.has(symbol)) return undefined;
  resolving.add(symbol);
  try {
    const declarations = symbol.getDeclarations() ?? [];
    if (declarations.length !== 1) return undefined;
    const declaration = declarations[0];
    if (ts.isShorthandPropertyAssignment(declaration)) {
      const valueSymbol =
        checker.getShorthandAssignmentValueSymbol(declaration);
      return valueSymbol
        ? definitionValueForSymbol(valueSymbol, checker, resolving)
        : undefined;
    }
    if (ts.isBindingElement(declaration)) {
      const valueSymbol = bindingElementValueSymbol(
        declaration,
        checker,
        resolving,
      );
      return valueSymbol
        ? definitionValueForSymbol(valueSymbol, checker, resolving)
        : undefined;
    }
    const initializer = parameterDefinitionInitializer(declaration);
    return initializer
      ? definitionValueExpression(initializer, checker, resolving)
      : undefined;
  } finally {
    resolving.delete(symbol);
  }
}

function concreteObjectForSymbol(
  input: ts.Symbol,
  checker: ts.TypeChecker,
  resolving: Set<ts.Symbol>,
): ts.ObjectLiteralExpression | undefined {
  const value = definitionValueForSymbol(input, checker, resolving);
  return value && ts.isObjectLiteralExpression(value) ? value : undefined;
}

function elementAccessPropertyName(
  argument: ts.Expression,
  checker: ts.TypeChecker,
): string | undefined {
  if (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) {
    return argument.text;
  }
  const type = checker.getTypeAtLocation(argument);
  if (type.flags & ts.TypeFlags.StringLiteral) {
    return (type as ts.StringLiteralType).value;
  }
  if (type.flags & ts.TypeFlags.NumberLiteral) {
    return String((type as ts.NumberLiteralType).value);
  }
  return undefined;
}

function parameterDefinitionInitializer(
  declaration: ts.Declaration,
): ts.Expression | undefined {
  if (
    ts.isVariableDeclaration(declaration) ||
    ts.isPropertyAssignment(declaration) ||
    ts.isPropertyDeclaration(declaration) ||
    ts.isEnumMember(declaration)
  ) {
    return declaration.initializer;
  }
  return undefined;
}

function unwrapDefinitionExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return unwrapDefinitionExpression(expression.expression);
  }
  return expression;
}

function sourceParameterTarget(
  declaration: ts.Declaration,
  expression: ts.Expression,
  value: number,
): SourceParameterTarget {
  const sourceFile = expression.getSourceFile();
  return {
    sourceRef: {
      file: normalizeProjectPath(sourceFile.fileName),
      start: expression.getStart(sourceFile),
      end: expression.getEnd(),
    },
    value,
    label: humanizeIdentifier(parameterDefinitionName(declaration)),
  };
}

function parameterDefinitionName(declaration: ts.Declaration): string {
  if (
    ts.isVariableDeclaration(declaration) ||
    ts.isPropertyAssignment(declaration) ||
    ts.isPropertyDeclaration(declaration) ||
    ts.isEnumMember(declaration)
  ) {
    const name = declaration.name;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
      return name.text;
    }
    if (ts.isNumericLiteral(name)) return name.text;
  }
  return 'parameter';
}

function numericExpressionValue(node: ts.Node): number | undefined {
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text);
    return Number.isFinite(value) ? value : undefined;
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.PlusToken ||
      node.operator === ts.SyntaxKind.MinusToken) &&
    ts.isNumericLiteral(node.operand)
  ) {
    const value = Number(node.getText());
    return Number.isFinite(value) ? value : undefined;
  }
  if (ts.isParenthesizedExpression(node)) {
    return numericExpressionValue(node.expression);
  }
  return undefined;
}

function isValueIdentifier(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) {
    return false;
  }
  if ((parent as ts.NamedDeclaration).name === identifier) {
    return ts.isShorthandPropertyAssignment(parent);
  }
  return true;
}

function isSelectionParameter(kind: string): boolean {
  return kind === 'vertex' || kind === 'edge' || kind === 'surface';
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name)
    ? name.text
    : ts.isNumericLiteral(name)
      ? name.text
      : undefined;
}

function humanizeIdentifier(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .trim();
  return words.length === 0
    ? value
    : `${words[0].toUpperCase()}${words.slice(1)}`;
}
