import ts from '@typescript/typescript6';
import type {GoogleFontOptions} from '@code3d/core';
import {locateModelError} from '../model/diagnostic';

export type FontResourceRequest = Readonly<{
  family: string;
  options: GoogleFontOptions | undefined;
  sourceRef: {file: string; start: number; end: number};
}>;

/** Use resolved declarations so aliases/re-exports work and unrelated names do not load fonts. */
export function fontResourceRequests(
  program: ts.Program,
  path: string,
): readonly FontResourceRequest[] {
  const source = program.getSourceFile(path);
  if (!source || source.isDeclarationFile) return [];
  const checker = program.getTypeChecker();
  const requests: FontResourceRequest[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      checker
        .getResolvedSignature(node)
        ?.getJsDocTags()
        .some(
          tag =>
            tag.name === 'modelResource' &&
            ts.displayPartsToString(tag.text) === 'google-font',
        )
    ) {
      const sourceRef = {
        file: path,
        start: node.getStart(source),
        end: node.getEnd(),
      };
      try {
        requests.push({
          family: constant(node.arguments[0], checker) as string,
          options: node.arguments[1]
            ? (constant(node.arguments[1], checker) as GoogleFontOptions)
            : undefined,
          sourceRef,
        });
      } catch (error) {
        throw locateModelError(error, sourceRef, 'module');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return requests;
}

function constant(
  node: ts.Expression | undefined,
  checker: ts.TypeChecker,
  seen = new Set<ts.Node>(),
): unknown {
  const unsupported = () =>
    new Error(
      'googleFont() requires a static family name and options. Literals and const values (including imports) are supported.',
    );
  if (!node || seen.has(node)) throw unsupported();
  seen = new Set(seen).add(node);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
    return constant(node.expression, checker, seen);
  if (ts.isPrefixUnaryExpression(node)) {
    const value = constant(node.operand, checker, seen);
    if (typeof value !== 'number') throw unsupported();
    if (node.operator === ts.SyntaxKind.MinusToken) return -value;
    if (node.operator === ts.SyntaxKind.PlusToken) return value;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = constant(property.expression, checker, seen);
        if (!spread || typeof spread !== 'object') throw unsupported();
        Object.assign(value, spread);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        value[property.name.text] = symbolConstant(
          checker.getShorthandAssignmentValueSymbol(property),
        );
      } else if (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) ||
          ts.isStringLiteralLike(property.name))
      ) {
        value[property.name.text] = constant(
          property.initializer,
          checker,
          seen,
        );
      } else throw unsupported();
    }
    return value;
  }
  if (ts.isPropertyAccessExpression(node)) {
    // Namespace imports resolve to their exported const declaration below.
    const base = checker.getSymbolAtLocation(node.expression);
    const namespace = base?.declarations?.some(ts.isNamespaceImport);
    if (!namespace) {
      const value = constant(node.expression, checker, seen);
      if (!value || typeof value !== 'object') throw unsupported();
      return (value as Record<string, unknown>)[node.name.text];
    }
  }
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
    if (checker.getTypeAtLocation(node).flags & ts.TypeFlags.Undefined)
      return undefined;
    return symbolConstant(checker.getSymbolAtLocation(node));
  }
  throw unsupported();

  function symbolConstant(symbol: ts.Symbol | undefined): unknown {
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.flags & ts.NodeFlags.Const
    )
      return constant(declaration.initializer, checker, seen);
    throw unsupported();
  }
}
