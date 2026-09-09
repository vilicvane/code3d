import type {BrowserProjectFileSystem} from './filesystem';
import {decodeProjectFile, type ProjectFileReader} from './file-reader';
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
    encodeURIComponent(pkg.name + '@' + pkg.version) +
    '/node_modules/' +
    pkg.name
  );
};
function relativePath(from: string, to: string): string {
  const left = normalizeProjectPath(from).split('/').filter(Boolean);
  const right = normalizeProjectPath(to).split('/').filter(Boolean);
  while (left.length && left[0] === right[0]) {
    left.shift();
    right.shift();
  }
  return [...left.map(() => '..'), ...right].join('/') || '.';
}

/** Installs only reached package scopes. All consumers read the resulting files. */
export class BrowserPackageInstaller implements ProjectFileReader {
  private readonly prepared = new Map<string, Promise<void>>();
  constructor(
    private readonly files: BrowserProjectFileSystem,
    private readonly progress: (message: string) => void = () => {},
    private readonly createRegistry = () => new NpmRegistry(),
  ) {}

  async prepare(file: string): Promise<void> {
    this.prepared.clear();
    const scope = await findPackageScope(this.files, file);
    await this.ensure(scope.directory);
  }

  private async prepareLookup(path: string) {
    const match = /^(.*?)\/node_modules(?:\/|$)/.exec(path);
    if (!match) return;
    const scope = await findPackageScope(
      this.files,
      pathAt(match[1], '__lookup.ts'),
    );
    await this.ensure(scope.directory);
  }
  async readFile(path: string) {
    await this.prepareLookup(path);
    return this.files.readFile(path);
  }
  async stat(path: string) {
    await this.prepareLookup(path);
    return this.files.stat(path);
  }

  private ensure(directory: string): Promise<void> {
    let pending = this.prepared.get(directory);
    if (!pending) {
      const run = () => this.install(directory);
      // Browser tabs using the same IndexedDB workspace must serialize replacement.
      pending =
        typeof navigator !== 'undefined' && navigator.locks
          ? navigator.locks.request('code3d-npm:' + directory, run)
          : run();
      this.prepared.set(directory, pending);
      pending.catch(() => {
        if (this.prepared.get(directory) === pending)
          this.prepared.delete(directory);
      });
    }
    return pending;
  }

  private async install(directory: string): Promise<void> {
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
      oldLockSource === undefined
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
      lock = await resolvePackageLock(manifest, registry, lock, this.progress);
    const serialized = JSON.stringify(lock, null, 2) + '\n';
    const modules = pathAt(directory, 'node_modules');
    const scratch = pathAt(directory, '.code3d/package-install');
    const staged = scratch + '/node_modules';
    const backup = scratch + '/previous';
    let marker = await this.files.readFile(modules + '/.code3d-install.json');
    if (await this.files.stat(backup)) {
      if (!marker || decodeProjectFile(marker) !== oldLockSource) {
        if (await this.files.stat(modules)) await this.files.remove(modules);
        await this.files.rename(backup, modules);
        marker = await this.files.readFile(modules + '/.code3d-install.json');
      }
    }
    if (
      marker &&
      decodeProjectFile(marker) === serialized &&
      oldLockSource === serialized
    )
      return;

    if (await this.files.stat(scratch)) await this.files.remove(scratch);
    await this.files.createDirectory(staged);
    let movedOld = false;
    let movedNew = false;
    try {
      for (const [url, pkg] of Object.entries(lock.packages)) {
        this.progress(`Downloading ${pkg.name}@${pkg.version}`);
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
      await this.files.writeFile(staged + '/.code3d-install.json', serialized);
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
      this.progress('Saving installed packages');
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
  }
}
