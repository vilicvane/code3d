import {type ProjectFileInfo, type ProjectFileReader} from './file-reader';
import {packageLockName} from './package-lock';
import {normalizeProjectPath} from './project';

export type InstallationState = {
  key: string;
  manifest: string;
  generation: string;
  cacheable: boolean;
};

export function installedPackageDirectory(path: string): string | undefined {
  const match = /^(.*?)\/node_modules(?:\/|$)/.exec(path);
  return match ? normalizeProjectPath(match[1]) : undefined;
}

/** Read installed files without triggering installation; cache their immutable metadata by scope. */
export class InstalledPackageReader implements ProjectFileReader {
  private readonly scopes = new Map<string, Promise<InstallationState>>();
  private readonly entries = new Map<
    string,
    {key: string; info: Promise<ProjectFileInfo | undefined>}
  >();

  constructor(private readonly files: ProjectFileReader) {}

  refresh(): void {
    this.scopes.clear();
  }

  invalidate(directory: string): void {
    this.scopes.delete(directory);
    for (const path of this.entries.keys())
      if (installedPackageDirectory(path) === directory)
        this.entries.delete(path);
  }

  async installationState(directory: string): Promise<InstallationState> {
    const states = await Promise.all(
      [
        'package.json',
        packageLockName,
        'node_modules',
        'node_modules/.code3d-install.json',
      ].map(path =>
        this.files.stat(normalizeProjectPath(directory + '/' + path)),
      ),
    );
    return {
      key: JSON.stringify(states),
      manifest: JSON.stringify(states[0] ?? null),
      generation: JSON.stringify(states.slice(1)),
      cacheable: states[2]?.kind === 'directory' && states[3]?.kind === 'file',
    };
  }

  readFile(path: string) {
    return this.files.readFile(path);
  }

  async stat(path: string): Promise<ProjectFileInfo | undefined> {
    const directory = installedPackageDirectory(path);
    if (directory === undefined) return this.files.stat(path);
    let pending = this.scopes.get(directory);
    if (!pending) {
      pending = this.installationState(directory);
      this.scopes.set(directory, pending);
      pending.catch(() => {
        if (this.scopes.get(directory) === pending)
          this.scopes.delete(directory);
      });
    }
    const state = await pending;
    if (!state.cacheable) return this.files.stat(path);
    let entry = this.entries.get(path);
    if (entry?.key !== state.key) {
      const info = this.files.stat(path).catch(error => {
        if (this.entries.get(path)?.info === info) this.entries.delete(path);
        throw error;
      });
      entry = {key: state.key, info};
      this.entries.set(path, entry);
    }
    return entry.info;
  }

  statMany(paths: readonly string[]) {
    return Promise.all(paths.map(path => this.stat(path)));
  }
}
