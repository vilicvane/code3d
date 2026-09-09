import type {
  Generator,
  ExactPackage,
  PackageConfig,
  Provider,
} from '@jspm/generator';
import {
  assertPackageName,
  manifestDependencies,
  validateBrowserManifest,
  type PackageManifest,
} from './package-manifest';
import {
  NpmRegistry,
  packageArtifact,
  type NpmMetadata,
  type NpmPackage,
} from './npm-registry';

export const packageLockName = 'code3d-lock.json';
type JspmLock = ReturnType<Generator['getLock']>;
export type BrowserPackageLock = {
  dependencies: Record<string, string>;
  resolutions: JspmLock;
  packages: Record<string, NpmPackage>;
  omitted: Record<string, string>;
  optional: string[];
};
const baseUrl = 'https://code3d.invalid/';
const registryUrl = 'https://registry.npmjs.org/';
const packageUrl = (
  pkg: Pick<ExactPackage, 'name' | 'version'>,
): `${string}/` =>
  `${registryUrl}${encodeURIComponent(pkg.name)}/${pkg.version}/`;
function parsePackageUrl(url: string): ExactPackage | undefined {
  if (!url.startsWith(registryUrl)) return;
  const [name, version] = url.slice(registryUrl.length).split('/');
  if (!name || !version) return;
  return {registry: 'npm', name: decodeURIComponent(name), version};
}

export function dependencySignature(manifest: PackageManifest): string {
  return JSON.stringify({
    dependencies: Object.entries(manifestDependencies(manifest)).sort(
      ([a], [b]) => a.localeCompare(b),
    ),
    optional: Object.keys(manifest.optionalDependencies ?? {}).sort(),
  });
}

/** JSPM's package installer resolves manifests; executable-module tracing would omit types and assets. */
export async function resolvePackageLock(
  manifest: PackageManifest,
  registry: NpmRegistry,
  previous?: BrowserPackageLock,
  progress: (message: string) => void = () => {},
): Promise<BrowserPackageLock> {
  validateBrowserManifest(manifest);
  const metadata = new Map<string, NpmMetadata>();
  const getMetadata = async (url: string) => {
    if (metadata.has(url)) return metadata.get(url)!;
    const pkg = parsePackageUrl(url);
    if (!pkg)
      throw new Error(
        `Browser installation supports npm registry packages only: ${url}`,
      );
    const value = await registry.metadata(pkg.name, pkg.version);
    if (value.name !== pkg.name || value.version !== pkg.version)
      throw new Error(
        `npm metadata does not match ${pkg.name}@${pkg.version}.`,
      );
    metadata.set(url, value);
    return value;
  };
  const provider: Provider = {
    pkgToUrl: packageUrl,
    parseUrlPkg: parsePackageUrl,
    ownsUrl: url => url.startsWith(registryUrl),
    async getPackageConfig(url) {
      const config = await getMetadata(url);
      return {
        ...config,
        dependencies: manifestDependencies(config, false),
      } as PackageConfig;
    },
    async resolveLatestTarget({registry: source, name, range, unstable}) {
      if (source !== 'npm')
        throw new Error(`Unsupported package registry: ${source}`);
      progress(`Resolving ${name}@${range}`);
      const packument = await registry.packument(name);
      const version =
        range.isExact && range.version.tag
          ? packument['dist-tags'][range.version.tag]
          : range
              .bestMatch(Object.keys(packument.versions), unstable)
              ?.toString();
      if (!version)
        throw new Error(`No npm version satisfies ${name}@${range}.`);
      const resolved = {registry: 'npm', name, version};
      metadata.set(packageUrl(resolved), packument.versions[version]);
      return resolved;
    },
  };
  const dependencies = manifestDependencies(manifest);
  const {Generator} = await import('@jspm/generator');
  const generator = new Generator({
    mapUrl: baseUrl,
    env: ['browser', 'import', 'production'],
    defaultProvider: 'registry',
    customProviders: {registry: provider},
    packageConfigs: {[baseUrl]: {...manifest, dependencies} as PackageConfig},
    inputMapFallbacks: false,
  });
  // This typed package-level API is pinned to @jspm/generator 2.16.3 and covered
  // by integration tests. Generator.install() instead requires executable exports.
  const installer = generator.traceMap.installer!;
  if (previous) {
    installer.installs = structuredClone(previous.resolutions);
    for (const [name, range] of Object.entries(previous.dependencies))
      if (dependencies[name] !== range) delete installer.installs.primary[name];
  }
  const omitted: Record<string, string> = {};
  const install = async (
    name: string,
    config: PackageManifest,
    scope: `${string}/` | null,
  ) => {
    const range =
      manifestDependencies(config, scope === null)[name] ??
      config.peerDependencies![name];
    if (/^(?:file:|link:|workspace:|https?:|git|github:)|^[./]/.test(range))
      throw new Error(
        `Unsupported browser dependency ${name}: ${range}. Use an npm version, range or npm: alias.`,
      );
    try {
      const result = await installer.install(
        name,
        'freeze',
        scope,
        '.',
        scope ?? baseUrl,
      );
      await getMetadata(result.installUrl);
      return result.installUrl;
    } catch (error) {
      if (!Object.hasOwn(config.optionalDependencies ?? {}, name)) throw error;
      omitted[(scope ?? '') + name] =
        error instanceof Error ? error.message : String(error);
      delete (
        scope
          ? (installer.installs.secondary[scope] ?? {})
          : installer.installs.primary
      )[name];
      return undefined;
    }
  };
  for (const name of Object.keys(dependencies).sort())
    await install(name, manifest, null);
  const visited = new Set<string>();
  const packages: Record<string, NpmPackage> = {};
  for (;;) {
    const reachable = new Set<`${string}/`>();
    const visit = (url: `${string}/`) => {
      if (reachable.has(url)) return;
      reachable.add(url);
      for (const resolution of Object.values(
        installer.installs.secondary[url] ?? {},
      ))
        visit(resolution.installUrl);
    };
    for (const resolution of Object.values(installer.installs.primary))
      visit(resolution.installUrl);
    const urls = [...reachable].filter(url => !visited.has(url));
    if (!urls.length) break;
    for (const url of new Set(urls)) {
      visited.add(url);
      const config = await getMetadata(url);
      packages[url] = packageArtifact(config);
      const names = new Set([
        ...Object.keys(manifestDependencies(config, false)),
        ...Object.keys(config.peerDependencies ?? {}).filter(
          name => installer.installs.primary[name],
        ),
      ]);
      for (const name of [...names].sort()) await install(name, config, url);
    }
  }
  const lock = generator.getLock();
  // Prune removed dependencies and obsolete package versions after consolidation.
  const reachable = new Set<string>();
  const visit = (url: string) => {
    if (reachable.has(url)) return;
    reachable.add(url);
    for (const resolution of Object.values(
      lock.secondary[url as `${string}/`] ?? {},
    ))
      visit(resolution.installUrl);
  };
  for (const resolution of Object.values(lock.primary))
    visit(resolution.installUrl);
  for (const url of reachable) {
    const config = metadata.get(url)!;
    for (const name of Object.keys(config.peerDependencies ?? {})) {
      const primary = lock.primary[name]?.installUrl;
      const peer = lock.secondary[url as `${string}/`]?.[name]?.installUrl;
      if (primary && peer && primary !== peer)
        throw new Error(
          `${config.name}@${config.version} requires peer ${name}@${config.peerDependencies![name]}, which conflicts with the project's selected ${packages[primary].version}.`,
        );
    }
  }
  lock.secondary = Object.fromEntries(
    Object.entries(lock.secondary).filter(([url]) => reachable.has(url)),
  );
  return {
    dependencies,
    optional: Object.keys(manifest.optionalDependencies ?? {}).sort(),
    resolutions: lock,
    packages: Object.fromEntries(
      [...reachable].map(url => [url, packages[url]]),
    ),
    omitted,
  };
}

