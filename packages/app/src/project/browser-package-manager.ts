import type {BrowserProjectFileSystem} from './filesystem';
import type {ProjectFileReader} from './file-reader';
import {findPackageDirectory} from './package-manifest';
import {normalizeProjectPath} from './project';
import {BrowserPackageInstaller} from './browser-package-installer';
import {
  InstalledPackageReader,
  installedPackageDirectory,
  type InstallationState,
} from './installed-package-reader';
import {NpmRegistry} from './npm-registry';

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

type PackageOperation = 'prepare' | 'install' | 'update';

/** One owner for directory tasks and their progress, shared by GUI and agent compilation. */
export class BrowserPackageManager {
  readonly files: InstalledPackageReader;
  readonly dependencies: ProjectFileReader;
  private readonly installer: BrowserPackageInstaller;
  private readonly prepared = new Map<string, InstallationState>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly lookups = new Map<string, Promise<void>>();
  private readonly failures = new Set<string>();
  private readonly pendingCleanup = new Set<string>();

  constructor(
    private readonly projectFiles: BrowserProjectFileSystem,
    private readonly progress: (
      progress: PackageInstallationProgress,
    ) => void = () => {},
    createRegistry = () => new NpmRegistry(),
    private readonly installed: (directory: string) => void = () => {},
  ) {
    this.installer = new BrowserPackageInstaller(projectFiles, createRegistry);
    this.files = new InstalledPackageReader(projectFiles);
    // Only dependency consumers opt into lazy scope preparation. Ordinary
    // navigation reads files directly and remains available during installation.
    this.dependencies = {
      readFile: async path => {
        await this.prepareLookup(path);
        return this.files.readFile(path);
      },
      stat: async path => {
        await this.prepareLookup(path);
        return this.files.stat(path);
      },
      statMany: paths =>
        Promise.all(paths.map(path => this.dependencies.stat(path))),
    };
  }

  async prepare(file: string): Promise<void> {
    this.lookups.clear();
    this.files.refresh();
    const directory = await findPackageDirectory(this.projectFiles, file);
    await this.enqueue(directory, 'prepare');
  }

  install(directory: string, edit: () => Promise<void>): Promise<void> {
    return this.enqueue(normalizeProjectPath(directory), 'install', edit);
  }

  update(directory: string, save?: () => Promise<void>): Promise<void> {
    return this.enqueue(normalizeProjectPath(directory), 'update', save);
  }

  private async prepareLookup(path: string): Promise<void> {
    const directory = installedPackageDirectory(path);
    if (directory === undefined) return;
    let lookup = this.lookups.get(directory);
    if (!lookup) {
      lookup = findPackageDirectory(
        this.projectFiles,
        normalizeProjectPath(directory + '/__lookup.ts'),
      ).then(scope => this.enqueue(scope, 'prepare'));
      this.lookups.set(directory, lookup);
      lookup.catch(() => {
        if (this.lookups.get(directory) === lookup)
          this.lookups.delete(directory);
      });
    }
    await lookup;
  }

  private enqueue(
    directory: string,
    kind: PackageOperation,
    beforeInstall?: () => Promise<void>,
  ): Promise<void> {
    const run = async () => {
      let reported = false;
      const report = (message: string) => {
        reported = true;
        this.progress({directory, state: 'busy', message});
      };
      try {
        if (kind !== 'prepare') report('Preparing packages');
        await beforeInstall?.();
        const before = await this.files.installationState(directory);
        if (
          kind === 'prepare' &&
          !this.pendingCleanup.has(directory) &&
          this.prepared.get(directory)?.key === before.key
        )
          return;
        const result = await this.installer.install(
          directory,
          report,
          kind === 'update',
        );
        if (result.cleanupPending) this.pendingCleanup.add(directory);
        else this.pendingCleanup.delete(directory);
        this.files.refresh();
        const after = await this.files.installationState(directory);
        if (before.manifest === after.manifest)
          this.prepared.set(directory, after);
        if (result.changed) await this.installed(directory);
        if (reported || this.failures.has(directory)) {
          this.progress({
            directory,
            state: 'ready',
            message:
              kind === 'update'
                ? 'Dependencies updated'
                : reported
                  ? 'Packages installed'
                  : 'Packages ready',
          });
        }
        this.failures.delete(directory);
      } catch (error) {
        this.prepared.delete(directory);
        this.failures.add(directory);
        const failure = new PackageInstallationError(directory, error);
        this.progress({directory, state: 'error', message: failure.message});
        throw failure;
      }
    };
    const exclusive = () =>
      typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request('code3d-npm:' + directory, run)
        : run();
    // A prior failure belongs to that request; it must not discard the next
    // explicit update or a preparation for a corrected manifest.
    const task = (this.tasks.get(directory) ?? Promise.resolve())
      .catch(() => {})
      .then(exclusive)
      .finally(() => {
        if (this.tasks.get(directory) === task) this.tasks.delete(directory);
      });
    this.tasks.set(directory, task);
    return task;
  }
}
