import type {ProjectFileSystem} from './filesystem';
import {
  normalizeProjectPath,
  projectDirectory,
  projectPathIsWithin,
} from './project';

export type ProjectEntry = Readonly<{path: string; kind: 'file' | 'directory'}>;
export type ProjectEntryOperation =
  | Readonly<{kind: 'create'; entry: ProjectEntry}>
  | Readonly<{
      kind: 'move' | 'copy';
      entries: readonly {from: string; to: string}[];
    }>
  | Readonly<{kind: 'remove'; paths: readonly string[]}>;

export const hiddenProjectDirectories = new Set([
  '.code3d',
  '.git',
  'node_modules',
]);
export const projectTextLimit = 8 * 1024 * 1024;

/** Enumerate names and explicit directories without reading file contents. */
export async function listProjectEntries(
  fileSystem: ProjectFileSystem,
): Promise<ProjectEntry[]> {
  const entries: ProjectEntry[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fileSystem.list(directory)) {
      if (
        entry.kind === 'directory' &&
        hiddenProjectDirectories.has(entry.name)
      )
        continue;
      const path = normalizeProjectPath(`${directory}/${entry.name}`);
      entries.push({path, kind: entry.kind});
      if (entry.kind === 'directory') await visit(path);
    }
  };
  await visit('/');
  return entries;
}

export async function readProjectTextFile(
  fileSystem: ProjectFileSystem,
  path: string,
): Promise<string> {
  const info = await fileSystem.stat(path);
  if (!info || info.kind !== 'file') throw new Error(`File not found: ${path}`);
  if (info.size !== undefined && info.size > projectTextLimit)
    throw new Error('The text editor supports files up to 8 MiB.');
  const bytes = await fileSystem.readFile(path);
  if (!bytes) throw new Error(`File not found: ${path}`);
  if (bytes.byteLength > projectTextLimit)
    throw new Error('The text editor supports files up to 8 MiB.');
  try {
    const source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    if (source.includes('\0')) throw new Error('Binary file');
    return source;
  } catch {
    throw new Error(
      `Cannot open ${path}: the text editor requires a UTF-8 text file.`,
    );
  }
}

export function topLevelProjectPaths(paths: readonly string[]): string[] {
  const unique = new Set(paths.map(normalizeProjectPath));
  return [...unique].filter(path => {
    for (
      let parent = projectDirectory(path);
      parent !== path;
      parent = projectDirectory(parent)
    ) {
      if (unique.has(parent)) return false;
      if (parent === '/') break;
    }
    return true;
  });
}

function assertMutablePath(path: string): void {
  if (
    path === '/' ||
    path.split('/').some(part => hiddenProjectDirectories.has(part))
  ) {
    throw new Error(`Protected project path: ${path}`);
  }
}

/** Reject all known collisions before starting a batch; never overwrite an entry. */
export async function checkProjectEntryOperation(
  fileSystem: ProjectFileSystem,
  operation: ProjectEntryOperation,
): Promise<void> {
  const sources =
    operation.kind === 'create'
      ? []
      : operation.kind === 'remove'
        ? operation.paths
        : operation.entries.map(entry => entry.from);
  const targets =
    operation.kind === 'create'
      ? [operation.entry.path]
      : operation.kind === 'remove'
        ? []
        : operation.entries.map(entry => entry.to);
  for (const path of [...sources, ...targets]) assertMutablePath(path);
  if (topLevelProjectPaths(sources).length !== sources.length)
    throw new Error('Select each file or directory only once.');
  if (topLevelProjectPaths(targets).length !== targets.length)
    throw new Error('Destination paths overlap.');
  for (const source of sources) {
    if (!(await fileSystem.stat(source)))
      throw new Error(`Project entry not found: ${source}`);
    if (
      targets.some(
        target => target !== source && projectPathIsWithin(target, source),
      )
    )
      throw new Error('A directory cannot be moved or copied into itself.');
  }
  for (const target of targets) {
    if (await fileSystem.stat(target))
      throw new Error(`Destination already exists: ${target}`);
    if ((await fileSystem.stat(projectDirectory(target)))?.kind !== 'directory')
      throw new Error(
        `Destination directory not found: ${projectDirectory(target)}`,
      );
  }
}

/** Copy bytes and empty directories. A failed copy keeps its source intact. */
export async function copyProjectEntry(
  fileSystem: ProjectFileSystem,
  from: string,
  to: string,
): Promise<void> {
  const copy = async (source: string, target: string): Promise<void> => {
    const info = await fileSystem.stat(source);
    if (!info) throw new Error(`Project entry not found: ${source}`);
    if (info.kind === 'directory') {
      await fileSystem.createDirectory(target);
      for (const entry of await fileSystem.list(source))
        await copy(`${source}/${entry.name}`, `${target}/${entry.name}`);
    } else {
      const bytes = await fileSystem.readFile(source);
      if (!bytes) throw new Error(`Project entry not found: ${source}`);
      await fileSystem.writeFile(target, bytes);
    }
  };
  try {
    await copy(from, to);
  } catch (error) {
    // Only this operation's new destination may be removed; the source stays untouched.
    try {
      if (await fileSystem.stat(to)) await fileSystem.remove(to);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Copy failed. An incomplete copy remains at ${to}.`,
      );
    }
    throw error;
  }
}
