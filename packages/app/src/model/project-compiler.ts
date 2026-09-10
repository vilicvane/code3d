import type {SourceRef} from '@code3d/core/tooling';
import ts from '@typescript/typescript6';
import type * as esbuild from 'esbuild-wasm';
import {isBuiltinPackageSpecifier} from '../project/builtin-packages';
import {ProjectFileCache} from '../project/file-cache';
import {
  decodeProjectFile,
  type ProjectFileReader,
} from '../project/file-reader';
import {patchModelPackages} from '../project/model-package-patches';
import {
  isSourceFile,
  normalizeProjectPath,
  type ModelProject,
  type ProjectSourceFile,
} from '../project/project';
import {ProjectAssets} from '../project/project-assets';
import {ProjectBuilder} from '../project/project-builder';
import {
  ProjectLanguageLoader,
  type ProjectLanguage,
} from '../project/project-language';
import {ProjectPackages} from '../project/project-packages';
import type {CompilationProgress} from './compilation-progress';
import {createModelCompiler, type DesignContext} from './compiler';
import {ModelDiagnosticError, diagnosticFromError} from './diagnostic';

import {
  googleFontSources,
  googleFontUrl,
  type KernelArtifactStore,
} from '@code3d/core/tooling';
import {projectArtifactIdentity} from './build-artifact-cache';
import type {CompiledModelSource} from './compiler';
import {DependencyBuilder, type DependencyArtifact} from './dependency-builder';

export type ProjectBuildArtifact = Readonly<{
  id: string;
  model: CompiledModelSource;
  dependencies: DependencyArtifact;
  staticPackages: readonly string[];
  resources: ReadonlyMap<string, Uint8Array>;
  language: ProjectLanguage;
  resourceStats: ProjectAssets['cacheStats'];
  runtimeSourceRef?: SourceRef;
}>;

export type ProjectExecutionArtifact = Omit<ProjectBuildArtifact, 'language'>;

/** Compilation owns source files and esbuild contexts; it never initializes a kernel. */
export class ProjectCompiler {
  private readonly files: ProjectFileCache;
  private readonly builtinFiles: ProjectFileCache;
  private readonly packages: ProjectPackages;
  private readonly assets: ProjectAssets;
  private readonly language: ProjectLanguageLoader;
  private readonly compiler = createModelCompiler();
  private readonly builder: ProjectBuilder;
  private dependencies: DependencyBuilder;
  private restoredDependencies?: DependencyArtifact;
  private dependenciesRefreshRequested = false;

  constructor(
    files: ProjectFileReader,
    builtinFiles: ProjectFileReader,
    engine: Pick<typeof esbuild, 'build' | 'context'>,
    private readonly resourceStore?: KernelArtifactStore,
  ) {
    this.files = new ProjectFileCache(patchModelPackages(files));
    this.builtinFiles = new ProjectFileCache(patchModelPackages(builtinFiles));
    this.packages = new ProjectPackages(this.files, this.builtinFiles);
    this.assets = new ProjectAssets(this.packages);
    this.language = new ProjectLanguageLoader(this.packages);
    this.builder = new ProjectBuilder(this.packages, engine, this.assets);
    this.dependencies = new DependencyBuilder(
      this.packages,
      this.builder,
      this.assets,
    );
  }

  get dependencyScope(): string {
    return JSON.stringify([
      this.packages.source,
      normalizeProjectPath(this.packages.directory + '/node_modules'),
    ]);
  }

