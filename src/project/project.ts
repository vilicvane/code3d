export type ProjectSourceFile = Readonly<{
  path: string;
  source: string;
}>;

export type ModelProject = Readonly<{
  entryPath: string;
  files: readonly ProjectSourceFile[];
}>;

export function projectFile(
  project: ModelProject,
  path: string,
): ProjectSourceFile | undefined {
  const normalized = normalizeProjectPath(path);
  return project.files.find(file => file.path === normalized);
}

export function normalizeProjectPath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        throw new Error(`项目路径不能超出根目录：${path}`);
      }
      segments.pop();
      continue;
    }
    if (segment.includes('\0')) {
      throw new Error('项目路径不能包含空字符。');
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

export function projectDirectory(path: string): string {
  const normalized = normalizeProjectPath(path);
  const separator = normalized.lastIndexOf('/');
  return separator <= 0 ? '/' : normalized.slice(0, separator);
}

export function resolveProjectImport(
  importer: string,
  specifier: string,
): string {
  if (!specifier.startsWith('.')) {
    throw new Error(`不是项目相对导入：${specifier}`);
  }
  return normalizeProjectPath(`${projectDirectory(importer)}/${specifier}`);
}

export function isSourceFile(path: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/i.test(path);
}
