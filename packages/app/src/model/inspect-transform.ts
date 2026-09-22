import ts from '@typescript/typescript6';
import type {
  InspectCallSite,
  InspectDefinition,
  InspectSignature,
  ProjectInspectionIndex,
} from './inspect-schema';
import {sourceNodeKey} from './parameter-definitions';
import {sourceRef} from './source-location';

/** Emit lexical callback bindings and capture calls without re-evaluating their callee. */
export class InspectTransform {
  private readonly definitions: readonly InspectDefinition[];
  private readonly calls: ReadonlyMap<string, InspectSignature>;
  private readonly getters = new Map<string, ts.Identifier>();

  constructor(
    private readonly file: ts.SourceFile,
    index: ProjectInspectionIndex,
    private readonly factory: ts.NodeFactory,
    private readonly sites: Map<string, InspectCallSite>,
    private readonly propertyId: (node: ts.Node) => string,
    private readonly traceProperty: (
      node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
      read: ts.Expression,
      id: string,
    ) => ts.Expression,
  ) {
    this.definitions = index.definitions.get(file.fileName) ?? [];
    this.calls = index.calls.get(file.fileName) ?? new Map();
    for (const definition of this.definitions)
      this.getters.set(
        definition.id,
        factory.createUniqueName('__inspectBindings'),
      );
  }