  async compile(
    overrides: ModelProject,
    rootPath: string,
    designContext?: DesignContext,
    onLanguage?: (language: ProjectLanguage) => void,
    onProgress?: CompilationProgress,
    checkCancelled: () => void = () => {},
    restoreDependencies?: (
      scope: string,
    ) => Promise<DependencyArtifact | undefined>,
  ): Promise<ProjectBuildArtifact> {
    checkCancelled();
    const refresh = this.dependenciesRefreshRequested;
    const select = (
      path: string,
      info: import('../project/file-reader').ProjectFileInfo | undefined,
    ) =>
      !path.includes('/node_modules/') ||
      path.endsWith('/package.json') ||
      info?.kind === 'directory';
    const [changed, builtinChanged] = await Promise.all([
      this.files.refresh(select),
      this.builtinFiles.refresh(select),
    ]);
    const dependenciesChanged =
      refresh ||
      builtinChanged.size > 0 ||
      [...changed].some(path => path.includes('/node_modules/'));
    if (dependenciesChanged) {
      this.files.clear(path => path.includes('/node_modules/'));
      this.builtinFiles.clear();
    }
    const packageSelectionChanged = await this.packages.update(
      overrides,
      rootPath,
    );
    if (
      dependenciesChanged ||
      packageSelectionChanged ||
      [...changed].some(
        path =>
          path.includes('/node_modules/') ||
          /(?:^|\/)(?:package(?:-lock)?\.json|code3d-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig\.json)$/.test(
            path,
          ),
      )
    ) {
      await this.builder.dispose();
      this.dependencies = new DependencyBuilder(
        this.packages,
        this.builder,
        this.assets,
      );
      this.language.reset();
    }
    if (refresh) this.restoredDependencies = undefined;
    this.dependenciesRefreshRequested = false;
    this.language.invalidate(changed);
    // Finish applying invalidation before cancellation can consume these changes.
    checkCancelled();
    const reader = this.packages;
    await this.builder.watchDependencyMetadata([
      normalizeProjectPath(this.packages.directory + '/code3d-lock.json'),
      '/package-lock.json',
      '/npm-shrinkwrap.json',
      '/pnpm-lock.yaml',
      '/yarn.lock',
    ]);
    checkCancelled();
    const builder = this.builder;
    const root = normalizeProjectPath(rootPath);
    const entryPaths = [
      ...new Set([
        root,
        ...(designContext ? [normalizeProjectPath(designContext.file)] : []),
      ]),
    ];
    const readSource = async (path: string): Promise<ProjectSourceFile> => {
      const bytes = await reader.readFile(path);
      if (!bytes)
        throw new ModelDiagnosticError({
          kind: 'project',
          summary: `Project file not found: ${path}`,
        });
      return {path, source: decodeProjectFile(bytes)};
    };
    // Editor documents are overlays, not the set of files belonging to a run.
    // Explicit entry files also need language support when they have no editor model.
    const entries = await Promise.all(entryPaths.map(readSource));
    const runtimeSourceRef = entries.flatMap(file => {
      const source = ts.createSourceFile(
        file.path,
        file.source,
        ts.ScriptTarget.Latest,
        true,
      );
      return source.statements.flatMap(statement => {
        if (
          !ts.isImportDeclaration(statement) &&
          !ts.isExportDeclaration(statement)
        )
          return [];
        const specifier = statement.moduleSpecifier;
        return specifier &&
          ts.isStringLiteralLike(specifier) &&
          isBuiltinPackageSpecifier(specifier.text)
          ? [
              {
                file: file.path,
                start: specifier.getStart(source),
                end: specifier.end,
              },
            ]
          : [];
      });
    })[0];
    const languageProject = {
      files: [
        ...overrides.files.filter(file => !entryPaths.includes(file.path)),
        ...entries,
      ],
    };
    const language = await this.language.load(
      languageProject,
      reader.packageSpecifiers,
      rootPath,
      () => onProgress?.('preparing-project'),
    );
    checkCancelled();
    onLanguage?.(language);

    try {
      this.assets.beginCompilation(checkCancelled);
      this.assets.setStore(this.resourceStore);
      this.assets.setGoogleContext(this.language.typeScriptProgram, {
        googleFontUrl,
        googleFontSources,
      });
      if (!this.dependencies.prepared) {
        const restored = refresh
          ? undefined
          : ((await restoreDependencies?.(this.dependencyScope)) ??
            this.restoredDependencies);
        if (restored) await this.dependencies.adopt(restored);
        this.restoredDependencies = undefined;
      }
      let loading = false;
      const loadingRuntime = () => {
        if (!loading) onProgress?.('loading-runtime');
        loading = true;
      };
      if (!this.dependencies.ready) loadingRuntime();
      await this.dependencies.prepare(rootPath);
      checkCancelled();
      const discovery = await builder.build(
        entryPaths.map(path => `import ${JSON.stringify(path)};`).join('\n'),
        {
          slot: 'source-discovery',
          runtimeFiles: this.dependencies.formats,
          bundlePackages: true,
        },
      );
      const dependencies = await this.dependencies.build(
        discovery,
        loadingRuntime,
      );
      checkCancelled();
      const project: ModelProject = {
        files: await Promise.all(
          discovery.files
            .filter(
              path => !path.includes('/node_modules/') && isSourceFile(path),
            )
            .map(readSource),
        ),
      };
      onProgress?.('compiling-model');
      const model = await this.compiler.compileProject(
        project,
        root,
        builder,
        dependencies.formats,
        this.language.typeScriptProgram,
        discovery,
        designContext,
        checkCancelled,
      );
      const resources = new Map([
        ...dependencies.resources,
        ...this.assets.snapshot(),
      ]);
      const artifact = {
        model,
        dependencies,
        staticPackages: discovery.staticPackages,
        resources,
        language,
        runtimeSourceRef,
      };
      return {
        ...artifact,
        id: await projectArtifactIdentity(artifact),
        resourceStats: this.assets.cacheStats,
      };
    } catch (error) {
      checkCancelled();
      const diagnostic = diagnosticFromError(error, 'module');
      throw new ModelDiagnosticError({
        ...diagnostic,
        sourceRef: diagnostic.sourceRef ?? runtimeSourceRef,
      });
    } finally {
      await this.assets.finishCompilation();
    }
  }

  async dispose(): Promise<void> {
    await this.builder.dispose();
    this.assets.dispose();
    this.language.reset();
  }

  cancel(): Promise<void> {
    return this.builder.cancel();
  }

  restoreDependencies(artifact: DependencyArtifact): DependencyArtifact {
    return (this.restoredDependencies = this.dependencies.reuse(artifact));
  }

  refreshDependencies(): void {
    this.dependenciesRefreshRequested = true;
  }
}
