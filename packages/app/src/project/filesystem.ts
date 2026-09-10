import {configureSingle, fs} from '@zenfs/core';
import {IndexedDB} from '@zenfs/dom';
import {isExcludedProjectEntry} from './file-operations';
import {mapProjectIO} from './io';
import {
  DirectoryFileReader,
  decodeProjectFile,
  type ProjectFileReader,
} from './file-reader';
import {
  normalizeProjectPath,
  projectDirectory,
  type ProjectDirectoryTemplate,
} from './project';

const browserProjectRoot = '/workspace';
const browserManifestPath = '/code3d-project.json';
const browserStoreName = 'code3d-project-v1';
const directoryProjectRoot = '/';
const directoryManifestPath = '/.code3d/project.json';

type ProjectManifest = Readonly<{
  version: 2;
  managedDirectories: Readonly<Record<string, string>>;
}>;

type ProjectFileOperations = {
  mkdir(path: string, options: {recursive: true}): Promise<unknown>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  readdir(
    path: string,
    options: {withFileTypes: true},
  ): Promise<
    readonly {
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }[]
  >;
  rename(from: string, to: string): Promise<unknown>;
  rm(
    path: string,
    options: {recursive: boolean; force: boolean},
  ): Promise<unknown>;
  stat(
    path: string,
    options: {throwIfNoEntry: false},
  ): Promise<unknown | undefined>;
  writeFile(
    path: string,
    source: string | Uint8Array,
    encoding?: 'utf8',
  ): Promise<unknown>;
};

