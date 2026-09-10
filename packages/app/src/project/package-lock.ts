import {
  assertPackageName,
  manifestDependencies,
  type PackageManifest,
} from './package-manifest';
import {npmPackageUrl} from './npm-registry';
import {workspacePackageUrl, type PackageArtifact} from './workspace-packages';

export const packageLockName = 'code3d-lock.json';
type PackageResolution = {installUrl: `${string}/`};
export type BrowserPackageLock = {
  dependencies: Record<string, string>;
  resolutions: {
    primary: Record<string, PackageResolution>;
    secondary: Record<`${string}/`, Record<string, PackageResolution>>;
  };
  packages: Record<string, PackageArtifact>;
  workspace?: string;
  omitted: Record<string, string>;
  optional: string[];
};

/** Package edges keep materialization independent of the resolver's scope layout. */
export function packageDependencyEdges(
  lock: BrowserPackageLock,
): {parent: string | null; name: string; target: string}[] {
  const scopes: (readonly [
    string | null,
    Record<string, PackageResolution>,
  ])[] = [
    [null, lock.resolutions.primary],
    ...Object.entries(lock.resolutions.secondary),
  ];
  return scopes.flatMap(([parent, dependencies]) =>
    Object.entries(dependencies).map(([name, resolution]) => ({
      parent,
      name,
      target: resolution.installUrl,
    })),
  );
}

export function dependencySignature(manifest: PackageManifest): string {
  return JSON.stringify({
    dependencies: Object.entries(manifestDependencies(manifest)).sort(
      ([a], [b]) => a.localeCompare(b),
    ),
    optional: Object.keys(manifest.optionalDependencies ?? {}).sort(),
  });
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
      if ('workspace' in pkg) {
        if (
          typeof pkg.version !== 'string' ||
          !/^[a-f0-9]{64}$/.test(pkg.workspace) ||
          url !== workspacePackageUrl(pkg)
        )
          throw new Error();
        continue;
      }
      if (
        url !== npmPackageUrl(pkg) ||
        typeof pkg.version !== 'string' ||
        !pkg.integrity ||
        !pkg.tarball.startsWith('https://')
      )
        throw new Error();
    }
    if (lock.workspace !== undefined && typeof lock.workspace !== 'string')
      throw new Error();
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
