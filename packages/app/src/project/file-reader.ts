import {normalizeProjectPath, type ModelProject} from './project';

export type ProjectFileInfo = Readonly<{
  kind: 'file' | 'directory';
  version: string;
  size?: number;
  realPath?: string;
}>;

/** Paths are rooted in the selected project, never in the host filesystem. */
export interface ProjectFileReader {
  readFile(path: string): Promise<Uint8Array | undefined>;
  stat(path: string): Promise<ProjectFileInfo | undefined>;
}

export const decodeProjectFile = (contents: Uint8Array): string =>
  new TextDecoder().decode(contents);

/** Unsaved editor contents take precedence over the persisted project files. */
export function overlayProjectFiles(
  reader: ProjectFileReader,
  project: ModelProject,
): ProjectFileReader {
  const sources = new Map(
    project.files.map(file => [normalizeProjectPath(file.path), file.source]),
  );
  return {
    async readFile(path) {
      const source = sources.get(normalizeProjectPath(path));
      return source === undefined
        ? reader.readFile(path)
        : new TextEncoder().encode(source);
    },
    async stat(path) {
      const source = sources.get(normalizeProjectPath(path));
      return source === undefined
        ? reader.stat(path)
        : {kind: 'file', version: source};
    },
  };
}

/** Reads only requested handles; opening a folder never indexes node_modules. */
export class DirectoryFileReader implements ProjectFileReader {
  private readonly pendingDirectories = new Map<
    string,
    Promise<FileSystemDirectoryHandle>
  >();
  private readonly pendingFiles = new Map<string, Promise<File | undefined>>();

  constructor(protected readonly root: FileSystemDirectoryHandle) {}

  directory(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    const normalized = normalizeProjectPath(path);
    if (normalized === '/') return Promise.resolve(this.root);
    const key = `${create}:${normalized}`;
    const pending = this.pendingDirectories.get(key);
    if (pending) return pending;
    const separator = normalized.lastIndexOf('/');
    const request = this.directory(normalized.slice(0, separator), create)
      .then(parent =>
        parent.getDirectoryHandle(normalized.slice(separator + 1), {create}),
      )
      .finally(() => this.pendingDirectories.delete(key));
    this.pendingDirectories.set(key, request);
    return request;
  }

  private file(path: string): Promise<File | undefined> {
    const normalized = normalizeProjectPath(path);
    const pending = this.pendingFiles.get(normalized);
    if (pending) return pending;
    const request = this.openFile(normalized).finally(() =>
      this.pendingFiles.delete(normalized),
    );
    this.pendingFiles.set(normalized, request);
    return request;
  }

  private async openFile(path: string): Promise<File | undefined> {
    const normalized = normalizeProjectPath(path);
    if (normalized === '/') return undefined;
    const separator = normalized.lastIndexOf('/');
    try {
      const directory = await this.directory(normalized.slice(0, separator));
      const handle = await directory.getFileHandle(
        normalized.slice(separator + 1),
      );
      return await handle.getFile();
    } catch (error) {
      if (isMissingHandle(error)) return undefined;
      throw error;
    }
  }

  async readFile(path: string): Promise<Uint8Array | undefined> {
    const file = await this.file(path);
    return file ? new Uint8Array(await file.arrayBuffer()) : undefined;
  }

  async stat(path: string): Promise<ProjectFileInfo | undefined> {
    if (normalizeProjectPath(path) === '/') {
      return {kind: 'directory', version: ''};
    }
    const file = await this.file(path);
    if (file)
      return {
        kind: 'file',
        version: `${file.lastModified}:${file.size}`,
        size: file.size,
      };
    try {
      await this.directory(path);
      return {kind: 'directory', version: ''};
    } catch (error) {
      if (isMissingHandle(error)) return undefined;
      throw error;
    }
  }
}

export function isMissingHandle(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')
  );
}
