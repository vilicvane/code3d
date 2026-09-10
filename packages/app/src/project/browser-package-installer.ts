import type {BrowserProjectFileSystem} from './filesystem';
import {
  decodeProjectFile,
  type ProjectFileInfo,
  type ProjectFileReader,
} from './file-reader';
import {normalizeProjectPath, projectDirectory} from './project';
import {
  findPackageScope,
  parsePackageManifest,
  validateBrowserManifest,
} from './package-manifest';
import {
  dependencySignature,
  packageLockName,
  parsePackageLock,
  resolvePackageLock,
  type BrowserPackageLock,
} from './package-lock';
import {extractNpmArchive, NpmRegistry} from './npm-registry';

const pathAt = (directory: string, path: string) =>
  normalizeProjectPath(directory + '/' + path);
const packagePath = (lock: BrowserPackageLock, url: string) => {
  const pkg = lock.packages[url];
  return (
    '.code3d/' +
    pkg.name.replace('/', '+') +
    '@' +
    pkg.version +
    '/node_modules/' +
    pkg.name
  );
};
/** The installation cache depends on both the lock and its filesystem layout. */
function installationMarker(lock: BrowserPackageLock): string {
  return (
    JSON.stringify({
      lock,
      paths: Object.keys(lock.packages).map(url => packagePath(lock, url)),
    }) + '\n'
  );
}

function relativePath(from: string, to: string): string {
  const left = normalizeProjectPath(from).split('/').filter(Boolean);
  const right = normalizeProjectPath(to).split('/').filter(Boolean);
  while (left.length && left[0] === right[0]) {
    left.shift();
    right.shift();
  }
  return [...left.map(() => '..'), ...right].join('/') || '.';
}

export type PackageInstallationProgress = Readonly<{
  directory: string;
  state: 'busy' | 'ready' | 'error';
  message: string;
}>;

export class PackageInstallationError extends Error {
  constructor(
    readonly directory: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), {cause});
    this.name = 'PackageInstallationError';
  }
}

type InstallationState = {key: string; manifest: string; cacheable: boolean};

/** Installs only reached package scopes. All consumers read the resulting files. */
export class BrowserPackageInstaller implements ProjectFileReader {
  private readonly prepared = new Map<string, InstallationState>();
  private readonly preparing = new Map<string, Promise<void>>();
  private readonly lookups = new Map<
    string,
    Promise<InstallationState | undefined>
  >();
  private readonly fileInfo = new Map<
    string,
    {key: string; info: Promise<ProjectFileInfo | undefined>}
  >();
  private readonly failures = new Set<string>();
  constructor(
    private readonly files: BrowserProjectFileSystem,
    private readonly progress: (
      progress: PackageInstallationProgress,
    ) => void = () => {},
    private readonly createRegistry = () => new NpmRegistry(),
    private readonly installed: () => void = () => {},
  ) {}

  async prepare(
    file: string,
    {update = false}: {update?: boolean} = {},
  ): Promise<void> {
    this.lookups.clear();
    const scope = await findPackageScope(this.files, file);
    await this.ensure(scope.directory, update);
  }

  private async prepareLookup(path: string) {
    const match = /^(.*?)\/node_modules(?:\/|$)/.exec(path);
    if (!match) return;
    let lookup = this.lookups.get(match[1]);
    if (!lookup) {
      lookup = findPackageScope(
        this.files,
        pathAt(match[1], '__lookup.ts'),
      ).then(async scope => {
        await this.ensure(scope.directory);
        return scope.directory === normalizeProjectPath(match[1])
          ? this.prepared.get(scope.directory)
          : undefined;
      });
      this.lookups.set(match[1], lookup);
      lookup.catch(() => {
        if (this.lookups.get(match[1]) === lookup)
          this.lookups.delete(match[1]);
      });
    }
    return lookup;
  }
  async readFile(path: string) {
    await this.prepareLookup(path);
    return this.files.readFile(path);
  }
  async stat(path: string) {
    const installation = await this.prepareLookup(path);
    // Installed package trees are read-only and replaced together with their marker.
    // Keep checking ordinary files and trees which are not owned by the installer.
    if (!installation?.cacheable) return this.files.stat(path);
    let cached = this.fileInfo.get(path);
    if (cached?.key !== installation.key) {
      const info = this.files.stat(path).catch(error => {
        if (this.fileInfo.get(path)?.info === info) this.fileInfo.delete(path);
        throw error;
      });
      cached = {key: installation.key, info};
      this.fileInfo.set(path, cached);
    }
    return cached.info;
  }

