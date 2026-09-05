import ts from '@typescript/typescript6';
import es5Library from '@typescript/old/lib/lib.es5.d.ts?raw';
import {decodeProjectFile, type ProjectFileReader} from './file-reader';
import {
  normalizeProjectPath,
  isSourceFile,
  type ModelProject,
  type ProjectSourceFile,
} from './project';

export const projectCompilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowImportingTsExtensions: true,
  rewriteRelativeImportExtensions: true,
  erasableSyntaxOnly: true,
  verbatimModuleSyntax: true,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  allowJs: true,
};

export type ProjectLanguage = Readonly<{
  files: readonly ProjectSourceFile[];
  compilerOptions: ts.CompilerOptions;
  packageSpecifiers: readonly string[];
}>;

/** TypeScript's own NodeNext resolver requests its declaration closure lazily. */
export async function loadProjectLanguage(
  reader: ProjectFileReader,
  project: ModelProject,
  availablePackages: readonly string[] = [],
): Promise<ProjectLanguage> {
  const sources = new Map<string, string | undefined>(
    project.files
      .filter(file => isSourceFile(file.path))
      .map(file => [normalizeProjectPath(file.path), file.source]),
  );
  sources.set(
    '/.__code3d-tooling.ts',
    'import type {} from "@code3d/core/tooling";',
  );
  sources.set('/lib.es5.d.ts', es5Library);
  const pending = new Set<string>();
  const sourceFiles = new Map<string, ts.SourceFile>();
  const read = (path: string): string | undefined => {
    path = normalizeProjectPath(path);
    if (!sources.has(path)) pending.add(path);
    return sources.get(path);
  };
  const host: ts.CompilerHost = {
    fileExists: path => read(path) !== undefined,
    readFile: read,
    directoryExists: () => true,
    getDirectories: () => [],
    getSourceFile(path, options) {
      const source = read(path);
      if (source === undefined) return undefined;
      let file = sourceFiles.get(path);
      if (!file) {
        file = ts.createSourceFile(path, source, options, true);
        sourceFiles.set(path, file);
      }
      return file;
    },
    getDefaultLibFileName: () => '/lib.es5.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: path => normalizeProjectPath(path),
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const roots = [...sources.keys()];
  // Metadata is needed even for a project which currently contains no imports.
  read('/package.json');
  read('/tsconfig.json');
  let options = projectCompilerOptions;
  let program: ts.Program;
  for (;;) {
    if (pending.size) {
      const requests = [...pending];
      pending.clear();
      await Promise.all(
        requests.map(async path => {
          const bytes = await reader.readFile(path);
          sources.set(
            path,
            bytes === undefined ? undefined : decodeProjectFile(bytes),
          );
        }),
      );
    }
    const configSource = sources.get('/tsconfig.json');
    if (configSource) {
      const config = ts.parseConfigFileTextToJson(
        '/tsconfig.json',
        configSource,
      );
      const parsed = ts.parseJsonConfigFileContent(
        config.config ?? {},
        {
          useCaseSensitiveFileNames: true,
          fileExists: host.fileExists,
          readFile: read,
          readDirectory: () =>
            project.files.map(file => normalizeProjectPath(file.path)),
        },
        '/',
        undefined,
        '/tsconfig.json',
      );
      options = {
        ...projectCompilerOptions,
        ...parsed.options,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
      };
    }
    program = ts.createProgram({rootNames: roots, options, host});
    if (!pending.size) break;
  }
  const metadata = sources.get('/package.json');
  const packageJson = metadata
    ? ts.parseConfigFileTextToJson('/package.json', metadata).config
    : {};
  const projectPaths = new Set(
    project.files
      .filter(file => isSourceFile(file.path))
      .map(file => normalizeProjectPath(file.path)),
  );
  const reachable = new Set(
    program.getSourceFiles().map(file => file.fileName),
  );
  return {
    files: [...sources].flatMap(([path, source]) =>
      source !== undefined &&
      path !== '/lib.es5.d.ts' &&
      path !== '/.__code3d-tooling.ts' &&
      (reachable.has(path) || path.endsWith('.json')) &&
      !projectPaths.has(path)
        ? [{path, source}]
        : [],
    ),
    compilerOptions: options,
    packageSpecifiers: [
      ...new Set([
        ...availablePackages,
        ...Object.keys({
          ...packageJson?.dependencies,
          ...packageJson?.devDependencies,
          ...packageJson?.peerDependencies,
          ...packageJson?.optionalDependencies,
        }),
      ]),
    ],
  };
}
