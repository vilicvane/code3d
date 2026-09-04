export type SourceToken = Readonly<{
  context: string;
  token: string;
}>;

export function uniqueSourceOffset(source: string, search: string): number {
  const offset = source.indexOf(search);
  if (offset < 0) throw new Error(`Source focus not found: ${search}`);
  if (source.indexOf(search, offset + search.length) >= 0) {
    throw new Error(`Source focus is ambiguous: ${search}`);
  }
  return offset;
}

export function sourceTokenOffset(source: string, target: SourceToken): number {
  const contextOffset = uniqueSourceOffset(source, target.context);
  const tokenOffset = uniqueSourceOffset(target.context, target.token);
  return contextOffset + tokenOffset;
}
