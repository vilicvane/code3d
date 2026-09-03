import {configureSingle, fs} from '@zenfs/core';
import {IndexedDB} from '@zenfs/dom';
import {
  isSourceFile,
  normalizeProjectPath,
  projectDirectory,
  type ModelProject,
} from './project';

const projectRoot = '/workspace';
const manifestPath = '/code3d-project.json';
const storeName = 'code3d-project-v1';

type ProjectManifest = Readonly<{
  version: 1;
  entryPath: string;
}>;

export interface ProjectFileSystem {
  load(): Promise<ModelProject | undefined>;
  replace(project: ModelProject): Promise<ModelProject>;
  writeFile(path: string, source: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

let configurePromise: Promise<void> | undefined;

export async function openBrowserProjectFileSystem(): Promise<ProjectFileSystem> {
  configurePromise ??= configureSingle({backend: IndexedDB, storeName});
  await configurePromise;
  return new ZenProjectFileSystem();
}

class ZenProjectFileSystem implements ProjectFileSystem {
  async load(): Promise<ModelProject | undefined> {
    const manifest = await readManifest();
    if (!manifest || !(await exists(projectRoot))) {
      return undefined;
    }
    const files = await readSourceTree(projectRoot);
    if (files.length === 0) {
      return undefined;
    }
    return {
      entryPath: normalizeProjectPath(manifest.entryPath),
      files: files.sort((left, right) => left.path.localeCompare(right.path)),
    };
  }

  async replace(project: ModelProject): Promise<ModelProject> {
    if (await exists(projectRoot)) {
      await fs.promises.rm(projectRoot, {recursive: true, force: true});
    }
    await fs.promises.mkdir(projectRoot, {recursive: true});
    for (const file of project.files) {
      await this.writeFile(file.path, file.source);
    }
    const manifest: ProjectManifest = {
      version: 1,
      entryPath: normalizeProjectPath(project.entryPath),
    };
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    return (await this.load())!;
  }

  async writeFile(path: string, source: string): Promise<void> {
    const normalized = normalizeProjectPath(path);
    const diskPath = toDiskPath(normalized);
    await fs.promises.mkdir(projectDirectory(diskPath), {recursive: true});
    await fs.promises.writeFile(diskPath, source, 'utf8');
  }

  async createDirectory(path: string): Promise<void> {
    await fs.promises.mkdir(toDiskPath(normalizeProjectPath(path)), {
      recursive: true,
    });
  }

  async rename(from: string, to: string): Promise<void> {
    const destination = toDiskPath(normalizeProjectPath(to));
    await fs.promises.mkdir(projectDirectory(destination), {recursive: true});
    await fs.promises.rename(
      toDiskPath(normalizeProjectPath(from)),
      destination,
    );
  }

  async remove(path: string): Promise<void> {
    await fs.promises.rm(toDiskPath(normalizeProjectPath(path)), {
      recursive: true,
      force: false,
    });
  }
}

async function readManifest(): Promise<ProjectManifest | undefined> {
  if (!(await exists(manifestPath))) {
    return undefined;
  }
  const value = JSON.parse(
    await fs.promises.readFile(manifestPath, 'utf8'),
  ) as Partial<ProjectManifest>;
  return value.version === 1 && typeof value.entryPath === 'string'
    ? {
        version: 1,
        entryPath: value.entryPath,
      }
    : undefined;
}

async function readSourceTree(
  directory: string,
): Promise<Array<{path: string; source: string}>> {
  const entries = await fs.promises.readdir(directory, {withFileTypes: true});
  const files: Array<{path: string; source: string}> = [];
  for (const entry of entries) {
    const diskPath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await readSourceTree(diskPath)));
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      files.push({
        path: fromDiskPath(diskPath),
        source: await fs.promises.readFile(diskPath, 'utf8'),
      });
    }
  }
  return files;
}

async function exists(path: string): Promise<boolean> {
  return (await fs.promises.stat(path, {throwIfNoEntry: false})) !== undefined;
}

function toDiskPath(path: string): string {
  return path === '/' ? projectRoot : `${projectRoot}${path}`;
}

function fromDiskPath(path: string): string {
  return normalizeProjectPath(path.slice(projectRoot.length));
}
