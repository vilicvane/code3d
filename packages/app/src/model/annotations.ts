import ts from '@typescript/typescript6';

export const code3dAnnotationNames = ['arguments', 'param'] as const;

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
const annotationPattern = /@code3d\.([a-z][\w-]*)\b/g;
const annotationCache = new WeakMap<
  ts.SourceFile,
  readonly Code3dAnnotation[]
>();

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
