import type {KernelArtifactStore} from '@code3d/core/tooling';

type Resource = Readonly<{
  bytes: Uint8Array;
  expires: number;
  cacheable: boolean;
}>;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

/** Anonymous HTTP resources and content-addressed decoding, bounded across builds. */
export class ResourceCache {
  private readonly memory = new Map<string, Resource>();
  private memoryBytes = 0;
  private readonly pending = new Map<string, Promise<Resource>>();
  private store?: KernelArtifactStore;
  private memoryHits = 0;
  private diskHits = 0;
  private networkRequests = 0;
  private storageErrors = 0;

  constructor(
    private readonly request: typeof fetch = (...args) => fetch(...args),
    readonly maximumBytes = 64 * 1024 ** 2,
    private readonly now = Date.now,
  ) {}

  setStore(store: KernelArtifactStore | undefined): void {
    this.store = store;
  }

  get stats() {
    return {
      maximumBytes: this.maximumBytes,
      memoryBytes: this.memoryBytes,
      memoryHits: this.memoryHits,
      diskHits: this.diskHits,
      networkRequests: this.networkRequests,
      storageErrors: this.storageErrors,
    };
  }

  async load(url: string, signal: AbortSignal): Promise<Resource> {
    // Google selects its font format using the browser's capabilities.
    const variant =
      typeof navigator === 'undefined'
        ? ''
        : [navigator.userAgent, navigator.language];
    const key =
      'http:' + (await digest(encoder.encode(JSON.stringify([url, variant]))));
    return this.once(key, async () => {
      signal.throwIfAborted();
      const cached = this.read(key);
      if (cached && cached.expires > this.now()) return cached;
      this.networkRequests++;
      const response = await this.request(url, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-cache',
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const resource = {bytes, ...freshness(response.headers, this.now())};
      // Completed resources survive cancellation of the surrounding build.
      if (resource.cacheable) this.write(key, resource);
      else this.remove(key);
      return resource;
    });
  }

  async decoded(
    resource: Resource,
    identity: string,
    decode: (bytes: Uint8Array) => Promise<Uint8Array>,
  ): Promise<Uint8Array> {
    const key = identity + ':' + (await digest(resource.bytes));
    return (
      await this.once(key, async () => {
        const cached = resource.cacheable && this.read(key);
        if (cached) return cached;
        const decoded = {
          bytes: await decode(resource.bytes),
          expires: Number.MAX_SAFE_INTEGER,
          cacheable: resource.cacheable,
        };
        if (resource.cacheable) this.write(key, decoded);
        return decoded;
      })
    ).bytes;
  }

  /** Settle all writers before releasing the OPFS transaction. */
  async settle(): Promise<void> {
    await Promise.allSettled(this.pending.values());
  }

  clear(): void {
    this.memory.clear();
    this.memoryBytes = 0;
  }

  private once(
    key: string,
    action: () => Promise<Resource>,
  ): Promise<Resource> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const pending = action();
    this.pending.set(key, pending);
    void pending
      .finally(() => {
        if (this.pending.get(key) === pending) this.pending.delete(key);
      })
      .catch(() => {});
    return pending;
  }

  private read(key: string): Resource | undefined {
    const cached = this.memory.get(key);
    if (cached) {
      this.memoryHits++;
      this.memory.delete(key);
      this.memory.set(key, cached);
      if (this.disk(store => store.touch(key)) === false)
        this.write(key, cached);
      return cached;
    }
    const bytes = this.disk(store => store.get(key));
    if (!bytes) return;
    try {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      const length = view.getUint32(0);
      if (length > bytes.length - 4)
        throw new Error('Incomplete resource cache entry.');
      const metadata = JSON.parse(
        decoder.decode(bytes.subarray(4, 4 + length)),
      );
      if (!Number.isFinite(metadata.expires))
        throw new Error('Invalid resource expiry.');
      const resource = {
        bytes: bytes.subarray(4 + length),
        expires: metadata.expires,
        cacheable: true,
      };
      this.diskHits++;
      this.retain(key, resource);
      return resource;
    } catch {
      this.remove(key);
      return;
    }
  }

  private write(key: string, resource: Resource): void {
    this.retain(key, resource);
    const metadata = encoder.encode(
      JSON.stringify({expires: resource.expires}),
    );
    const bytes = new Uint8Array(4 + metadata.length + resource.bytes.length);
    new DataView(bytes.buffer).setUint32(0, metadata.length);
    bytes.set(metadata, 4);
    bytes.set(resource.bytes, 4 + metadata.length);
    this.disk(store => store.set(key, bytes));
  }

  private retain(key: string, resource: Resource): void {
    const previous = this.memory.get(key);
    if (previous) this.memoryBytes -= previous.bytes.buffer.byteLength;
    this.memory.delete(key);
    // A disk-restored view retains the whole record buffer, including metadata.
    const bytes = resource.bytes.buffer.byteLength;
    if (bytes <= this.maximumBytes) {
      this.memory.set(key, resource);
      this.memoryBytes += bytes;
    }
    while (this.memoryBytes > this.maximumBytes) {
      const [oldest, entry] = this.memory.entries().next().value!;
      this.memory.delete(oldest);
      this.memoryBytes -= entry.bytes.buffer.byteLength;
    }
  }

  private remove(key: string): void {
    const previous = this.memory.get(key);
    if (previous) this.memoryBytes -= previous.bytes.buffer.byteLength;
    this.memory.delete(key);
    this.disk(store => store.delete(key));
  }

  private disk<T>(action: (store: KernelArtifactStore) => T): T | undefined {
    if (!this.store) return;
    try {
      return action(this.store);
    } catch {
      this.storageErrors++;
      this.store = undefined;
      return;
    }
  }
}

function freshness(headers: Headers, now: number): Omit<Resource, 'bytes'> {
  const control = headers.get('cache-control') ?? '';
  const cacheable =
    !/(?:^|,)\s*no-store\b/i.test(control) && headers.get('vary') !== '*';
  if (!cacheable || /(?:^|,)\s*no-cache\b/i.test(control))
    return {cacheable, expires: 0};
  const seconds = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(control)?.[1];
  const date = Date.parse(headers.get('date') ?? '');
  const reportedAge = Number(headers.get('age') ?? 0) * 1000;
  const age = Math.max(
    0,
    Number.isFinite(reportedAge) ? reportedAge : 0,
    Number.isFinite(date) ? now - date : 0,
  );
  const expires = Date.parse(headers.get('expires') ?? '');
  if (seconds !== undefined) {
    const lifetime = Number(seconds) * 1000;
    const expiry = Number.isFinite(lifetime)
      ? Math.min(Number.MAX_SAFE_INTEGER, now + lifetime - age)
      : 0;
    return {
      cacheable,
      expires: Number.isFinite(expires) ? Math.min(expiry, expires) : expiry,
    };
  }
  // Responses without an explicit lifetime are revalidated next build.
  return {cacheable, expires: Number.isFinite(expires) ? expires : 0};
}

async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
    ),
    value => value.toString(16).padStart(2, '0'),
  ).join('');
}
