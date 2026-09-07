import ts from '@typescript/typescript6';
import type {SourceRef} from '@code3d/core/tooling';

export type CursorTypeInfo = Readonly<{
  sourceRef: SourceRef;
  type: string;
  syntax: string;
  documentation: string;
  signatures: readonly string[];
  membersTotal: number;
  members: readonly Readonly<{name: string; type: string; optional: boolean}>[];
}>;

export function cursorTypeInfo(
  service: ts.LanguageService,
  file: string,
  start: number,
  end: number,
): CursorTypeInfo | undefined {
  const program = service.getProgram();
  const source = program?.getSourceFile(file);
  if (!program || !source) return undefined;
  while (start < end && /\s/.test(source.text[start])) start++;
  while (end > start && /\s/.test(source.text[end - 1])) end--;
  let node: ts.Node = source;
  for (;;) {
    const child: ts.Node | undefined = node.forEachChild(child =>
      child.getStart(source) <= start &&
      end <= child.end &&
      (start !== end || start < child.end)
        ? child
        : undefined,
    );
    if (!child) break;
    node = child;
  }
  if (node === source || ts.isBlock(node) || ts.isEmptyStatement(node))
    return undefined;
  const checker = program.getTypeChecker();
  const type = checker.getTypeAtLocation(node);
  const symbol = checker.getSymbolAtLocation(node) ?? type.getSymbol();
  const members = checker.getPropertiesOfType(type);
  return {
    sourceRef: {file, start: node.getStart(source), end: node.end},
    type: checker.typeToString(type, node),
    syntax: ts.SyntaxKind[node.kind],
    documentation: symbol
      ? ts.displayPartsToString(symbol.getDocumentationComment(checker))
      : '',
    signatures: [ts.SignatureKind.Call, ts.SignatureKind.Construct].flatMap(
      kind =>
        checker
          .getSignaturesOfType(type, kind)
          .map(signature =>
            checker.signatureToString(signature, node, undefined, kind),
          ),
    ),
    membersTotal: members.length,
    members: members.slice(0, 100).map(member => ({
      name: member.getName(),
      type: checker.typeToString(
        checker.getTypeOfSymbolAtLocation(member, node),
        node,
      ),
      optional: !!(member.flags & ts.SymbolFlags.Optional),
    })),
  };
}
