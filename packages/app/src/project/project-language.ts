import ts from '@typescript/typescript6';
import {decodeProjectFile, type ProjectFileReader} from './file-reader';
import {findPackageScope} from './package-manifest';
import {TypeScriptFiles, settleReads} from './typescript-files';
import type {ProjectAutoImports} from './project-auto-imports';
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
  verbatimModuleSyntax: true,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  allowJs: true,
};

export type ProjectLanguage = Readonly<{
  files: readonly ProjectSourceFile[];
  navigationFiles: readonly ProjectSourceFile[];
  /** Compiler-injected imports, kept out of user files and navigation snapshots. */
  toolingFile?: ProjectSourceFile;
  /** Package exports indexed separately, without adding globals to the model program. */
  autoImports?: ProjectAutoImports;
  compilerOptions: ts.CompilerOptions;
  packageSpecifiers: readonly string[];
  realPaths?: Readonly<Record<string, string>>;
  rootPaths: readonly string[];
}>;

/** Retain TypeScript's parsed dependency closure between model revisions. */
export class ProjectLanguageLoader {
  private files: TypeScriptFiles;
  private localPaths = new Set<string>();
  private metadataOverlays = new Map<string, string>();
  private readonly navigation = new Map<string, Set<string>>();
  private program?: ts.Program;
  private options?: ts.CompilerOptions;
  private directory?: string;

  constructor(private readonly reader: ProjectFileReader) {
    this.files = new TypeScriptFiles(reader);
  }

  get typeScriptProgram(): ts.Program {
    return this.program!;
  }

  reset(): void {
    this.files = new TypeScriptFiles(this.reader);
    this.localPaths.clear();
    this.metadataOverlays.clear();
    this.navigation.clear();
    this.program = undefined;
    this.options = undefined;
    this.directory = undefined;
  }

  invalidate(changed: ReadonlySet<string>): void {
    // Editor source overlays are replaced directly in load().
    if (
      this.files.invalidate(
        new Set([...changed].filter(path => !this.localPaths.has(path))),
      )
    ) {
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
    const {sources, realPaths, host, read} = this.files;
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
        this.files.invalidate(new Set([path]));
        this.program = undefined;
      }
    }
    for (const file of localFiles)
      this.files.set(normalizeProjectPath(file.path), file.source);
    this.localPaths = localPaths;
    this.files.set(toolingPath, 'import type {} from "@code3d/core/tooling";');
    const roots = [...localPaths, toolingPath, '/lib.es5.d.ts'];
    // Metadata is needed even for a project which currently contains no imports.
    read(metadataPath);
    read(configPath);
    let options = this.options ?? projectCompilerOptions;
    let program: ts.Program;
    let packageSpecifiers: string[];
    for (;;) {
      if (this.files.needsRead) {
        prepare();
        // A newly discovered file may resolve a previous miss.
        this.program = undefined;
        await this.files.readPending();
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
      const metadata = sources.get(metadataPath);
      const packageJson = metadata
        ? ts.parseConfigFileTextToJson(metadataPath, metadata).config
        : {};
      packageSpecifiers = [
        ...new Set([
          ...availablePackages,
          ...Object.keys({
            ...packageJson?.dependencies,
            ...packageJson?.devDependencies,
            ...packageJson?.peerDependencies,
            ...packageJson?.optionalDependencies,
          }),
        ]),
      ];
      program = ts.createProgram({
        rootNames: roots,
        options,
        host,
        oldProgram: this.program,
      });
      if (!this.files.needsRead) break;
    }
    this.options = options;
    this.program = program;
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
        this.files.set(
          path,
          bytes === undefined ? undefined : decodeProjectFile(bytes),
        );
      }
      return sources.get(path);
    };
    await settleReads(
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
              await settleReads(
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
                    this.files.set(sourcePath, contents);
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
      rootPaths: [...localPaths],
      toolingFile: {path: toolingPath, source: sources.get(toolingPath)!},
      realPaths: Object.fromEntries(realPaths),
      navigationFiles: [...navigationFiles].flatMap(path => {
        const source = sources.get(path);
        return source !== undefined &&
          !reachable.has(path) &&
          !reachable.has(realPaths.get(path) ?? '')
          ? [{path, source}]
          : [];
      }),
      files: [...sources].flatMap(([path, source]) =>
        source !== undefined &&
        path !== '/lib.es5.d.ts' &&
        path !== toolingPath &&
        (reachable.has(path) ||
          reachable.has(realPaths.get(path) ?? '') ||
          path.endsWith('.json')) &&
        !projectPaths.has(path)
          ? [{path, source}]
          : [],
      ),
      compilerOptions: options,
      packageSpecifiers,
    };
  }
}
