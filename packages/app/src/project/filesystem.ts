import {configureSingle, fs} from '@zenfs/core';
import {IndexedDB} from '@zenfs/dom';
import {
  DirectoryFileReader,
  decodeProjectFile,
  type ProjectFileReader,
} from './file-reader';
import {
  isSourceFile,
  normalizeProjectPath,
  projectDirectory,
  type ModelProject,
  type ProjectDirectoryTemplate,
  type ProjectSourceFile,
} from './project';

const browserProjectRoot = '/workspace';
const browserManifestPath = '/code3d-project.json';
const browserStoreName = 'code3d-project-v1';
const directoryProjectRoot = '/';
const directoryManifestPath = '/.code3d/project.json';
const ignoredDirectoryNames = new Set(['.code3d', '.git', 'node_modules']);

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
  writeFile(path: string, source: string, encoding: 'utf8'): Promise<unknown>;
};

export interface ProjectFileSystem extends ProjectFileReader {
  initialize(seed: ModelProject): Promise<ModelProject>;
  syncDirectory(template: ProjectDirectoryTemplate): Promise<ModelProject>;
  resetDirectory(template: ProjectDirectoryTemplate): Promise<ModelProject>;
  writeFile(path: string, source: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

let configureBrowserPromise: Promise<void> | undefined;

export async function openBrowserProjectFileSystem(): Promise<ProjectFileSystem> {
  await configureBrowserFileSystem();
  return new ProjectStore(
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
            }
          : undefined;
      },
    },
  );
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

  async initialize(seed: ModelProject): Promise<ModelProject> {
    await this.files.mkdir(this.projectRoot, {recursive: true});
    const sourceFiles = await this.readSourceTree(this.projectRoot);
    const manifest = await this.readManifest();
    if (sourceFiles.length === 0) {
      for (const file of seed.files) {
        await this.writeFile(file.path, file.source);
      }
      await this.writeManifest(manifest ?? newManifest());
      return this.load();
    }

    if (manifest) return projectFrom(sourceFiles);
    await this.writeManifest(newManifest());
    return this.load();
  }

  async syncDirectory(
    template: ProjectDirectoryTemplate,
  ): Promise<ModelProject> {
    const manifest = await this.requireManifest();
    const directory = normalizeProjectPath(template.directory);
    if (manifest.managedDirectories[directory] === template.revision) {
      return this.load();
    }
    return this.replaceDirectory(template, manifest);
  }

  async resetDirectory(
    template: ProjectDirectoryTemplate,
  ): Promise<ModelProject> {
    return this.replaceDirectory(template, await this.requireManifest());
  }

  private async replaceDirectory(
    template: ProjectDirectoryTemplate,
    manifest: ProjectManifest,
  ): Promise<ModelProject> {
    const directory = normalizeProjectPath(template.directory);
    const diskPath = this.toDiskPath(directory);
    if (await this.exists(diskPath)) {
      await this.files.rm(diskPath, {recursive: true, force: true});
    }
    for (const file of template.files) {
      await this.writeFile(file.path, file.source);
    }
    await this.writeManifest({
      ...manifest,
      managedDirectories: {
        ...manifest.managedDirectories,
        [directory]: template.revision,
      },
    });
    return this.load();
  }

  async writeFile(path: string, source: string): Promise<void> {
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

  private async load(): Promise<ModelProject> {
    await this.requireManifest();
    return projectFrom(await this.readSourceTree(this.projectRoot));
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

  private async readSourceTree(
    directory: string,
  ): Promise<ProjectSourceFile[]> {
    const entries = await this.files.readdir(directory, {withFileTypes: true});
    const sourceFiles: ProjectSourceFile[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
        continue;
      }
      const diskPath = joinPath(directory, entry.name);
      if (entry.isDirectory()) {
        sourceFiles.push(...(await this.readSourceTree(diskPath)));
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        sourceFiles.push({
          path: this.fromDiskPath(diskPath),
          source: await this.files.readFile(diskPath, 'utf8'),
        });
      }
    }
    return sourceFiles.sort((left, right) =>
      left.path.localeCompare(right.path),
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

  private fromDiskPath(path: string): string {
    return this.projectRoot === '/'
      ? normalizeProjectPath(path)
      : normalizeProjectPath(path.slice(this.projectRoot.length));
  }
}

function projectFrom(files: readonly ProjectSourceFile[]): ModelProject {
  return {files};
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
      await copy(from, to);
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
