export const code3dAnnotationNames = [
  'arguments',
  'description',
  'kind',
  'label',
  'max',
  'min',
  'param',
  'step',
  'unit',
] as const;

export type Code3dAnnotationName = (typeof code3dAnnotationNames)[number];

export type Code3dAnnotation = Readonly<{
  name: Code3dAnnotationName;
  value: string;
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
}>;

const annotationNames = new Set<string>(code3dAnnotationNames);
const jsDocPattern = /\/\*\*[\s\S]*?\*\//g;
const annotationPattern = /@code3d\.([a-z][\w-]*)\b([^\r\n]*)/g;

export function code3dAnnotations(
  source: string,
  rangeStart = 0,
  rangeEnd = source.length,
): readonly Code3dAnnotation[] {
  const annotations: Code3dAnnotation[] = [];
  for (const commentMatch of source.matchAll(jsDocPattern)) {
    const commentStart = commentMatch.index;
    const commentEnd = commentStart + commentMatch[0].length;
    if (commentEnd <= rangeStart || commentStart >= rangeEnd) continue;

    annotationPattern.lastIndex = 0;
    for (const annotationMatch of commentMatch[0].matchAll(annotationPattern)) {
      const name = annotationMatch[1];
      if (!annotationNames.has(name)) continue;

      const start = commentStart + annotationMatch.index;
      const tag = `@code3d.${name}`;
      const rawValue = annotationMatch[2].replace(/\s*\*\/$/, '');
      const leadingWhitespace = rawValue.length - rawValue.trimStart().length;
      const value = rawValue.trim();
      const valueStart = start + tag.length + leadingWhitespace;
      annotations.push({
        name: name as Code3dAnnotationName,
        value,
        start,
        end: start + tag.length,
        valueStart,
        valueEnd: valueStart + value.length,
      });
    }
  }
  return annotations.filter(
    annotation => rangeStart <= annotation.start && annotation.end <= rangeEnd,
  );
}
