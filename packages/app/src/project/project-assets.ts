import ts from '@typescript/typescript6';
import {locateModelError} from '../model/diagnostic';
import type {ProjectFileReader} from './file-reader';
import {normalizeProjectPath, projectDirectory} from './project';

/** Bundles local project assets referenced by static module-relative URLs. */
export class ProjectAssets {
  private readonly urls = new Map<string, {version: string; url: string}>();

  private readonly pending = new Map<string, Promise<string>>();
  private readonly contents = new Map<string, Uint8Array>();
  constructor(private readonly files: ProjectFileReader) {}

  beginCompilation(): void {
    this.contents.clear();
    this.urls.clear();
  }

  snapshot(): ReadonlyMap<string, Uint8Array> {
    return new Map(this.contents);
  }

  async url(path: string): Promise<string> {
    const existing = this.pending.get(path);
    if (existing) return existing;
    const loading = this.loadUrl(path);
    this.pending.set(path, loading);
    try {
      return await loading;
    } finally {
      this.pending.delete(path);
    }
  }

  private async loadUrl(path: string): Promise<string> {
    const info = await this.files.stat(path);
    if (info?.kind !== 'file')
      throw new Error('Project asset not found: ' + path);
    const existing = this.urls.get(path);
    if (existing?.version === info.version) return existing.url;
    const contents = await this.files.readFile(path);
    if (!contents) throw new Error('Project asset not found: ' + path);
    const url = path;
    this.urls.set(path, {version: info.version, url});
    this.contents.set(url, contents);
    return url;
  }

  async rewrite(
    path: string,
    source: string,
    onResource?: (path: string) => void,
  ): Promise<string> {
    if (!source.includes('URL')) return source;
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
        node.arguments?.length
      ) {
        const [relative, base] = node.arguments;
        if (
          ts.isStringLiteralLike(relative) &&
          base &&
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
    const prepared = await Promise.all(
      sites.map(async site => {
        try {
          // Directory URLs establish a base for the evaluator, not a file asset.
          if ((await this.files.stat(site.path))?.kind === 'directory') return;
          onResource?.(site.path);
          const url = await this.url(site.path);
          return {...site, url};
        } catch (error) {
          throw locateModelError(
            error,
            {file: path, start: site.start, end: site.end},
            'module',
          );
        }
      }),
    );
    for (const site of prepared
      .filter(site => !!site)
      .sort((left, right) => right.start - left.start)) {
      source =
        source.slice(0, site.start) +
        'new URL(' +
        `__code3dAssetUrl(${JSON.stringify(site.url)})` +
        ')' +
        source.slice(site.end);
    }
    return source;
  }

  dispose(): void {
    this.beginCompilation();
  }
}
