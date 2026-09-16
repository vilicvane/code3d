import ts from '@typescript/typescript6';

export const code3dAnnotationNames = [
  'arguments',
  'param',
  'tool',
  'inspect',
  'inspect.closure',
  'inspect.context',
] as const;

export type Code3dAnnotationName = (typeof code3dAnnotationNames)[number];

export type Code3dAnnotation = Readonly<{
  name: Code3dAnnotationName;
  value: string;
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
  contentEnd: number;
}>;

const annotationNames = new Set<string>(code3dAnnotationNames);
const annotationPattern = /@code3d\.([a-z][\w-]*(?:\.[a-z][\w-]*)*)\b/g;
const annotationCache = new WeakMap<
  ts.SourceFile,
  readonly Code3dAnnotation[]
>();

export function declarationAnnotations(
  node: ts.Node,
): readonly Code3dAnnotation[] {
  const sourceFile = node.getSourceFile();
  // JSDoc on a const belongs to its variable statement, including emitted .d.ts.
  const owner =
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent)
      ? node.parent.parent
      : node;
  return code3dAnnotations(
    sourceFile,
    owner.getFullStart(),
    owner.getStart(sourceFile),
  );
}

/** Resolve the selected signature without inheriting a factory's annotations. */
export function signatureAnnotationDeclaration(
  signature: ts.Signature,
  expression: ts.Expression,
  checker: ts.TypeChecker,
  names: readonly Code3dAnnotationName[],
): ts.Node | undefined {
  const annotated = (node: ts.Node) =>
    declarationAnnotations(node).some(annotation =>
      names.includes(annotation.name),
    );
  const declaration = signature.getDeclaration();
  // Overload-specific annotations remain attached to the resolved signature.
  if (declaration?.name) {
    return annotated(declaration) ? declaration : undefined;
  }
  if (
    declaration &&
    (ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) &&
    ts.isVariableDeclaration(declaration.parent) &&
    declaration.parent.initializer === declaration &&
    annotated(declaration.parent)
  ) {
    return declaration.parent;
  }
  let symbol = checker.getSymbolAtLocation(expression);
  const visited = new Set<ts.Symbol>();
  while (symbol && !visited.has(symbol)) {
    visited.add(symbol);
    if (symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
      continue;
    }
    const owner = symbol.declarations?.find(annotated);
    if (owner) return owner;
    const variable = symbol.valueDeclaration;
    if (
      !variable ||
      !ts.isVariableDeclaration(variable) ||
      !variable.initializer
    )
      break;
    // Ordinary aliases preserve the callable; factory calls and wrappers do not.
    symbol = checker.getSymbolAtLocation(variable.initializer);
  }
  return declaration && annotated(declaration) ? declaration : undefined;
}

export type AnnotationReference = Readonly<{
  /** The lexical root may be absent in a declaration emitted with stripInternal. */
  root?: ts.Symbol;
  path: readonly string[];
}>;

/** Resolve a symbolic callback path, keeping hidden runtime members intact. */
export function annotationReference(
  value: string,
  declaration: ts.Node,
  checker: ts.TypeChecker,
): AnnotationReference | undefined {
  const path = value.split('.');
  if (
    path.some(
      part => !/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(part),
    )
  )
    return undefined;
  // A callback name belongs to the declaration's enclosing scope, not its
  // parameter scope. Resolve only the root: @internal namespace members may
  // intentionally have no declaration while their JavaScript exports survive.
  let root = checker.resolveName(
    path[0],
    declaration.parent,
    ts.SymbolFlags.Value | ts.SymbolFlags.Alias,
    false,
  );
  if (root && root.flags & ts.SymbolFlags.Alias)
    root = checker.getAliasedSymbol(root);
  return {root, path};
}

export function code3dAnnotations(
  input: string | ts.SourceFile,
  rangeStart = 0,
  rangeEnd = typeof input === 'string' ? input.length : input.text.length,
): readonly Code3dAnnotation[] {
  const sourceFile =
    typeof input === 'string'
      ? ts.createSourceFile(
          'annotations.ts',
          input,
          ts.ScriptTarget.Latest,
          true,
        )
      : input;
  let annotations = annotationCache.get(sourceFile);
  if (!annotations) {
    annotations = scanAnnotations(sourceFile);
    annotationCache.set(sourceFile, annotations);
  }
  return annotations.filter(
    annotation => rangeStart <= annotation.start && annotation.end <= rangeEnd,
  );
}

function scanAnnotations(
  sourceFile: ts.SourceFile,
): readonly Code3dAnnotation[] {
  const source = sourceFile.text;
  const annotations: Code3dAnnotation[] = [];
  for (const comment of jsDocComments(sourceFile)) {
    const commentStart = comment.pos;
    const commentEnd = comment.end;

    const body = source
      .slice(commentStart, commentEnd - 2)
      .replace(/^[ \t]*\*(?!\*)[ \t]?/gm, prefix => ' '.repeat(prefix.length));
    for (const annotationMatch of body.matchAll(annotationPattern)) {
      const name = annotationMatch[1];
      if (!annotationNames.has(name)) continue;

      const start = commentStart + annotationMatch.index;
      const tag = `@code3d.${name}`;
      const contentStart = annotationMatch.index + tag.length;
      const nextTag = /(?:\r?\n)[ \t]*@[A-Za-z]/.exec(body.slice(contentStart));
      const contentEnd = nextTag ? contentStart + nextTag.index : body.length;
      const content = body.slice(contentStart, contentEnd);
      const leadingWhitespace = content.length - content.trimStart().length;
      const value = content.trim();
      const valueStart = start + tag.length + leadingWhitespace;
      annotations.push({
        name: name as Code3dAnnotationName,
        value,
        start,
        end: start + tag.length,
        valueStart,
        valueEnd: valueStart + value.length,
        contentEnd: commentStart + contentEnd,
      });
    }
  }
  return annotations;
}

function jsDocComments(sourceFile: ts.SourceFile): readonly ts.CommentRange[] {
  const source = sourceFile.text;
  const comments = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node): void => {
    for (const comment of ts.getLeadingCommentRanges(
      source,
      node.getFullStart(),
    ) ?? []) {
      if (
        comment.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
        source.startsWith('/**', comment.pos) &&
        source.slice(comment.end - 2, comment.end) === '*/'
      ) {
        comments.set(comment.pos, comment);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...comments.values()].sort((a, b) => a.pos - b.pos);
}
