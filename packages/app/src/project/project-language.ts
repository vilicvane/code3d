import ts from '@typescript/typescript6';
import es5Library from '@typescript/old/lib/lib.es5.d.ts?raw';
import {decodeProjectFile, type ProjectFileReader} from './file-reader';
import {findPackageScope} from './package-manifest';
import {
  normalizeProjectPath,
  projectDirectory,
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
  realPaths?: Readonly<Record<string, string>>;
  rootPaths?: readonly string[];
}>;

/** TypeScript's own NodeNext resolver requests its declaration closure lazily. */
export async function loadProjectLanguage(
  reader: ProjectFileReader,
  project: ModelProject,
  availablePackages: readonly string[] = [],
  rootPath = '/model.ts',
): Promise<ProjectLanguage> {
  const {directory} = await findPackageScope(reader, rootPath);
  const localFiles = (
    await Promise.all(
      project.files
        .filter(file => isSourceFile(file.path))
        .map(async file =>
          (await findPackageScope(reader, file.path)).directory === directory
            ? file
            : undefined,
        ),
    )
  ).filter((file): file is ProjectSourceFile => file !== undefined);
  const toolingPath = normalizeProjectPath(directory + '/.__code3d-tooling.ts');
  const metadataPath = normalizeProjectPath(directory + '/package.json');
  const configPath = normalizeProjectPath(directory + '/tsconfig.json');
  const sources = new Map<string, string | undefined>(
    localFiles.map(file => [normalizeProjectPath(file.path), file.source]),
  );
  sources.set(toolingPath, 'import type {} from "@code3d/core/tooling";');
  sources.set('/lib.es5.d.ts', es5Library);
  const pending = new Set<string>();
  const realPaths = new Map<string, string>();
  const sourceFiles = new Map<string, ts.SourceFile>();
  const read = (path: string): string | undefined => {
    path = normalizeProjectPath(path);
    if (!sources.has(path)) pending.add(path);
    return sources.get(path);
  };
  const host: ts.CompilerHost = {
    fileExists: path => read(path) !== undefined,
    realpath: path => realPaths.get(path) ?? path,
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
  read(metadataPath);
  read(configPath);
  let options = projectCompilerOptions;
  let program: ts.Program;
  for (;;) {
    if (pending.size) {
      const requests = [...pending];
      pending.clear();
      await Promise.all(
        requests.map(async path => {
          const [bytes, info] = await Promise.all([
            reader.readFile(path),
            reader.stat(path),
          ]);
          if (info?.realPath && bytes) {
            realPaths.set(path, info.realPath);
            sources.set(info.realPath, decodeProjectFile(bytes));
          }
          sources.set(
            path,
            bytes === undefined ? undefined : decodeProjectFile(bytes),
          );
        }),
      );
    }
    const configSource = sources.get(configPath);
    if (configSource) {
      const config = ts.parseConfigFileTextToJson(configPath, configSource);
      const parsed = ts.parseJsonConfigFileContent(
        config.config ?? {},
        {
          useCaseSensitiveFileNames: true,
          fileExists: host.fileExists,
          readFile: read,
          readDirectory: () =>
            project.files.map(file => normalizeProjectPath(file.path)),
        },
        directory,
        undefined,
        configPath,
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
  const metadata = sources.get(metadataPath);
  const packageJson = metadata
    ? ts.parseConfigFileTextToJson(metadataPath, metadata).config
    : {};
  const projectPaths = new Set(
    project.files
      .filter(file => isSourceFile(file.path))
      .map(file => normalizeProjectPath(file.path)),
  );
  const reachable = new Set(
    program.getSourceFiles().map(file => file.fileName),
  );
  const navigationFiles = new Set<string>();
  for (const [path, source] of [...sources]) {
    if (!source || !/\.d\.[cm]?ts$/.test(path)) continue;
    const mapping = /\/\/# sourceMappingURL=(.+)/.exec(source)?.[1].trim();
    if (!mapping || /^(?:https?:|data:)/.test(mapping)) continue;
    const mapPath = normalizeProjectPath(
      projectDirectory(path) + '/' + mapping,
    );
    const bytes = await reader.readFile(mapPath);
    if (!bytes) continue;
    const mapSource = decodeProjectFile(bytes);
    const map = JSON.parse(mapSource) as {
      sources: string[];
      sourceRoot?: string;
      sourcesContent?: (string | null)[];
    };
    sources.set(mapPath, mapSource);
    navigationFiles.add(mapPath);
    for (const [index, file] of map.sources.entries()) {
      const sourcePath = normalizeProjectPath(
        projectDirectory(mapPath) + '/' + (map.sourceRoot ?? '') + '/' + file,
      );
      const contents =
        map.sourcesContent?.[index] ??
        (await reader
          .readFile(sourcePath)
          .then(bytes => (bytes ? decodeProjectFile(bytes) : undefined)));
      if (contents !== undefined) {
        sources.set(sourcePath, contents ?? undefined);
        navigationFiles.add(sourcePath);
      }
    }
  }
  return {
    rootPaths: localFiles.map(file => normalizeProjectPath(file.path)),
    realPaths: Object.fromEntries(realPaths),
    files: [...sources].flatMap(([path, source]) =>
      source !== undefined &&
      path !== '/lib.es5.d.ts' &&
      path !== toolingPath &&
      (reachable.has(path) ||
        realPaths.has(path) ||
        navigationFiles.has(path) ||
        path.endsWith('.json')) &&
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