  statMany(paths: readonly string[]) {
    return Promise.all(paths.map(path => this.stat(path)));
  }

  private async installationState(
    directory: string,
  ): Promise<InstallationState> {
    const paths = [
      'package.json',
      packageLockName,
      'node_modules',
      'node_modules/.code3d-install.json',
    ];
    const states = await Promise.all(
      paths.map(path => this.files.stat(pathAt(directory, path))),
    );
    return {
      key: JSON.stringify(states),
      manifest: JSON.stringify(states[0] ?? null),
      cacheable: states[2]?.kind === 'directory' && states[3]?.kind === 'file',
    };
  }

  private ensure(directory: string, update = false): Promise<void> {
    const pending = this.preparing.get(directory);
    if (pending) return pending.then(() => this.ensure(directory, update));
    const run = async () => {
      const before = await this.installationState(directory);
      if (!update && this.prepared.get(directory)?.key === before.key) return;
      const install = async () => {
        let reported = false;
        try {
          await this.install(
            directory,
            message => {
              reported = true;
              this.progress({directory, state: 'busy', message});
            },
            update,
          );
          const after = await this.installationState(directory);
          // A newer manifest needs its own preparation, even if it was saved just after the swap.
          if (before.manifest === after.manifest)
            this.prepared.set(directory, after);
          if (reported || this.failures.has(directory))
            this.progress({
              directory,
              state: 'ready',
              message: reported ? 'Packages installed' : 'Packages ready',
            });
          this.failures.delete(directory);
        } catch (error) {
          this.prepared.delete(directory);
          this.failures.add(directory);
          const failure = new PackageInstallationError(directory, error);
          this.progress({
            directory,
            state: 'error',
            message: failure.message,
          });
          throw failure;
        }
      };
      // Browser tabs using the same IndexedDB workspace must serialize replacement.
      if (typeof navigator !== 'undefined' && navigator.locks)
        await navigator.locks.request('code3d-npm:' + directory, install);
      else await install();
    };
    const preparation = run().finally(() => {
      if (this.preparing.get(directory) === preparation)
        this.preparing.delete(directory);
    });
    this.preparing.set(directory, preparation);
    return preparation;
  }

