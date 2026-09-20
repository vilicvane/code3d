/** Runtime resource services. Hosts may supply persistence and cancellation. */
export type ModelResource = Readonly<{
  bytes: Uint8Array;
  expires: number;
  cacheable: boolean;
}>;

export type ModelResourceLoader = Readonly<{
  load(url: URL): Promise<ModelResource>;
  bundle(
    identity: string,
    load: () => Promise<ReadonlyMap<string, ModelResource>>,
  ): Promise<ReadonlyMap<string, Uint8Array>>;
  decoded(
    resource: ModelResource,
    identity: string,
    decode: (bytes: Uint8Array) => Promise<Uint8Array>,
  ): Promise<Uint8Array>;
}>;

export async function fetchModelResource(url: URL): Promise<ModelResource> {
  const response = await fetch(url);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    expires: 0,
    cacheable:
      response.headers.get('vary') !== '*' &&
      !/\bno-store\b/i.test(response.headers.get('cache-control') ?? ''),
  };
}

const defaults: ModelResourceLoader = {
  load: fetchModelResource,
  async bundle(_identity, load) {
    return new Map(
      [...(await load())].map(([url, resource]) => [url, resource.bytes]),
    );
  },
  decoded: (resource, _identity, decode) => decode(resource.bytes),
};

export let modelResources: ModelResourceLoader = defaults;

/** Install before evaluating author modules; no compiler preparation is required. */
export function installModelResourceLoader(
  loader: Partial<ModelResourceLoader>,
): void {
  modelResources = {...defaults, ...loader};
}
