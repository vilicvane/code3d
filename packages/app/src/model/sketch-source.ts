import type {SourceRef} from '@code3d/core/tooling';
import ts from '@typescript/typescript6';
import {analyzeSketchSource, sketchNodeSourceRef} from '../tools/sketch-source';

export type SketchSourceSite = Readonly<{
  definitionRef?: SourceRef;
  diagnostics: Readonly<{
    sourceRef: SourceRef;
    source: string;
    reason?: string;
    editable: readonly (readonly [number, readonly boolean[]])[];
    constraints?: SourceRef;
  }>;
  bindings: readonly Readonly<{name: string; binding: string}>[];
  receiver?: string;
  constraints?: Readonly<{
    sourceRef: SourceRef;
    elements: readonly SourceRef[];
  }>;
}>;
export type SketchSourceSites = ReadonlyMap<string, SketchSourceSite>;

/** Only source facts cross into the executor; TypeScript objects stay here. */
export function sketchSourceSites(
  program: ts.Program,
  files: ReadonlyMap<string, string>,
): SketchSourceSites {
  const checker = program.getTypeChecker();
  const calls: ts.CallExpression[] = [];
  const written = new Set<ts.Symbol>();
  const constructors = new Set<ts.Signature['declaration']>();
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || !files.has(file.fileName)) continue;
    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === '@code3d/core'
      ) {
        const symbol = checker.getSymbolAtLocation(node.moduleSpecifier);
        const exported =
          symbol &&
          checker.getExportsOfModule(symbol).find(s => s.name === 'sketch');
        if (exported) {
          const factory = checker.getTypeOfSymbolAtLocation(
            exported,
            node.moduleSpecifier,
          );
          for (const signature of factory.getCallSignatures()) {
            if (signature.declaration) constructors.add(signature.declaration);
            const derive = signature.getReturnType().getProperty('derive');
            if (!derive) continue;
            for (const method of checker
              .getTypeOfSymbolAtLocation(derive, node.moduleSpecifier)
              .getCallSignatures())
              if (method.declaration) constructors.add(method.declaration);
          }
        }
      }
      if (ts.isCallExpression(node)) calls.push(node);
      const target =
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          ? node.left
          : (ts.isPrefixUnaryExpression(node) ||
                ts.isPostfixUnaryExpression(node)) &&
              (node.operator === ts.SyntaxKind.PlusPlusToken ||
                node.operator === ts.SyntaxKind.MinusMinusToken)
            ? node.operand
            : undefined;
      if (target) {
        const collect = (part: ts.Node): void => {
          if (ts.isIdentifier(part)) {
            const symbol = checker.getSymbolAtLocation(part);
            if (symbol) written.add(symbol);
          }
          ts.forEachChild(part, collect);
        };
        collect(target);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return new Map(
    calls.map(call => {
      const editable = call.arguments.length
        ? ts.isArrayLiteralExpression(call.arguments[0])
        : constructors.has(checker.getResolvedSignature(call)?.declaration);
      const bindings = checker
        .getSymbolsInScope(call, ts.SymbolFlags.Value)
        .flatMap(visible => {
          const symbol =
            visible.flags & ts.SymbolFlags.Alias
              ? checker.getAliasedSymbol(visible)
              : visible;
          const declaration = symbol.valueDeclaration;
          if (
            written.has(symbol) ||
            !declaration ||
            !ts.isVariableDeclaration(declaration) ||
            !ts.isIdentifier(declaration.name) ||
            !declaration.initializer
          )
            return [];
          const location = {
            ...nodeRef(declaration.name),
            end: declaration.initializer.end,
          };
          return [{name: visible.name, binding: sourceKey(location)}];
        });
      const receiver =
        ts.isPropertyAccessExpression(call.expression) &&
        ts.isIdentifier(call.expression.expression)
          ? call.expression.expression
          : undefined;
      const receiverSymbol = receiver && checker.getSymbolAtLocation(receiver);
      const options = call.arguments[1];
      const property =
        options && ts.isObjectLiteralExpression(options)
          ? options.properties.find(
              p =>
                ts.isPropertyAssignment(p) &&
                (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
                p.name.text === 'constraints',
            )
          : undefined;
      const array =
        property &&
        ts.isPropertyAssignment(property) &&
        ts.isArrayLiteralExpression(property.initializer)
          ? property.initializer
          : undefined;
      const definitionRef = editable
        ? {
            ...nodeRef(call),
            start: call.arguments[0]?.getStart() ?? call.arguments.pos,
            end: call.arguments.at(-1)?.end ?? call.end - 1,
          }
        : undefined;
      const ref = definitionRef ?? nodeRef(call);
      const source = call.getSourceFile().text.slice(ref.start, ref.end);
      const parsed = analyzeSketchSource(source);
      return [
        sourceKey(nodeRef(call)),
        {
          definitionRef,
          diagnostics: {
            sourceRef: ref,
            source,
            reason: parsed.reason,
            editable: [...parsed.editable],
            constraints: parsed.constraints
              ? sketchNodeSourceRef(ref, parsed.constraints)
              : undefined,
          },
          bindings,
          receiver:
            receiverSymbol && !written.has(receiverSymbol)
              ? receiver!.text
              : undefined,
          constraints: array
            ? {sourceRef: nodeRef(array), elements: array.elements.map(nodeRef)}
            : undefined,
        },
      ];
    }),
  );
}

function sourceKey(ref: SourceRef): string {
  return `${ref.file}:${ref.start}:${ref.end}`;
}
function nodeRef(node: ts.Node): SourceRef {
  return {
    file: node.getSourceFile().fileName,
    start: node.getStart(),
    end: node.end,
  };
}