  private async install(
    directory: string,
    progress: (message: string) => void,
    update: boolean,
  ): Promise<void> {
    const manifestPath = pathAt(directory, 'package.json');
    const bytes = await this.files.readFile(manifestPath);
    if (!bytes) return;
    const source = decodeProjectFile(bytes);
    const manifest = parsePackageManifest(source, manifestPath);
    validateBrowserManifest(manifest);
    const lockPath = pathAt(directory, packageLockName);
    const oldLockBytes = await this.files.readFile(lockPath);
    const oldLockSource = oldLockBytes
      ? decodeProjectFile(oldLockBytes)
      : undefined;
    let lock =
      update || oldLockSource === undefined
        ? undefined
        : parsePackageLock(oldLockSource, lockPath);
    const registry = this.createRegistry();
    if (
      !lock ||
      dependencySignature({
        dependencies: lock.dependencies,
        optionalDependencies: Object.fromEntries(
          lock.optional.map(name => [name, lock!.dependencies[name]]),
        ),
      }) !== dependencySignature(manifest)
    )
      lock = await resolvePackageLock(manifest, registry, lock, progress);
    const serialized = JSON.stringify(lock, null, 2) + '\n';
    const nextMarker = installationMarker(lock);
    const modules = pathAt(directory, 'node_modules');
    const scratch = pathAt(directory, '.code3d/package-install');
    const staged = scratch + '/node_modules';
    const backup = scratch + '/previous';
    let marker = await this.files.readFile(modules + '/.code3d-install.json');
    if (await this.files.stat(backup)) {
      let committed = false;
      if (marker && oldLockSource !== undefined) {
        try {
          committed =
            decodeProjectFile(marker) ===
            installationMarker(parsePackageLock(oldLockSource, lockPath));
        } catch {
          // An invalid lock cannot confirm a completed swap. Explicit updates
          // can still recover the previous installation and replace that lock.
        }
      }
      if (!committed) {
        if (await this.files.stat(modules)) await this.files.remove(modules);
        await this.files.rename(backup, modules);
        marker = await this.files.readFile(modules + '/.code3d-install.json');
      }
    }
    if (
      marker &&
      decodeProjectFile(marker) === nextMarker &&
      oldLockSource === serialized
    )
      return;

    if (await this.files.stat(scratch)) await this.files.remove(scratch);
    await this.files.createDirectory(staged);
    let movedOld = false;
    let movedNew = false;
    try {
      for (const [url, pkg] of Object.entries(lock.packages)) {
        progress(`Downloading ${pkg.name}@${pkg.version}`);
        const archive = await registry.archive(pkg);
        const destination = staged + '/' + packagePath(lock, url);
        const installed = await extractNpmArchive(archive, (path, contents) =>
          this.files.writeFile(destination + '/' + path, contents),
        );
        if (installed.name !== pkg.name || installed.version !== pkg.version)
          throw new Error(
            `Downloaded package does not match ${pkg.name}@${pkg.version}.`,
          );
      }
      const link = async (name: string, url: string, parent: string) => {
        const location = parent + '/' + name;
        await this.files.symlink(
          relativePath(
            projectDirectory(location),
            staged + '/' + packagePath(lock!, url),
          ),
          location,
        );
      };
      for (const [name, resolution] of Object.entries(lock.resolutions.primary))
        await link(name, resolution.installUrl, staged);
      for (const [url, dependencies] of Object.entries(
        lock.resolutions.secondary,
      )) {
        const pkg = lock.packages[url];
        // Dependencies sit beside the package, so cycles and peers share exact instances.
        const parent =
          staged + '/' + packagePath(lock, url).slice(0, -pkg.name.length - 1);
        for (const [name, resolution] of Object.entries(dependencies)) {
          if (name === pkg.name && resolution.installUrl === url) continue;
          // A package may depend on an older version of itself. Its name is
          // occupied beside it, so that dependency needs a nested node_modules.
          await link(
            name,
            resolution.installUrl,
            name === pkg.name
              ? parent + '/' + pkg.name + '/node_modules'
              : parent,
          );
        }
      }
      await this.files.writeFile(staged + '/.code3d-install.json', nextMarker);
      await this.files.writeFile(scratch + '/lock.json', serialized);
      if (
        decodeProjectFile(
          (await this.files.readFile(manifestPath)) ?? new Uint8Array(),
        ) !== source ||
        (await this.files.readFile(lockPath))?.toString() !==
          oldLockBytes?.toString()
      )
        throw new Error(
          `${manifestPath} or its lock changed during installation. Run again to install the current dependencies.`,
        );
      progress('Saving installed packages');
      if (await this.files.stat(modules)) {
        await this.files.rename(modules, backup);
        movedOld = true;
      }
      await this.files.rename(staged, modules);
      movedNew = true;
      await this.files.replaceFile(scratch + '/lock.json', lockPath);
    } catch (error) {
      if (movedNew) await this.files.remove(modules);
      if (movedOld) await this.files.rename(backup, modules);
      throw error;
    } finally {
      if (await this.files.stat(scratch)) await this.files.remove(scratch);
    }
    this.installed();
  }
}