export interface ProjectFileSystem extends ProjectFileReader {
  list(
    path: string,
  ): Promise<readonly {name: string; kind: 'file' | 'directory'}[]>;
  initialize(seed: () => Promise<void>): Promise<void>;
  syncDirectory(template: ProjectDirectoryTemplate): Promise<void>;
  resetDirectory(template: ProjectDirectoryTemplate): Promise<void>;
  writeFile(path: string, source: string | Uint8Array): Promise<void>;
  createDirectory(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

let configureBrowserPromise: Promise<void> | undefined;

export interface BrowserProjectFileSystem extends ProjectFileSystem {
  /** Atomically replace an installer-owned file; explorer renames never overwrite. */
  replaceFile(from: string, to: string): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
}

export async function openBrowserProjectFileSystem(): Promise<BrowserProjectFileSystem> {
  await configureBrowserFileSystem();
  const store = new ProjectStore(
    fs.promises,
    browserProjectRoot,
    browserManifestPath,
    {
      async readFile(path) {
        try {
          return new Uint8Array(await fs.promises.readFile(path));
        } catch (error) {
          if (isAbsentFile(error)) return undefined;
          throw error;
        }
      },
      async stat(path) {
        const info = await fs.promises.stat(path, {throwIfNoEntry: false});
        return info
          ? {
              kind: info.isDirectory() ? 'directory' : 'file',
              version: `${info.mtimeMs}:${info.size}`,
              size: info.size,
              realPath: normalizeProjectPath(
                (await fs.promises.realpath(path)).slice(
                  browserProjectRoot.length,
                ),
              ),
            }
          : undefined;
      },
    },
  );
  return Object.assign(store, {
    async replaceFile(from: string, to: string) {
      await fs.promises.rename(
        browserProjectRoot + normalizeProjectPath(from),
        browserProjectRoot + normalizeProjectPath(to),
      );
    },
    async symlink(target: string, path: string) {
      await store.createDirectory(projectDirectory(path));
      await fs.promises.symlink(
        target,
        browserProjectRoot + normalizeProjectPath(path),
      );
    },
  });
}

export async function openDirectoryProjectFileSystem(
  handle: FileSystemDirectoryHandle,
): Promise<ProjectFileSystem> {
  const reader = new DirectoryFileReader(handle);
  return new ProjectStore(
    directoryOperations(reader),
    directoryProjectRoot,
    directoryManifestPath,
    reader,
  );
}

async function configureBrowserFileSystem(): Promise<void> {
  configureBrowserPromise ??= configureSingle({
    backend: IndexedDB,
    storeName: browserStoreName,
  });
  await configureBrowserPromise;
}

class ProjectStore implements ProjectFileSystem {
  constructor(
    private readonly files: ProjectFileOperations,
    private readonly projectRoot: string,
    private readonly manifestPath: string,
    private readonly reader: ProjectFileReader,
  ) {}

  readFile(path: string) {
    return this.reader.readFile(this.toDiskPath(normalizeProjectPath(path)));
  }

  stat(path: string) {
    return this.reader.stat(this.toDiskPath(normalizeProjectPath(path)));
  }

  async list(
    path: string,
  ): Promise<readonly {name: string; kind: 'file' | 'directory'}[]> {
    const entries = await this.files.readdir(
      this.toDiskPath(normalizeProjectPath(path)),
      {withFileTypes: true},
    );
    const result = await mapProjectIO(entries, async entry => {
      const kind = entry.isDirectory()
        ? 'directory'
        : entry.isFile()
          ? 'file'
          : (await this.stat(joinPath(path, entry.name)))?.kind;
      return kind ? {name: entry.name, kind} : undefined;
    });
    return result
      .filter(entry => entry !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Seed only empty workspaces; initialization never reads project contents. */
  async initialize(seed: () => Promise<void>): Promise<void> {
    await this.files.mkdir(this.projectRoot, {recursive: true});
    if (await this.readManifest()) return;
    const entries = await this.list('/');
    if (
      !entries.some(
        entry =>
          entry.name !== '.code3d' && !isExcludedProjectEntry(entry.name),
      )
    ) {
      await seed();
    }
    await this.writeManifest(newManifest());
  }

  async syncDirectory(template: ProjectDirectoryTemplate): Promise<void> {
    const manifest = await this.requireManifest();
    const directory = normalizeProjectPath(template.directory);
    if (manifest.managedDirectories[directory] === template.revision) {
      return;
    }
    return this.replaceDirectory(template, manifest);
  }

  async resetDirectory(template: ProjectDirectoryTemplate): Promise<void> {
    return this.replaceDirectory(template, await this.requireManifest());
  }

  private async replaceDirectory(
    template: ProjectDirectoryTemplate,
    manifest: ProjectManifest,
  ): Promise<void> {
    // Prepare binary assets before replacing the managed directory.
    const assets = await Promise.all(
      (template.assets ?? []).map(async asset => {
        const response = await fetch(asset.url);
        if (!response.ok)
          throw new Error('Could not load project asset: ' + asset.path);
        return {
          path: asset.path,
          contents: new Uint8Array(await response.arrayBuffer()),
        };
      }),
    );
    const directory = normalizeProjectPath(template.directory);
    const diskPath = this.toDiskPath(directory);
    if (await this.exists(diskPath)) {
      await this.files.rm(diskPath, {recursive: true, force: true});
    }
    await mapProjectIO(template.files, file =>
      this.writeFile(file.path, file.source),
    );
    for (const asset of assets) {
      const path = this.toDiskPath(normalizeProjectPath(asset.path));
      await this.files.mkdir(projectDirectory(path), {recursive: true});
      await this.files.writeFile(path, asset.contents);
    }
    await this.writeManifest({
      ...manifest,
      managedDirectories: {
        ...manifest.managedDirectories,
        [directory]: template.revision,
      },
    });
  }

  async writeFile(path: string, source: string | Uint8Array): Promise<void> {
    const diskPath = this.toDiskPath(normalizeProjectPath(path));
    await this.files.mkdir(projectDirectory(diskPath), {recursive: true});
    await this.files.writeFile(diskPath, source, 'utf8');
  }

  async createDirectory(path: string): Promise<void> {
    await this.files.mkdir(this.toDiskPath(normalizeProjectPath(path)), {
      recursive: true,
    });
  }

  async rename(from: string, to: string): Promise<void> {
    const destination = this.toDiskPath(normalizeProjectPath(to));
    if (await this.exists(destination))
      throw new Error(`Project destination already exists: ${to}`);
    await this.files.mkdir(projectDirectory(destination), {recursive: true});
    await this.files.rename(
      this.toDiskPath(normalizeProjectPath(from)),
      destination,
    );
  }

  async remove(path: string): Promise<void> {
    await this.files.rm(this.toDiskPath(normalizeProjectPath(path)), {
      recursive: true,
      force: false,
    });
  }

  private async requireManifest(): Promise<ProjectManifest> {
    const manifest = await this.readManifest();
    if (!manifest) throw new Error('The Code3D project is not initialized.');
    return manifest;
  }

  private async readManifest(): Promise<ProjectManifest | undefined> {
    if (!(await this.exists(this.manifestPath))) return undefined;
    const value = JSON.parse(
      await this.files.readFile(this.manifestPath, 'utf8'),
    ) as Partial<ProjectManifest>;
    if (value.version !== 2) {
      return undefined;
    }
    return {
      version: 2,
      managedDirectories: Object.fromEntries(
        Object.entries(value.managedDirectories ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    };
  }

  private async writeManifest(manifest: ProjectManifest): Promise<void> {
    await this.files.mkdir(projectDirectory(this.manifestPath), {
      recursive: true,
    });
    await this.files.writeFile(
      this.manifestPath,
      JSON.stringify(manifest),
      'utf8',
    );
  }

  private async exists(path: string): Promise<boolean> {
    return (await this.files.stat(path, {throwIfNoEntry: false})) !== undefined;
  }

  private toDiskPath(path: string): string {
    return this.projectRoot === '/'
      ? path
      : path === '/'
        ? this.projectRoot
        : `${this.projectRoot}${path}`;
  }
}

function newManifest(): ProjectManifest {
  return {
    version: 2,
    managedDirectories: {},
  };
}

function joinPath(directory: string, name: string): string {
  return directory === '/' ? `/${name}` : `${directory}/${name}`;
}

function isAbsentFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(String(error.code))
  );
}

type IterableDirectory = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle>;
};

function directoryOperations(
  reader: DirectoryFileReader,
): ProjectFileOperations {
  const parent = async (path: string, create = false) => {
    const normalized = normalizeProjectPath(path);
    return {
      directory: await reader.directory(projectDirectory(normalized), create),
      name: normalized.slice(normalized.lastIndexOf('/') + 1),
    };
  };
  const write = async (path: string, contents: string | Uint8Array) => {
    const {directory, name} = await parent(path, true);
    const handle = await directory.getFileHandle(name, {create: true});
    const stream = await handle.createWritable();
    try {
      await stream.write(
        typeof contents === 'string'
          ? contents
          : new Blob([new Uint8Array(contents)]),
      );
      await stream.close();
    } catch (error) {
      await stream.abort();
      throw error;
    }
  };
  const list = async (path: string) => {
    const directory = (await reader.directory(path)) as IterableDirectory;
    const entries = [];
    for await (const entry of directory.values()) {
      entries.push({
        name: entry.name,
        isDirectory: () => entry.kind === 'directory',
        isFile: () => entry.kind === 'file',
      });
    }
    return entries;
  };
  const copy = async (from: string, to: string): Promise<void> => {
    const info = await reader.stat(from);
    if (!info) throw new Error(`Project file not found: ${from}`);
    if (info.kind === 'directory') {
      await reader.directory(to, true);
      for (const entry of await list(from))
        await copy(joinPath(from, entry.name), joinPath(to, entry.name));
    } else {
      const bytes = await reader.readFile(from);
      if (!bytes) throw new Error(`Project file not found: ${from}`);
      await write(to, bytes);
    }
  };
  return {
    mkdir: path => reader.directory(path, true),
    async readFile(path) {
      const bytes = await reader.readFile(path);
      if (!bytes) throw new Error(`Project file not found: ${path}`);
      return decodeProjectFile(bytes);
    },
    readdir: list,
    async rename(from, to) {
      if (await reader.stat(to))
        throw new Error(`Project destination already exists: ${to}`);
      try {
        await copy(from, to);
      } catch (error) {
        try {
          if (await reader.stat(to)) {
            const {directory, name} = await parent(to);
            await directory.removeEntry(name, {recursive: true});
          }
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            `Move failed. An incomplete copy remains at ${to}.`,
          );
        }
        throw error;
      }
      const {directory, name} = await parent(from);
      await directory.removeEntry(name, {recursive: true});
    },
    async rm(path, options) {
      if (options.force && !(await reader.stat(path))) return;
      const {directory, name} = await parent(path);
      await directory.removeEntry(name, {recursive: options.recursive});
    },
    stat: path => reader.stat(path),
    writeFile: write,
  };
}