  node(original: ts.Node, visited: ts.Node): ts.Node {
    const {factory} = this;
    if (
      ts.isSourceFile(visited) ||
      ts.isBlock(visited) ||
      ts.isModuleBlock(visited)
    ) {
      const definitions = this.definitions.filter(definition =>
        sameNode(definition.scope, original),
      );
      const prefix = definitions.flatMap(definition => {
        const getter = this.getters.get(definition.id)!;
        const bindings = definition.bindings.map(binding =>
          binding.kind === 'local'
            ? factory.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                pathExpression(binding.path, factory),
              )
            : factory.createVoidZero(),
        );
        const statements: ts.Statement[] = [
          constant(
            getter,
            factory.createArrayLiteralExpression(bindings),
            factory,
          ),
        ];
        if (
          ts.isFunctionDeclaration(definition.implementation) &&
          definition.implementation.name
        ) {
          statements.push(
            factory.createExpressionStatement(
              this.runtime('inspectDefinition', [
                factory.createStringLiteral(definition.id),
                getter,
                factory.createIdentifier(definition.implementation.name.text),
              ]),
            ),
          );
        }
        return statements;
      });
      const statements = withPrefix(visited.statements, prefix);
      if (ts.isSourceFile(visited))
        return factory.updateSourceFile(visited, statements);
      if (ts.isBlock(visited)) return factory.updateBlock(visited, statements);
      return factory.updateModuleBlock(visited, statements);
    }
    const definitions = this.definitions.filter(definition =>
      sameNode(definition.implementation, original),
    );
    for (const definition of definitions) {
      const args = [
        factory.createStringLiteral(definition.id),
        this.getters.get(definition.id)!,
      ];
      if (ts.isVariableDeclaration(visited) && visited.initializer) {
        visited = factory.updateVariableDeclaration(
          visited,
          visited.name,
          visited.exclamationToken,
          visited.type,
          this.runtime('inspectDefinition', [...args, visited.initializer]),
        );
      } else if (ts.isGetAccessorDeclaration(visited) && visited.body) {
        visited = factory.updateGetAccessorDeclaration(
          visited,
          visited.modifiers,
          visited.name,
          visited.parameters,
          visited.type,
          factory.updateBlock(
            visited.body,
            withPrefix(visited.body.statements, [
              factory.createExpressionStatement(
                this.runtime('inspectMethod', args),
              ),
            ]),
          ),
        );
      } else if (ts.isMethodDeclaration(visited) && visited.body) {
        const statement = factory.createExpressionStatement(
          this.runtime('inspectMethod', args),
        );
        visited = factory.updateMethodDeclaration(
          visited,
          visited.modifiers,
          visited.asteriskToken,
          visited.name,
          visited.questionToken,
          visited.typeParameters,
          visited.parameters,
          visited.type,
          factory.updateBlock(
            visited.body,
            withPrefix(visited.body.statements, [statement]),
          ),
        );
      }
    }
    return visited;
  }

  call(
    original: ts.CallExpression,
    visited: ts.CallExpression,
    siteId: string,
  ): ts.Expression | undefined {
    const signature = this.calls.get(
      sourceNodeKey(original.getStart(this.file), original.end),
    );
    if (!signature) return undefined;
    const {factory, file} = this;
    const expression = original.expression;
    const access = unwrapReference(expression);
    const selector = ts.isPropertyAccessExpression(access)
      ? access.name
      : ts.isElementAccessExpression(access)
        ? access.argumentExpression
        : expression;
    this.sites.set(siteId, {
      siteId,
      sourceRef: location(selector, file),
      callRef: location(original, file),
      argumentInsertionRef:
        !original.arguments.length || original.arguments.hasTrailingComma
          ? sourceRef(file.fileName, original.arguments.end, original.end - 1)
          : undefined,
      receiverRef:
        ts.isPropertyAccessExpression(access) ||
        ts.isElementAccessExpression(access)
          ? location(access.expression, file)
          : undefined,
      arguments: original.arguments.map((argument, index) => ({
        ...argumentScope(argument, file),
        sourceRef: sourceRef(
          file.fileName,
          argument.pos,
          index + 1 < original.arguments.length
            ? original.arguments[index + 1].pos - 1
            : original.arguments.hasTrailingComma
              ? original.arguments.end - 1
              : original.end - 1,
        ),
      })),
      signature,
    });

    // Ordinary calls only need their source scope and traced return for default
    // parameter preview. Capture the invocation itself only for annotated calls.
    if (
      !signature.annotations.length &&
      !signature.diagnostic &&
      !this.hasInspectedProperty(visited.expression)
    )
      return undefined;

    const {reference, statements, capture} = this.lowerReference(
      visited.expression,
    );
    const callable = capture(reference.value);
    if (visited.questionDotToken) {
      statements.push(
        factory.createIfStatement(
          factory.createBinaryExpression(
            callable,
            ts.SyntaxKind.EqualsEqualsToken,
            factory.createNull(),
          ),
          factory.createReturnStatement(factory.createVoidZero()),
        ),
      );
    }
    const args = visited.arguments.map((argument, index) => {
      const value = this.runtime(
        ts.isSpreadElement(argument) ? 'inspectSpread' : 'inspectArgument',
        [
          factory.createStringLiteral(siteId),
          factory.createNumericLiteral(index),
          ts.isSpreadElement(argument) ? argument.expression : argument,
        ],
      );
      return ts.isSpreadElement(argument)
        ? factory.createSpreadElement(value)
        : value;
    });
    statements.push(
      factory.createReturnStatement(
        this.runtime('inspectCall', [
          factory.createStringLiteral(siteId),
          callable,
          reference.receiver,
          factory.createArrayLiteralExpression(args),
        ]),
      ),
    );
    return iife(statements, factory);
  }

  property(
    original: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    visited: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    siteId: string,
  ): ts.Expression | undefined {
    const signature = this.calls.get(
      sourceNodeKey(original.getStart(this.file), original.end),
    );
    const {factory, file} = this;
    if (!signature) {
      if (!this.hasInspectedProperty(visited.expression)) return;
      const {reference, statements} = this.lowerReference(visited);
      statements.push(factory.createReturnStatement(reference.value));
      return iife(statements, factory);
    }
    const selector = ts.isPropertyAccessExpression(original)
      ? original.name
      : original.argumentExpression;
    this.sites.set(siteId, {
      siteId,
      sourceRef: location(selector, file),
      callRef: location(original, file),
      receiverRef: location(original.expression, file),
      arguments: [],
      signature,
    });
    const {reference, statements} = this.lowerReference(visited);
    statements.push(
      factory.createReturnStatement(
        this.runtime('inspectRead', [
          factory.createStringLiteral(siteId),
          this.runtime('elementReceiver', [
            factory.createStringLiteral(file.fileName),
            factory.createNumericLiteral(original.expression.getStart(file)),
            factory.createNumericLiteral(original.expression.end),
            factory.createStringLiteral(`${siteId}:receiver`),
            reference.receiver,
          ]),
          factory.createArrowFunction(
            undefined,
            undefined,
            [],
            undefined,
            factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            reference.value,
          ),
        ]),
      ),
    );
    return iife(statements, factory);
  }

  private hasInspectedProperty(node: ts.Expression): boolean {
    if (!ts.isOptionalChain(node)) return false;
    const original = ts.getOriginalNode(node);
    return (
      ((ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
        this.calls.has(
          sourceNodeKey(original.getStart(this.file), original.end),
        )) ||
      ('expression' in node &&
        this.hasInspectedProperty(node.expression as ts.Expression))
    );
  }

  private lowerReference(expression: ts.Expression) {
    const {factory, file} = this;
    // An arrow preserves lexical this, arguments, super and new.target. The
    // existing traceability boundary already excludes await/yield expressions.
    const statements: ts.Statement[] = [];
    const capture = (
      value: ts.Expression,
      into = statements,
    ): ts.Identifier => {
      const name = factory.createUniqueName('__inspectValue');
      into.push(constant(name, value, factory));
      return name;
    };
    const lower = (
      node: ts.Expression,
      into: ts.Statement[],
      shortCircuit: ts.Expression,
    ): {value: ts.Expression; receiver: ts.Expression} => {
      const nothing = factory.createVoidZero();
      const guard = (value: ts.Expression): void => {
        into.push(
          factory.createIfStatement(
            factory.createBinaryExpression(
              value,
              ts.SyntaxKind.EqualsEqualsToken,
              factory.createNull(),
            ),
            factory.createReturnStatement(shortCircuit),
          ),
        );
      };
      if (
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node) ||
        ts.isSatisfiesExpression(node)
      ) {
        // Parentheses end optional short-circuiting, but preserve a member's this.
        const inner: ts.Statement[] = [];
        const reference = lower(
          node.expression,
          inner,
          factory.createArrayLiteralExpression([nothing, nothing]),
        );
        inner.push(
          factory.createReturnStatement(
            factory.createArrayLiteralExpression([
              reference.value,
              reference.receiver,
            ]),
          ),
        );
        const pair = capture(iife(inner, factory), into);
        return {
          value: factory.createElementAccessExpression(pair, 0),
          receiver: factory.createElementAccessExpression(pair, 1),
        };
      }
      if (ts.isNonNullExpression(node))
        return lower(node.expression, into, shortCircuit);
      if (
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)
      ) {
        if (node.expression.kind === ts.SyntaxKind.SuperKeyword)
          return {value: node, receiver: factory.createThis()};
        const receiver = capture(
          ts.isOptionalChain(node.expression)
            ? lower(node.expression, into, shortCircuit).value
            : node.expression,
          into,
        );
        if (node.questionDotToken) guard(receiver);
        let value: ts.Expression = ts.isPropertyAccessExpression(node)
          ? factory.createPropertyAccessExpression(receiver, node.name)
          : factory.createElementAccessExpression(
              receiver,
              node.argumentExpression,
            );
        // Continued optional chains are lowered together; inspect a reached
        // intermediate read only after its nullish guard, keeping its own scope.
        const original = ts.getOriginalNode(node) as typeof node;
        if (
          node !== expression &&
          this.calls.has(sourceNodeKey(original.getStart(file), original.end))
        ) {
          const id = this.propertyId(original);
          const read = this.property(original, value as typeof node, id)!;
          value = this.traceProperty(original, read, id);
        } else if (ts.isElementAccessExpression(node)) {
          value = factory.createElementAccessExpression(
            receiver,
            capture(node.argumentExpression, into),
          );
        }
        return {value, receiver};
      }
      if (ts.isCallExpression(node) && ts.isOptionalChain(node)) {
        const reference = lower(node.expression, into, shortCircuit);
        const callable = capture(reference.value, into);
        if (node.questionDotToken) guard(callable);
        return {
          value: this.runtime('apply', [
            callable,
            reference.receiver,
            factory.createArrayLiteralExpression(node.arguments),
          ]),
          receiver: nothing,
        };
      }
      return {value: node, receiver: nothing};
    };
    const reference = lower(expression, statements, factory.createVoidZero());
    return {reference, statements, capture};
  }

  private runtime(
    name: string,
    args: readonly ts.Expression[],
  ): ts.CallExpression {
    return this.factory.createCallExpression(
      this.factory.createPropertyAccessExpression(
        this.factory.createIdentifier('__code3d'),
        name,
      ),
      undefined,
      args,
    );
  }
}

