import ts from '@typescript/typescript6';
import es5Library from '@typescript/old/lib/lib.es5.d.ts?raw';
import {
  decodeProjectFile,
  statProjectFiles,
  type ProjectFileReader,
} from './file-reader';
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
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  customConditions: ['browser'],
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

async function readAll(reads: readonly Promise<unknown>[]): Promise<void> {
  // Settle shared cache writes before a failed load allows the next revision.
  const results = await Promise.allSettled(reads);
  for (const result of results)
    if (result.status === 'rejected') throw result.reason;
}

/** Retain TypeScript's parsed dependency closure between model revisions. */
export class ProjectLanguageLoader {
  private readonly sources = new Map<string, string | undefined>();
  private readonly filePresence = new Map<string, boolean>();
  private readonly realPaths = new Map<string, string>();
  private readonly sourceFiles = new Map<string, ts.SourceFile>();
  private localPaths = new Set<string>();
  private metadataOverlays = new Map<string, string>();
  private readonly navigation = new Map<string, Set<string>>();
  private program?: ts.Program;
  private options?: ts.CompilerOptions;
  private directory?: string;

  constructor(private readonly reader: ProjectFileReader) {}

  get typeScriptProgram(): ts.Program {
    return this.program!;
  }

  reset(): void {
    this.sources.clear();
    this.filePresence.clear();
    this.realPaths.clear();
    this.sourceFiles.clear();
    this.localPaths.clear();
    this.metadataOverlays.clear();
    this.navigation.clear();
    this.program = undefined;
    this.options = undefined;
    this.directory = undefined;
  }

  invalidate(changed: ReadonlySet<string>): void {
    const paths = new Set(changed);
    for (const [path, realPath] of this.realPaths) {
      if (changed.has(path) || changed.has(realPath)) {
        paths.add(path);
        paths.add(realPath);
        this.realPaths.delete(path);
      }
    }
    for (const path of paths) {
      // Current editor contents replace these directly in load().
      if (
        this.localPaths.has(path) ||
        (!this.sources.has(path) && !this.filePresence.has(path))
      )
        continue;
      this.sources.delete(path);
      this.filePresence.delete(path);
      this.sourceFiles.delete(path);
      if (path.endsWith('.json')) this.sourceFiles.clear();
      // Previously failed resolutions must also notice newly created files.
      this.program = undefined;
      this.options = undefined;
      this.navigation.clear();
    }
  }

