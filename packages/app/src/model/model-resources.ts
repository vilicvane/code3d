import type {
  KernelArtifactStore,
  ModelResourceLoader,
} from '@code3d/core/tooling';
import {ResourceCache} from './resource-cache';

/** Owns runtime downloads and local asset URLs; compiled artifacts carry local bytes only. */
export class ModelResources implements ModelResourceLoader {
  private readonly urls = new Map<string, string>();
  private readonly contents = new Map<string, Uint8Array>();
  private readonly cache: ResourceCache;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly loads = new Map<
    string,
    ReturnType<ModelResourceLoader['load']>
  >();
  private downloads = new AbortController();
  private cancellationPoll?: ReturnType<typeof setInterval>;
  private checkCancelled = () => {};

  constructor(
    private readonly dependencies: ReadonlyMap<string, Uint8Array> = new Map(),
    request: typeof fetch = (...args) => fetch(...args),
  ) {
    this.cache = new ResourceCache(request);
    this.install(new Map());
  }

  begin(
    store: KernelArtifactStore | undefined,
    checkCancelled: () => void,
  ): void {
    this.loads.clear();
    this.downloads = new AbortController();
    this.checkCancelled = checkCancelled;
    this.cache.setStore(store);
  }

  async finish(): Promise<void> {
    this.downloads.abort();
    while (this.pending.size) await Promise.allSettled(this.pending);
    await this.cache.settle();
    clearInterval(this.cancellationPoll);
    this.cancellationPoll = undefined;
    this.cache.setStore(undefined);
    this.loads.clear();
  }

  get cacheStats() {
    return this.cache.stats;
  }

  private track<T>(load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = this.downloads.signal;
    const check = this.checkCancelled;
    if (!this.cancellationPoll) {
      const controller = this.downloads;
      this.cancellationPoll = setInterval(() => {
        try {
          check();
        } catch (error) {
          controller.abort(error);
        }
      }, 50);
    }
    const pending = (async () => {
      check();
      signal.throwIfAborted();
      const result = await load(signal);
      check();
      signal.throwIfAborted();
      return result;
    })();
    this.pending.add(pending);
    void pending.finally(() => this.pending.delete(pending)).catch(() => {});
    return pending;
  }

  readonly load: ModelResourceLoader['load'] = url => {
    const existing = this.loads.get(url.href);
    if (existing) return existing;
    const loading = this.track(async signal => {
      const bytes = this.contents.get(url.href);
      if (bytes) return {bytes, expires: 0, cacheable: true};
      try {
        return await this.cache.load(url.href, signal);
      } catch (error) {
        this.checkCancelled();
        signal.throwIfAborted();
        throw new Error(
          `Cannot load network asset ${url}. Check the URL, network connection and the server's CORS permission. ${error instanceof Error ? error.message : String(error)}`,
          {cause: error},
        );
      }
    });
    this.loads.set(url.href, loading);
    void loading.catch(() => {
      if (this.loads.get(url.href) === loading) this.loads.delete(url.href);
    });
    return loading;
  };

  readonly bundle: ModelResourceLoader['bundle'] = (identity, load) =>
    this.track(() => this.cache.bundle(identity, load));

  readonly decoded: ModelResourceLoader['decoded'] = (
    resource,
    identity,
    decode,
  ) => this.track(() => this.cache.decoded(resource, identity, decode));

  install(files: ReadonlyMap<string, Uint8Array>): void {
    const next = new Map(this.dependencies);
    for (const [path, bytes] of files) next.set(path, bytes);
    for (const [path, url] of this.urls) {
      const previous = this.contents.get(path)!;
      const bytes = next.get(path);
      if (
        !bytes ||
        (previous !== bytes &&
          (previous.byteLength !== bytes.byteLength ||
            !previous.every((byte, index) => byte === bytes[index])))
      ) {
        URL.revokeObjectURL(url);
        this.urls.delete(path);
      }
    }
    this.contents.clear();
    for (const [path, bytes] of next) this.contents.set(path, bytes);
    for (const [path, url] of this.urls)
      this.contents.set(url, next.get(path)!);
  }

  readonly url = (path: string): string => {
    let url = this.urls.get(path);
    if (!url) {
      const bytes = this.contents.get(path);
      if (!bytes)
        throw new Error(`Model artifact resource is missing: ${path}`);
      url = URL.createObjectURL(
        new Blob([Uint8Array.from(bytes)], {
          type: path.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream',
        }),
      );
      this.urls.set(path, url);
      this.contents.set(url, bytes);
    }
    return url;
  };

  dispose(): void {
    this.downloads.abort();
    clearInterval(this.cancellationPoll);
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.contents.clear();
    this.loads.clear();
    this.cache.clear();
  }
}