function pathExpression(
  path: readonly string[],
  factory: ts.NodeFactory,
): ts.Expression {
  return path
    .slice(1)
    .reduce<ts.Expression>(
      (value, key) => factory.createPropertyAccessExpression(value, key),
      factory.createIdentifier(path[0]),
    );
}

function constant(
  name: ts.Identifier,
  value: ts.Expression,
  factory: ts.NodeFactory,
): ts.VariableStatement {
  return factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList(
      [factory.createVariableDeclaration(name, undefined, undefined, value)],
      ts.NodeFlags.Const,
    ),
  );
}

function withPrefix(
  statements: readonly ts.Statement[],
  prefix: readonly ts.Statement[],
): ts.Statement[] {
  let index = 0;
  while (
    index < statements.length &&
    ts.isExpressionStatement(statements[index]) &&
    ts.isStringLiteral((statements[index] as ts.ExpressionStatement).expression)
  )
    index++;
  return [...statements.slice(0, index), ...prefix, ...statements.slice(index)];
}

function sameNode(left: ts.Node, right: ts.Node): boolean {
  if (ts.isSourceFile(left) && ts.isSourceFile(right))
    return left.fileName === right.fileName;
  return (
    left.kind === right.kind && left.pos === right.pos && left.end === right.end
  );
}

