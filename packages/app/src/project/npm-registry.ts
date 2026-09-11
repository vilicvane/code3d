import {mapProjectIO} from './io';
import {createTarDecoder} from 'modern-tar';
import {decodeProjectFile} from './file-reader';
import {parsePackageManifest, type PackageManifest} from './package-manifest';

export type NpmPackage = {
  name: string;
  version: string;
  tarball: string;
  integrity: string;
};
export type NpmMetadata = PackageManifest & {
  name: string;
  version: string;
  dist: {tarball: string; integrity?: string; shasum?: string};
};
export type NpmPackument = {
  versions: Record<string, NpmMetadata>;
  'dist-tags': Record<string, string>;
};

export const npmPackageUrl = (
  pkg: Pick<NpmPackage, 'name' | 'version'>,
): `${string}/` =>
  `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${pkg.version}/`;

/** Registry metadata and verified archives; the cache is shared by all subprojects. */
export class NpmRegistry {
  private readonly packuments = new Map<string, Promise<NpmPackument>>();
  private readonly metadataRequests = new Map<string, Promise<NpmMetadata>>();
  constructor(
    private readonly request: typeof fetch = (...args) => fetch(...args),
  ) {}

  packument(name: string): Promise<NpmPackument> {
    let pending = this.packuments.get(name);
    if (!pending) {
      pending = this.json(
        'https://registry.npmjs.org/' + encodeURIComponent(name),
        name,
      );
      this.packuments.set(name, pending);
    }
    return pending;
  }

  /** One registry instance belongs to one resolution; explicit updates start fresh. */
  async prefetch(names: readonly string[]): Promise<void> {
    await mapProjectIO(
      [...new Set(names)],
      async name => {
        // Consumers report errors with their dependency scope and optionality.
        // Keep rejected requests deduplicated within this resolution as well.
        await this.packument(name).catch(() => {});
      },
      {concurrency: 15},
    );
  }

  metadata(name: string, version: string): Promise<NpmMetadata> {
    const url = npmPackageUrl({name, version}).slice(0, -1);
    let pending = this.metadataRequests.get(url);
    if (!pending) {
      pending = (async () => {
        const packument = await this.packuments
          .get(name)
          ?.catch(() => undefined);
        return (
          packument?.versions[version] ?? this.json(url, `${name}@${version}`)
        );
      })();
      this.metadataRequests.set(url, pending);
    }
    return pending;
  }

  private async json(url: string, name: string) {
    const response = await this.request(url).catch(error => {
      throw new Error(
        `Unable to fetch npm package ${name}. Check the package name and network connection. ${error instanceof Error ? error.message : String(error)}`,
        {cause: error},
      );
    });
    if (response.status === 404)
      throw new Error(`npm package not found: ${name}`);
    if (!response.ok)
      throw new Error(`npm registry returned ${response.status}: ${url}`);
    return response.json();
  }

  async archive(pkg: NpmPackage): Promise<Uint8Array> {
    const cache =
      typeof caches === 'undefined'
        ? undefined
        : await caches.open('code3d-npm-archives');
    const key =
      'https://code3d.invalid/npm/' + encodeURIComponent(pkg.integrity);
    const cached = await cache?.match(key);
    if (cached) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      if (await matchesIntegrity(bytes, pkg.integrity)) return bytes;
      await cache!.delete(key);
    }
    const response = await this.request(pkg.tarball);
    if (!response.ok)
      throw new Error(
        `Unable to download ${pkg.name}@${pkg.version}: HTTP ${response.status}`,
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!(await matchesIntegrity(bytes, pkg.integrity)))
      throw new Error(`Integrity check failed for ${pkg.name}@${pkg.version}.`);
    await cache?.put(key, new Response(bytes));
    return bytes;
  }
}

export function packageArtifact(metadata: NpmMetadata): NpmPackage {
  const {name, version, dist} = metadata;
  const integrity =
    dist.integrity ??
    (dist.shasum
      ? 'sha1-' +
        btoa(
          String.fromCharCode(
            ...Uint8Array.from(dist.shasum.match(/../g)!, hex =>
              parseInt(hex, 16),
            ),
          ),
        )
      : undefined);
  if (!integrity || !dist.tarball?.startsWith('https://'))
    throw new Error(`Missing npm download integrity for ${name}@${version}.`);
  return {name, version, tarball: dist.tarball, integrity};
}

export async function matchesIntegrity(
  bytes: Uint8Array,
  integrity: string,
): Promise<boolean> {
  const supported = ['sha512', 'sha384', 'sha256', 'sha1'];
  const tokens = integrity.trim().split(/\s+/);
  const algorithm = supported.find(algorithm =>
    tokens.some(token => token.startsWith(algorithm + '-')),
  );
  if (!algorithm)
    throw new Error(
      'The package lock contains an unsupported integrity algorithm.',
    );
  const hash = await crypto.subtle.digest(
    algorithm.replace('sha', 'SHA-'),
    new Uint8Array(bytes),
  );
  const actual =
    algorithm + '-' + btoa(String.fromCharCode(...new Uint8Array(hash)));
  return tokens.includes(actual);
}

/** Parse standard tar/PAX with a maintained browser library; archive paths stay inside one package. */
export async function extractNpmArchive(
  bytes: Uint8Array,
  write: (path: string, bytes: Uint8Array) => Promise<void>,
): Promise<PackageManifest> {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(createTarDecoder({strict: true}));
  let manifest: PackageManifest | undefined;
  const paths = new Set<string>();
  for await (const entry of stream) {
    const {name, type} = entry.header;
    if (type === 'directory') {
      await entry.body.cancel();
      continue;
    }
    if (type !== 'file')
      throw new Error(`Unsupported npm archive entry: ${name} (${type}).`);
    const parts = name.split('/');
    // npm archives historically use either package/ or a package-name prefix.
    if (
      parts.length < 2 ||
      parts.some(
        part =>
          !part ||
          part === '.' ||
          part === '..' ||
          part.includes('\\') ||
          part.includes('\0'),
      )
    )
      throw new Error(`Invalid npm archive path: ${name}`);
    const path = parts.slice(1).join('/');
    if (paths.has(path)) throw new Error(`Duplicate npm archive path: ${path}`);
    paths.add(path);
    const contents = new Uint8Array(
      await new Response(entry.body).arrayBuffer(),
    );
    if (path === 'package.json')
      manifest = parsePackageManifest(
        decodeProjectFile(contents),
        'installed package.json',
      );
    await write(path, contents);
  }
  if (!manifest) throw new Error('The npm archive has no package.json.');
  return manifest;
}
