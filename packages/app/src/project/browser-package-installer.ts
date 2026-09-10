import type {BrowserProjectFileSystem} from './filesystem';
import {decodeProjectFile} from './file-reader';
import {normalizeProjectPath, projectDirectory} from './project';
import {
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
import {mapProjectIO} from './io';
import {PackageInstallationTransaction} from './package-installation-transaction';

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

/** Resolve and materialize one package scope; scheduling and presentation belong to its manager. */
export class BrowserPackageInstaller {
  constructor(
    private readonly files: BrowserProjectFileSystem,
    private readonly createRegistry = () => new NpmRegistry(),
  ) {}

  async install(
    directory: string,
    progress: (message: string) => void,
    update: boolean,
  ): Promise<{changed: boolean; cleanupPending: boolean}> {
    const transaction = new PackageInstallationTransaction(
      this.files,
      directory,
    );
    const lockPath = pathAt(directory, packageLockName);
    const collected = await transaction.recover(async () => {
      const [marker, lock] = await Promise.all([
        this.files.readFile(transaction.modules + '/.code3d-install.json'),
        this.files.readFile(lockPath),
      ]);
      if (!marker || !lock) return false;
      try {
        return (
          decodeProjectFile(marker) ===
          installationMarker(
            parsePackageLock(decodeProjectFile(lock), lockPath),
          )
        );
      } catch {
        return false;
      }
    });

    const manifestPath = pathAt(directory, 'package.json');
    const bytes = await this.files.readFile(manifestPath);
    if (!bytes) return {changed: false, cleanupPending: !collected};
    const source = decodeProjectFile(bytes);
    const manifest = parsePackageManifest(source, manifestPath);
    validateBrowserManifest(manifest);
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
    const marker = await this.files.readFile(
      transaction.modules + '/.code3d-install.json',
    );
    if (
      marker &&
      decodeProjectFile(marker) === nextMarker &&
      oldLockSource === serialized
    )
      return {changed: false, cleanupPending: !collected};

    const cleaned = await transaction.replace(
      async (staged, stagedLock) => {
        let extracting = Promise.resolve();
        await mapProjectIO(
          Object.entries(lock.packages),
          async ([url, pkg]) => {
            progress(`Downloading ${pkg.name}@${pkg.version}`);
            const archive = await registry.archive(pkg);
            // Overlap downloads with one extractor, bounding queued archives to
            // the download budget instead of retaining every package in memory.
            await (extracting = extracting.then(async () => {
              progress(`Unpacking ${pkg.name}@${pkg.version}`);
              const destination = staged + '/' + packagePath(lock!, url);
              const installed = await extractNpmArchive(
                archive,
                (path, contents) =>
                  this.files.writeFile(destination + '/' + path, contents),
              );
              if (
                installed.name !== pkg.name ||
                installed.version !== pkg.version
              )
                throw new Error(
                  `Downloaded package does not match ${pkg.name}@${pkg.version}.`,
                );
            }));
          },
          {
            // Reference npm's default maxsockets; browsers manage actual connections.
            concurrency: 15,
          },
        );
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
        for (const [name, resolution] of Object.entries(
          lock.resolutions.primary,
        ))
          await link(name, resolution.installUrl, staged);
        for (const [url, dependencies] of Object.entries(
          lock.resolutions.secondary,
        )) {
          const pkg = lock.packages[url];
          // Dependencies sit beside the package, so cycles and peers share exact instances.
          const parent =
            staged +
            '/' +
            packagePath(lock, url).slice(0, -pkg.name.length - 1);
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
        await this.files.writeFile(
          staged + '/.code3d-install.json',
          nextMarker,
        );
        await this.files.writeFile(stagedLock, serialized);
      },
      async () => {
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
      },
    );
    return {changed: true, cleanupPending: !cleaned};
  }
}
