import type {ProjectFileSystem} from './filesystem';
import {mapProjectIO} from './io';
import type {ProjectFileReader} from './file-reader';
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

// VS Code files.exclude defaults, including the browser-only swap file rule.
const excludedEntryNames = new Set([
  '.git',
  '.svn',
  '.hg',
  '.DS_Store',
  'Thumbs.db',
]);
const generatedDirectories = new Set(['.code3d', '.git', 'node_modules']);
export const projectTextLimit = 8 * 1024 * 1024;

export function isExcludedProjectEntry(name: string): boolean {
  return excludedEntryNames.has(name) || name.endsWith('.crswap');
}

export function isProtectedProjectPath(path: string): boolean {
  return path.split('/').some(part => generatedDirectories.has(part));
}

/** List immediate visible children without reading contents or descending. */
export async function listProjectEntries(
  fileSystem: ProjectFileSystem,
  directory: string,
): Promise<ProjectEntry[]> {
  return (await fileSystem.list(directory))
    .filter(entry => !isExcludedProjectEntry(entry.name))
    .map(entry => ({
      path: normalizeProjectPath(`${directory}/${entry.name}`),
      kind: entry.kind,
    }));
}

/** Search indexes names on demand. Canonical directory identities break npm link cycles. */
export async function searchProjectEntries(
  fileSystem: ProjectFileSystem,
  cancelled: () => boolean,
  onEntries: (entries: ProjectEntry[]) => void,
): Promise<void> {
  const visited = new Set<string>();
  let pending = ['/'];
  while (pending.length && !cancelled()) {
    const children = await mapProjectIO(pending, async directory => {
      if (cancelled()) return [];
      const info = await fileSystem.stat(directory);
      if (!info || info.kind !== 'directory') return [];
      const identity = info.realPath ?? directory;
      if (visited.has(identity)) return [];
      visited.add(identity);
      return listProjectEntries(fileSystem, directory);
    });
    if (cancelled()) return;
    const entries = children.flat();
    onEntries(entries);
    pending = entries
      .filter(entry => entry.kind === 'directory')
      .map(entry => entry.path);
  }
}

/** Copy all user files, including unopened and binary files, into an empty workspace. */
export async function copyProjectWorkspace(
  source: ProjectFileSystem,
  target: ProjectFileSystem,
): Promise<void> {
  await copyProjectFiles(source, target, '/', '/');
}

async function copyProjectFiles(
  source: ProjectFileSystem,
  target: ProjectFileSystem,
  from: string,
  to: string,
): Promise<void> {
  let pending = [{from, to}];
  while (pending.length) {
    pending = (
      await mapProjectIO(pending, async ({from, to}) => {
        const info = await source.stat(from);
        if (!info) throw new Error(`Project entry not found: ${from}`);
        if (info.kind === 'file') {
          const bytes = await source.readFile(from);
          if (!bytes) throw new Error(`Project entry not found: ${from}`);
          await target.writeFile(to, bytes);
          return [];
        }
        await target.createDirectory(to);
        return (await source.list(from))
          .filter(entry => !generatedDirectories.has(entry.name))
          .map(entry => ({
            from: normalizeProjectPath(`${from}/${entry.name}`),
            to: normalizeProjectPath(`${to}/${entry.name}`),
          }));
      })
    ).flat();
  }
}

export async function readProjectTextFile(
  fileSystem: ProjectFileReader,
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
  if (path === '/' || isProtectedProjectPath(path)) {
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

/** Copy project entries, leaving generated state and installed packages to be restored. */
export async function copyProjectEntry(
  fileSystem: ProjectFileSystem,
  from: string,
  to: string,
): Promise<void> {
  try {
    await copyProjectFiles(fileSystem, fileSystem, from, to);
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
