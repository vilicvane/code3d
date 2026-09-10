import ts from '@typescript/typescript6';
import type {ProjectFileReader} from './file-reader';
import {normalizeProjectPath, projectDirectory} from './project';
import {locateModelError} from '../model/diagnostic';

/** Prepares static project and HTTP(S) assets before synchronous model execution. */
export class ProjectAssets {
  private readonly urls = new Map<string, {version: string; url: string}>();

  private readonly pending = new Map<string, Promise<string>>();
  private readonly contents = new Map<string, Uint8Array>();
  private readonly remote = new Map<string, Promise<string>>();
  private downloads = new AbortController();
  private checkCancelled = () => {};

  constructor(
    private readonly files: ProjectFileReader,
    private readonly request: typeof fetch = (...args) => fetch(...args),
  ) {}

  /** Recheck remote resources once per compilation, respecting HTTP freshness. */
  beginCompilation(checkCancelled: () => void = () => {}): void {
    this.downloads.abort();
    this.downloads = new AbortController();
    for (const url of this.remote.keys()) this.contents.delete(url);
    this.remote.clear();
    this.checkCancelled = checkCancelled;
  }

  read(url: URL): Uint8Array | undefined {
    return this.contents.get(url.href);
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
    if (existing) {
      URL.revokeObjectURL(existing.url);
      this.contents.delete(existing.url);
    }
    const url = URL.createObjectURL(new Blob([Uint8Array.from(contents)]));
    this.urls.set(path, {version: info.version, url});
    this.contents.set(url, contents);
    return url;
  }

  private remoteUrl(url: string): Promise<string> {
    const existing = this.remote.get(url);
    if (existing) return existing;
    const loading = this.loadRemoteUrl(url);
    this.remote.set(url, loading);
    loading.catch(() => {
      if (this.remote.get(url) === loading) this.remote.delete(url);
    });
    return loading;
  }

  private async loadRemoteUrl(url: string): Promise<string> {
    const downloads = this.downloads;
    const checkCancelled = this.checkCancelled;
    checkCancelled();
    const poll = setInterval(() => {
      try {
        checkCancelled();
      } catch (error) {
        downloads.abort(error);
      }
    }, 50);
    try {
      const response = await this.request(url, {
        mode: 'cors',
        credentials: 'omit',
        signal: AbortSignal.any([
          downloads.signal,
          AbortSignal.timeout(30_000),
        ]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      checkCancelled();
      downloads.signal.throwIfAborted();
      this.contents.set(url, bytes);
      return url;
    } catch (error) {
      checkCancelled();
      throw new Error(
        `Cannot load network asset ${url}. Check the URL, network connection and the server's CORS permission. ${error instanceof Error ? error.message : String(error)}`,
        {cause: error},
      );
    } finally {
      clearInterval(poll);
    }
  }

  async rewrite(path: string, source: string): Promise<string> {
    if (!source.includes('URL')) return source;
    const parsed = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const sites: {start: number; end: number; path: string; remote: boolean}[] =
      [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'URL' &&
        node.arguments?.length
      ) {
        const [relative, base] = node.arguments;
        const remote =
          ts.isStringLiteralLike(relative) &&
          /^https?:\/\//i.test(relative.text);
        if (
          ts.isStringLiteralLike(relative) &&
          (remote ||
            (base &&
              ts.isPropertyAccessExpression(base) &&
              base.name.text === 'url' &&
              ts.isMetaProperty(base.expression) &&
              base.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
              !/^[a-z][a-z\d+.-]*:/i.test(relative.text)))
        ) {
          const assetPath = remote
            ? relative.text
            : normalizeProjectPath(
                relative.text.startsWith('/')
                  ? relative.text
                  : projectDirectory(path) + '/' + relative.text,
              );
          sites.push({
            start: node.getStart(parsed),
            end: node.getEnd(),
            path: assetPath,
            remote,
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
          if (
            !site.remote &&
            (await this.files.stat(site.path))?.kind === 'directory'
          )
            return;
          const url = site.remote
            ? await this.remoteUrl(new URL(site.path).href)
            : await this.url(site.path);
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
        JSON.stringify(site.url) +
        ')' +
        source.slice(site.end);
    }
    return source;
  }

  dispose(): void {
    this.beginCompilation();
    for (const {url} of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.contents.clear();
  }
}
