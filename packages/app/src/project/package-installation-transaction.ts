import type {BrowserProjectFileSystem} from './filesystem';
import {normalizeProjectPath} from './project';
import {packageLockName} from './package-lock';

/** Replace an installation and its lock; only the lock rename commits the swap. */
export class PackageInstallationTransaction {
  readonly modules: string;
  readonly scratch: string;
  readonly staged: string;
  readonly stagedLock: string;
  private readonly backup: string;
  private readonly lock: string;

  constructor(
    private readonly files: BrowserProjectFileSystem,
    directory: string,
  ) {
    this.modules = normalizeProjectPath(directory + '/node_modules');
    this.lock = normalizeProjectPath(directory + '/' + packageLockName);
    this.scratch = normalizeProjectPath(directory + '/.code3d/package-install');
    this.staged = this.scratch + '/node_modules';
    this.stagedLock = this.scratch + '/lock.json';
    this.backup = this.scratch + '/previous';
  }

  /** Keep recovery data until rollback succeeds; collect committed leftovers separately. */
  async recover(isCommitted: () => Promise<boolean>): Promise<boolean> {
    if (!(await this.files.stat(this.scratch))) return true;
    if (await this.files.stat(this.backup)) {
      if (!(await isCommitted())) {
        if (await this.files.stat(this.modules))
          await this.files.remove(this.modules);
        await this.files.rename(this.backup, this.modules);
      }
    } else if (
      (await this.files.stat(this.stagedLock)) &&
      !(await this.files.stat(this.staged)) &&
      !(await isCommitted())
    ) {
      // A first installation can be interrupted after its directory rename,
      // before the lock commits, without having a previous directory to restore.
      if (await this.files.stat(this.modules))
        await this.files.remove(this.modules);
    }
    return this.cleanup();
  }

  async replace(
    stage: (directory: string, lock: string) => Promise<void>,
    validate: () => Promise<void>,
  ): Promise<boolean> {
    // A new transaction cannot overwrite recovery data it failed to collect.
    if (await this.files.stat(this.scratch))
      await this.files.remove(this.scratch);
    await this.files.createDirectory(this.staged);
    let movedOld = false;
    let movedNew = false;
    try {
      await stage(this.staged, this.stagedLock);
      await validate();
      if (await this.files.stat(this.modules)) {
        await this.files.rename(this.modules, this.backup);
        movedOld = true;
      }
      await this.files.rename(this.staged, this.modules);
      movedNew = true;
      await this.files.replaceFile(this.stagedLock, this.lock);
    } catch (error) {
      try {
        if (movedNew) await this.files.remove(this.modules);
        if (movedOld) await this.files.rename(this.backup, this.modules);
      } catch (recoveryError) {
        // Never delete the backup when recovery itself fails.
        throw new AggregateError(
          [error, recoveryError],
          'Package installation failed to roll back. Recovery files were preserved; retry to restore the previous installation.',
        );
      }
      await this.cleanup();
      throw error;
    }
    // The new installation is committed even if collecting its backup fails.
    return this.cleanup();
  }

  private async cleanup(): Promise<boolean> {
    try {
      if (await this.files.stat(this.scratch))
        await this.files.remove(this.scratch);
      return true;
    } catch {
      // Retry collection on the next preparation, without misreporting a
      // committed installation as failed or removing its active files.
      return false;
    }
  }
}
