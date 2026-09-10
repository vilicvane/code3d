/** Owns this executor's URLs. Artifacts contain resource paths and bytes only. */
export class ModelResources {
  private readonly urls = new Map<string, string>();
  private readonly contents = new Map<string, Uint8Array>();

  constructor(
    private readonly dependencies: ReadonlyMap<string, Uint8Array> = new Map(),
  ) {
    this.install(new Map());
  }

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

  readonly read = (url: URL): Uint8Array | undefined =>
    this.contents.get(url.href);

  dispose(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.contents.clear();
  }
}