/** The lock is user-editable input: validate graph references before writing any package files. */
export function parsePackageLock(
  source: string,
  path: string,
): BrowserPackageLock {
  try {
    const lock: BrowserPackageLock = JSON.parse(source);
    if (
      !lock.dependencies ||
      !lock.packages ||
      !lock.resolutions ||
      !lock.omitted ||
      !Array.isArray(lock.optional)
    )
      throw new Error();
    for (const [name, range] of Object.entries(lock.dependencies)) {
      assertPackageName(name);
      if (typeof range !== 'string') throw new Error();
    }
    for (const name of lock.optional) {
      assertPackageName(name);
      if (!Object.hasOwn(lock.dependencies, name)) throw new Error();
    }
    for (const name of Object.keys(lock.dependencies))
      if (!lock.resolutions.primary[name] && !lock.optional.includes(name))
        throw new Error();
    for (const name of Object.keys(lock.resolutions.primary))
      if (!Object.hasOwn(lock.dependencies, name)) throw new Error();
    for (const [url, pkg] of Object.entries(lock.packages)) {
      assertPackageName(pkg.name);
      if (
        url !== packageUrl(pkg) ||
        typeof pkg.version !== 'string' ||
        !pkg.integrity ||
        !pkg.tarball.startsWith('https://')
      )
        throw new Error();
    }
    for (const [url, scope] of [
      [null, lock.resolutions.primary],
      ...Object.entries(lock.resolutions.secondary),
    ] as const) {
      if (url && !lock.packages[url]) throw new Error();
      for (const [name, resolution] of Object.entries(scope)) {
        assertPackageName(name);
        if (!lock.packages[resolution.installUrl]) throw new Error();
      }
    }
    return lock;
  } catch {
    throw new Error(
      `Invalid ${path}: package lock references are incomplete or malformed.`,
    );
  }
}