function location(node: ts.Node, file: ts.SourceFile) {
  return sourceRef(file.fileName, node.getStart(file), node.end);
}

function argumentScope(
  argument: ts.Expression,
  file: ts.SourceFile,
): InspectCallSite['arguments'][number] {
  const members: Array<{
    sourceRef: ReturnType<typeof location>;
    path: readonly (string | number)[];
  }> = [];
  const visit = (
    node: ts.Expression,
    path: readonly (string | number)[],
  ): void => {
    members.push({sourceRef: location(node, file), path});
    node = unwrapReference(node);
    if (ts.isArrayLiteralExpression(node)) {
      for (const [index, element] of node.elements.entries()) {
        if (ts.isSpreadElement(element)) break;
        if (!ts.isOmittedExpression(element)) visit(element, [...path, index]);
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (
          !ts.isPropertyAssignment(property) &&
          !ts.isShorthandPropertyAssignment(property)
        )
          continue;
        const name = property.name;
        const key =
          ts.isIdentifier(name) || ts.isStringLiteral(name)
            ? name.text
            : ts.isNumericLiteral(name)
              ? Number(name.text)
              : undefined;
        if (key !== undefined)
          visit(
            ts.isPropertyAssignment(property)
              ? property.initializer
              : property.name,
            [...path, key],
          );
      }
    }
  };
  visit(ts.isSpreadElement(argument) ? argument.expression : argument, []);
  return {
    sourceRef: location(argument, file),
    spread: ts.isSpreadElement(argument),
    members,
  };
}

function unwrapReference(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  )
    expression = expression.expression;
  return expression;
}

function iife(
  statements: readonly ts.Statement[],
  factory: ts.NodeFactory,
): ts.CallExpression {
  return factory.createCallExpression(
    factory.createParenthesizedExpression(
      factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        factory.createBlock(statements, true),
      ),
    ),
    undefined,
    [],
  );
}
