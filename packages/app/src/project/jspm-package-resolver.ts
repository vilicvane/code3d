import type {ExactPackage, PackageConfig, Provider} from '@jspm/generator';
import {
  manifestDependencies,
  validateBrowserManifest,
  parsePackageSpecifier,
  type PackageManifest,
} from './package-manifest';
import {
  NpmRegistry,
  packageArtifact,
  npmPackageUrl as packageUrl,
  type NpmMetadata,
  type NpmPackage,
} from './npm-registry';
import type {BrowserPackageLock} from './package-lock';
import {mapProjectIO} from './io';

const baseUrl = 'https://code3d.invalid/';
const registryUrl = 'https://registry.npmjs.org/';
function parsePackageUrl(url: string): ExactPackage | undefined {
  if (!url.startsWith(registryUrl)) return;
  const [name, version] = url.slice(registryUrl.length).split('/');
  if (!name || !version) return;
  return {registry: 'npm', name: decodeURIComponent(name), version};
}

/** JSPM's package installer resolves manifests; executable-module tracing would omit types and assets. */
export async function resolveBrowserPackages(
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
    installer.installs = {
      ...structuredClone(previous.resolutions),
      flattened: {},
    };
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
  const prefetch = async (
    configs: readonly {config: PackageManifest; scope: `${string}/` | null}[],
  ) => {
    const names = new Set<string>();
    const exact = new Set<string>();
    for (const {config, scope} of configs) {
      const locked = scope
        ? installer.installs.secondary[scope]
        : installer.installs.primary;
      for (const [name, range] of Object.entries(
        manifestDependencies(config, scope === null),
      )) {
        if (locked?.[name]) {
          exact.add(locked[name].installUrl);
          continue;
        }
        // Prefetch is advisory. Let the resolver report unsupported or malformed
        // targets in their original scope, including optional dependency policy.
        if (/^(?:file:|link:|workspace:|https?:|git|github:)|^[./]/.test(range))
          continue;
        try {
          names.add(
            range.startsWith('npm:')
              ? parsePackageSpecifier(range.slice(4)).name
              : name,
          );
        } catch {
          /* Resolved below. */
        }
      }
    }
    if (names.size || exact.size) progress('Resolving package metadata');
    await registry.prefetch([...names]);
    await mapProjectIO(
      [...exact],
      async url => {
        await getMetadata(url).catch(() => {});
      },
      {concurrency: 15},
    );
  };
  await prefetch([{config: manifest, scope: null}]);
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
    const configs = await mapProjectIO(
      urls,
      async url => ({scope: url, config: await getMetadata(url)}),
      {concurrency: 15},
    );
    await prefetch(configs);
    // JSPM consolidates mutable version choices. Only independent metadata I/O
    // is parallel; applying each resolution retains stable manifest order.
    for (const {scope: url, config} of configs) {
      visited.add(url);
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
    resolutions: {primary: lock.primary, secondary: lock.secondary},
    packages: Object.fromEntries(
      [...reachable].map(url => [url, packages[url]]),
    ),
    omitted,
  };
}
