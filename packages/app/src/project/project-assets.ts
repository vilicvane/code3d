import ts from '@typescript/typescript6';
import type {ProjectFileReader} from './file-reader';
import {normalizeProjectPath, projectDirectory} from './project';

/** Owns URLs for statically referenced project assets for one runtime lifetime. */
export class ProjectAssets {
  private readonly urls = new Map<string, {version: string; url: string}>();

  constructor(private readonly files: ProjectFileReader) {}

  async url(path: string): Promise<string> {
    const info = await this.files.stat(path);
    if (info?.kind !== 'file')
      throw new Error('Project asset not found: ' + path);
    const existing = this.urls.get(path);
    if (existing?.version === info.version) return existing.url;
    const contents = await this.files.readFile(path);
    if (!contents) throw new Error('Project asset not found: ' + path);
    if (existing) URL.revokeObjectURL(existing.url);
    const url = URL.createObjectURL(new Blob([Uint8Array.from(contents)]));
    this.urls.set(path, {version: info.version, url});
    return url;
  }

  async rewrite(path: string, source: string): Promise<string> {
    if (!source.includes('import.meta')) return source;
    const parsed = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const sites: {start: number; end: number; path: string}[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'URL' &&
        node.arguments?.length === 2
      ) {
        const [relative, base] = node.arguments;
        if (
          ts.isStringLiteralLike(relative) &&
          ts.isPropertyAccessExpression(base) &&
          base.name.text === 'url' &&
          ts.isMetaProperty(base.expression) &&
          base.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
          !/^[a-z][a-z\d+.-]*:/i.test(relative.text)
        ) {
          const assetPath = normalizeProjectPath(
            relative.text.startsWith('/')
              ? relative.text
              : projectDirectory(path) + '/' + relative.text,
          );
          sites.push({
            start: node.getStart(parsed),
            end: node.getEnd(),
            path: assetPath,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    for (const site of sites.sort((left, right) => right.start - left.start)) {
      source =
        source.slice(0, site.start) +
        'new URL(' +
        JSON.stringify(await this.url(site.path)) +
        ')' +
        source.slice(site.end);
    }
    return source;
  }

  dispose(): void {
    for (const {url} of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