  async load(
    project: ModelProject,
    availablePackages: readonly string[] = [],
    rootPath = '/model.ts',
    onPrepare?: () => void,
  ): Promise<ProjectLanguage> {
    const reader = this.reader;
    const {directory} = await findPackageScope(reader, rootPath);
    if (directory !== this.directory) {
      this.reset();
      this.directory = directory;
    }
    const {sources, realPaths, sourceFiles} = this;
    // Configs can also arrive as unsaved editor overlays.
    const metadataOverlays = new Map(
      project.files
        .filter(file => !isSourceFile(file.path))
        .map(file => [normalizeProjectPath(file.path), file.source]),
    );
    this.invalidate(
      new Set(
        [
          ...new Set([
            ...this.metadataOverlays.keys(),
            ...metadataOverlays.keys(),
          ]),
        ].filter(
          path =>
            this.metadataOverlays.get(path) !== metadataOverlays.get(path),
        ),
      ),
    );
    this.metadataOverlays = metadataOverlays;
    let preparing = false;
    const prepare = () => {
      if (preparing) return;
      preparing = true;
      onPrepare?.();
    };
    if (!this.program) prepare();
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
    const toolingPath = normalizeProjectPath(
      directory + '/.__code3d-tooling.ts',
    );
    const metadataPath = normalizeProjectPath(directory + '/package.json');
    const configPath = normalizeProjectPath(directory + '/tsconfig.json');
    const localPaths = new Set(
      localFiles.map(file => normalizeProjectPath(file.path)),
    );
    for (const path of this.localPaths) {
      if (!localPaths.has(path)) {
        sources.delete(path);
        this.filePresence.delete(path);
        sourceFiles.delete(path);
        this.program = undefined;
      }
    }
    for (const file of localFiles) {
      const path = normalizeProjectPath(file.path);
      if (sources.get(path) !== file.source) sourceFiles.delete(path);
      sources.set(path, file.source);
    }
    this.localPaths = localPaths;
    sources.set(toolingPath, 'import type {} from "@code3d/core/tooling";');
    sources.set('/lib.es5.d.ts', es5Library);
    const pending = new Set<string>();
    const pendingPresence = new Set<string>();
    const read = (path: string): string | undefined => {
      path = normalizeProjectPath(path);
      if (!sources.has(path)) pending.add(path);
      return sources.get(path);
    };
    const host: ts.CompilerHost = {
      fileExists: path => {
        path = normalizeProjectPath(path);
        if (sources.has(path)) return sources.get(path) !== undefined;
        const present = this.filePresence.get(path);
        if (present !== undefined) return present;
        pendingPresence.add(path);
        return false;
      },
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
    const roots = [...localPaths, toolingPath, '/lib.es5.d.ts'];
    // Metadata is needed even for a project which currently contains no imports.
    read(metadataPath);
    read(configPath);
    let options = this.options ?? projectCompilerOptions;
    let program: ts.Program;
    for (;;) {
      if (pending.size || pendingPresence.size) {
        prepare();
        const requests = [...pending];
        const presenceRequests = [...pendingPresence].filter(
          path => !pending.has(path),
        );
        pending.clear();
        pendingPresence.clear();
        // Discovery may have resolved a prior miss; do not reuse its resolution.
        this.program = undefined;
        await readAll([
          statProjectFiles(reader, presenceRequests).then(infos => {
            for (const [index, path] of presenceRequests.entries())
              this.filePresence.set(path, infos[index]?.kind === 'file');
          }),
          ...requests.map(async path => {
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
            this.filePresence.set(path, bytes !== undefined);
          }),
        ]);
      }
      const configSource = sources.get(configPath);
      if (configSource && !this.options) {
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
          // Model execution always uses esbuild's browser ESM bundle.
          module: projectCompilerOptions.module,
          moduleResolution: projectCompilerOptions.moduleResolution,
          customConditions: projectCompilerOptions.customConditions,
          noEmit: true,
        };
      }
      program = ts.createProgram({
        rootNames: roots,
        options,
        host,
        oldProgram: this.program,
      });
      if (!pending.size && !pendingPresence.size) break;
    }
    this.options = options;
    this.program = program;
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
    const readNavigation = async (path: string) => {
      if (!sources.has(path)) {
        prepare();
        const bytes = await reader.readFile(path);
        sources.set(
          path,
          bytes === undefined ? undefined : decodeProjectFile(bytes),
        );
      }
      return sources.get(path);
    };
    await readAll(
      [...reachable].map(async path => {
        const source = sources.get(path);
        if (!source || !/\.d\.[cm]?ts$/.test(path)) return;
        let navigation = this.navigation.get(path);
        if (!navigation) {
          navigation = new Set<string>();
          const mapping = /\/\/# sourceMappingURL=(.+)/
            .exec(source)?.[1]
            .trim();
          if (mapping && !/^(?:https?:|data:)/.test(mapping)) {
            const mapPath = normalizeProjectPath(
              projectDirectory(path) + '/' + mapping,
            );
            const mapSource = await readNavigation(mapPath);
            if (mapSource) {
              const map = JSON.parse(mapSource) as {
                sources: string[];
                sourceRoot?: string;
                sourcesContent?: (string | null)[];
              };
              navigation.add(mapPath);
              await readAll(
                map.sources.map(async (file, index) => {
                  const sourcePath = normalizeProjectPath(
                    projectDirectory(mapPath) +
                      '/' +
                      (map.sourceRoot ?? '') +
                      '/' +
                      file,
                  );
                  const contents =
                    map.sourcesContent?.[index] ??
                    (await readNavigation(sourcePath));
                  if (contents !== undefined) {
                    sources.set(sourcePath, contents);
                    navigation!.add(sourcePath);
                  }
                }),
              );
            }
          }
          this.navigation.set(path, navigation);
        }
        navigation.forEach(path => navigationFiles.add(path));
      }),
    );
    return {
      rootPaths: localFiles.map(file => normalizeProjectPath(file.path)),
      realPaths: Object.fromEntries(realPaths),
      files: [...sources].flatMap(([path, source]) =>
        source !== undefined &&
        path !== '/lib.es5.d.ts' &&
        path !== toolingPath &&
        (reachable.has(path) ||
          reachable.has(realPaths.get(path) ?? '') ||
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
}
