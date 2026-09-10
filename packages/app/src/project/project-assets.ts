import type {KernelArtifactStore} from '@code3d/core/tooling';
import ts from '@typescript/typescript6';
import {locateModelError} from '../model/diagnostic';
import type {ProjectFileReader} from './file-reader';
import {fontResourceRequests} from './font-resources';
import {normalizeProjectPath, projectDirectory} from './project';
import {ResourceCache} from './resource-cache';

/** Prepares static project and HTTP(S) assets before synchronous model execution. */
export class ProjectAssets {
  private readonly urls = new Map<string, {version: string; url: string}>();

  private readonly pending = new Map<string, Promise<string>>();
  private readonly contents = new Map<string, Uint8Array>();
  private readonly remote = new Map<string, Promise<string>>();
  private downloads = new AbortController();
  private readonly cache: ResourceCache;
  private readonly googlePending = new Map<string, Promise<void>>();
  private googleContext?: {
    program: ts.Program;
    tooling: Pick<
      typeof import('@code3d/core/tooling'),
      'googleFontUrl' | 'googleFontSources'
    >;
  };
  private cancellationPoll?: ReturnType<typeof setInterval>;
  private checkCancelled = () => {};

  constructor(
    private readonly files: ProjectFileReader,
    request: typeof fetch = (...args) => fetch(...args),
  ) {
    this.cache = new ResourceCache(request);
  }

  /** Recheck remote resources once per compilation, respecting HTTP freshness. */
  beginCompilation(checkCancelled: () => void = () => {}): void {
    this.downloads.abort();
    clearInterval(this.cancellationPoll);
    this.cancellationPoll = undefined;
    this.googlePending.clear();
    this.downloads = new AbortController();
    this.contents.clear();
    this.urls.clear();
    this.remote.clear();
    this.checkCancelled = checkCancelled;
  }

  snapshot(): ReadonlyMap<string, Uint8Array> {
    return new Map(this.contents);
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
    const url = path;
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

  setStore(store: KernelArtifactStore | undefined): void {
    this.cache.setStore(store);
  }
  setGoogleContext(
    program: ts.Program,
    tooling: NonNullable<ProjectAssets['googleContext']>['tooling'],
  ): void {
    this.googleContext = {program, tooling};
  }
  get cacheStats() {
    return this.cache.stats;
  }

  async finishCompilation(): Promise<void> {
    this.downloads.abort();
    await Promise.allSettled([
      ...this.remote.values(),
      ...this.googlePending.values(),
    ]);
    await this.cache.settle();
    clearInterval(this.cancellationPoll);
    this.cancellationPoll = undefined;
    this.cache.setStore(undefined);
  }

  private watchCancellation(): void {
    if (this.cancellationPoll) return;
    const controller = this.downloads;
    const check = this.checkCancelled;
    this.cancellationPoll = setInterval(() => {
      try {
        check();
      } catch (error) {
        controller.abort(error);
      }
    }, 50);
  }

  private async loadRemoteUrl(url: string): Promise<string> {
    const downloads = this.downloads;
    const checkCancelled = this.checkCancelled;
    checkCancelled();
    this.watchCancellation();
    try {
      const resource = await this.cache.load(url, downloads.signal);
      let bytes = resource.bytes;
      if (
        bytes.length >= 4 &&
        new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ).getUint32(0) === 0x774f4632
      ) {
        bytes = await this.cache.decoded(
          resource,
          'woff2-encoder@2.0.0',
          async bytes => {
            const {default: decompress} =
              await import('woff2-encoder/decompress');
            return decompress(bytes);
          },
        );
      }
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
    }
  }

  private prepareGoogleFonts(path: string): Promise<void> {
    const context = this.googleContext;
    if (!context) return Promise.resolve();
    const existing = this.googlePending.get(path);
    if (existing) return existing;
    const loading = (async () => {
      const requests = fontResourceRequests(context.program, path);
      await Promise.all(
        requests.map(async ({family, options, sourceRef}) => {
          try {
            const url = context.tooling.googleFontUrl(family, options);
            await this.remoteUrl(url.href);
            const sources = context.tooling.googleFontSources(this.read(url)!);
            const urls = [...new Set(sources.map(source => source.url))];
            let next = 0;
            await Promise.all(
              Array.from({length: Math.min(8, urls.length)}, async () => {
                while (next < urls.length) {
                  this.checkCancelled();
                  await this.remoteUrl(urls[next++]);
                }
              }),
            );
          } catch (error) {
            throw locateModelError(error, sourceRef, 'module');
          }
        }),
      );
    })();
    this.googlePending.set(path, loading);
    return loading;
  }

  async rewrite(
    path: string,
    source: string,
    onResource?: (path: string) => void,
  ): Promise<string> {
    await this.prepareGoogleFonts(path);
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
          onResource?.(site.path);
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
        (site.remote
          ? JSON.stringify(site.url)
          : `__code3dAssetUrl(${JSON.stringify(site.url)})`) +
        ')' +
        source.slice(site.end);
    }
    return source;
  }

  dispose(): void {
    this.beginCompilation();
    this.urls.clear();
    this.contents.clear();
    this.cache.clear();
    this.googleContext = undefined;
  }
}
