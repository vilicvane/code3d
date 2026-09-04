import {
  bindContext,
  configureSingle,
  fs,
  resolveMountConfig,
} from '@zenfs/core';
import {IndexedDB, WebAccess} from '@zenfs/dom';
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

type ProjectFileOperations = Pick<
  typeof fs.promises,
  'mkdir' | 'readFile' | 'readdir' | 'rename' | 'rm' | 'stat' | 'writeFile'
>;

export interface ProjectFileSystem {
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
  return new ZenProjectFileSystem(
    fs.promises,
    browserProjectRoot,
    browserManifestPath,
  );
}

export async function openDirectoryProjectFileSystem(
  handle: FileSystemDirectoryHandle,
): Promise<ProjectFileSystem> {
  await configureBrowserFileSystem();
  const fileSystem = await resolveMountConfig({backend: WebAccess, handle});
  const context = bindContext({mounts: {'/': fileSystem}});
  return new ZenProjectFileSystem(
    context.fs.promises,
    directoryProjectRoot,
    directoryManifestPath,
  );
}

async function configureBrowserFileSystem(): Promise<void> {
  configureBrowserPromise ??= configureSingle({
    backend: IndexedDB,
    storeName: browserStoreName,
  });
  await configureBrowserPromise;
}

class ZenProjectFileSystem implements ProjectFileSystem {
  constructor(
    private readonly files: ProjectFileOperations,
    private readonly projectRoot: string,
    private readonly manifestPath: string,
  ) {}

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
