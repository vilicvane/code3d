import type * as esbuild from 'esbuild-wasm';
import ts from '@typescript/typescript6';
import type {
  ModelGeometrySnapshot,
  SketchSnapshot,
  TopologyInspection,
  TopologyInspectionOptions,
} from '@code3d/core/tooling';
import {ProjectFileCache} from '../project/file-cache';
import {
  decodeProjectFile,
  type ProjectFileReader,
} from '../project/file-reader';
import {ProjectPackages} from '../project/project-packages';
import {isBuiltinPackageSpecifier} from '../project/builtin-packages';
import {ProjectBuilder} from '../project/project-builder';
import {ProjectAssets} from '../project/project-assets';
import {
  ProjectLanguageLoader,
  type ProjectLanguage,
} from '../project/project-language';
import {
  isSourceFile,
  normalizeProjectPath,
  type ModelProject,
  type ProjectSourceFile,
} from '../project/project';
import {
  createModelCompiler,
  type DesignContext,
  type ModelModule,
} from './compiler';
import {ProjectRuntime} from './project-runtime';
import {SnapshotWorkerPool, type SnapshotPoolOptions} from './snapshot-pool';
import {
  withPersistentArtifacts,
  type PersistentArtifactStats,
} from './persistent-artifacts';
import {
  previewSketchDrag,
  type SketchDrag,
  type SketchDragPreview,
} from './sketch-drag';
import {ModuleEvaluator} from './module-evaluator';
import type {CompilationProgress} from './compilation-progress';
import {ModelDiagnosticError, diagnosticFromError} from './diagnostic';
import {
  exportModel,
  type ModelExportInstance,
  type ModelExportOptions,
} from './model-export';

export class ProjectCompiler {
  private readonly files: ProjectFileCache;
  private readonly packages: ProjectPackages;
  private readonly assets: ProjectAssets;
  private readonly language: ProjectLanguageLoader;
  private readonly evaluator: ModuleEvaluator;
  private runtime?: ProjectRuntime;
  private compiler?: ReturnType<typeof createModelCompiler>;
  private geometry?: ModelGeometrySnapshot;
  private snapshotPool?: SnapshotWorkerPool;
  private persistentStats?: PersistentArtifactStats;

  constructor(
    files: ProjectFileReader,
    builtinFiles: ProjectFileReader,
    private readonly engine: Pick<typeof esbuild, 'build'>,
    createEvaluator = () => new ModuleEvaluator(),
    private readonly snapshotOptions?: SnapshotPoolOptions,
  ) {
    this.files = new ProjectFileCache(files);
    this.packages = new ProjectPackages(
      this.files,
      new ProjectFileCache(builtinFiles),
    );
    this.assets = new ProjectAssets(this.packages);
    this.language = new ProjectLanguageLoader(this.packages);
    this.evaluator = createEvaluator();
  }

  async compile(
    overrides: ModelProject,
    rootPath: string,
    designContext?: DesignContext,
    onLanguage?: (language: ProjectLanguage) => void,
    onProgress?: CompilationProgress,
    checkCancelled: () => void = () => {},
  ): Promise<ModelModule> {
    checkCancelled();
    this.disposeGeometry();
    const changed = await this.files.refresh();
    const packageSelectionChanged = await this.packages.update(
      overrides,
      rootPath,
    );
    if (
      packageSelectionChanged ||
      [...changed].some(
        path =>
          path.includes('/node_modules/') ||
          /(?:^|\/)(?:package(?:-lock)?\.json|code3d-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig\.json)$/.test(
            path,
          ),
      )
    ) {
      this.disposeRuntime();
      this.language.reset();
    }
    this.language.invalidate(changed);
    this.assets.beginCompilation(checkCancelled);
    // Finish applying invalidation before cancellation can consume these changes.
    checkCancelled();
    const reader = this.packages;
    await Promise.all(
      [
        normalizeProjectPath(this.packages.directory + '/code3d-lock.json'),
        '/package-lock.json',
        '/npm-shrinkwrap.json',
        '/pnpm-lock.yaml',
        '/yarn.lock',
      ].map(path => this.files.stat(path)),
    );
    checkCancelled();
    const builder = new ProjectBuilder(reader, this.engine, this.assets);
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
    if (!this.runtime) {
      this.runtime = await ProjectRuntime.create(
        reader,
        builder,
        this.evaluator,
        onProgress,
        rootPath,
      ).catch(error => {
        const diagnostic = diagnosticFromError(error, 'module');
        if (diagnostic.sourceRef) throw error;
        for (const file of entries) {
          const parsed = ts.createSourceFile(
            file.path,
            file.source,
            ts.ScriptTarget.Latest,
            true,
          );
          for (const statement of parsed.statements) {
            if (
              !ts.isImportDeclaration(statement) &&
              !ts.isExportDeclaration(statement)
            )
              continue;
            const specifier = statement.moduleSpecifier;
            if (
              !specifier ||
              !ts.isStringLiteralLike(specifier) ||
              !isBuiltinPackageSpecifier(specifier.text)
            )
              continue;
            throw new ModelDiagnosticError({
              ...diagnostic,
              sourceRef: {
                file: file.path,
                start: specifier.getStart(parsed),
                end: specifier.getEnd(),
              },
            });
          }
        }
        throw new ModelDiagnosticError(diagnostic);
      });
      this.runtime.tooling.installModelResourceReader(url =>
        this.assets.read(url),
      );
      this.compiler = createModelCompiler(this.runtime.tooling, this.evaluator);
      this.snapshotPool = new SnapshotWorkerPool(
        this.runtime.tooling,
        this.runtime.snapshotRuntime,
        this.snapshotOptions,
      );
    }
    checkCancelled();
    onProgress?.('compiling-model');
    const runtime = this.runtime;
    this.assets.setGoogleContext(
      this.language.typeScriptProgram,
      runtime.tooling,
    );
    return withPersistentArtifacts(
      runtime.artifactIdentity,
      async (store, resources) => {
        runtime.tooling.setKernelArtifactStore(store);
        this.assets.setStore(resources);
        try {
          const discovery = await runtime.loadDependencies(
            builder,
            entryPaths
              .map(path => `import ${JSON.stringify(path)};`)
              .join('\n'),
          );
          checkCancelled();
          const project: ModelProject = {
            files: await Promise.all(
              discovery.files
                .filter(
                  path =>
                    !path.includes('/node_modules/') && isSourceFile(path),
                )
                .map(readSource),
            ),
          };
          checkCancelled();
          return await this.compiler!.compileProject(
            project,
            root,
            builder,
            runtime.modules,
            runtime.formats,
            runtime.importModule,
            language,
            discovery,
            designContext,
            () => onProgress?.('evaluating-model'),
            objects => {
              checkCancelled();
              this.geometry =
                this.runtime!.tooling.retainModelGeometry(objects);
            },
            checkCancelled,
            objects =>
              this.snapshotPool!.compute(
                runtime.tooling.planModelSnapshotQueries(objects),
                checkCancelled,
              ),
          );
        } finally {
          await this.assets.finishCompilation();
          runtime.tooling.setKernelArtifactStore(undefined);
        }
      },
      checkCancelled,
      stats => {
        this.persistentStats = stats;
      },
    );
  }

  export(
    instances: readonly ModelExportInstance[],
    options: ModelExportOptions,
  ): Blob {
    if (!this.geometry || !this.runtime)
      throw new Error(
        'The model has changed. Reopen export after compilation finishes.',
      );
    return exportModel(
      this.geometry,
      instances,
      options,
      this.runtime.replicad,
    );
  }

  previewSketchDrag(
    layers: readonly SketchSnapshot[],
    drag: SketchDrag,
  ): SketchDragPreview {
    if (!this.runtime) throw new Error('The sketch runtime is not ready.');
    return previewSketchDrag(this.runtime.tooling, layers, drag);
  }

  dispose(): void {
    this.disposeRuntime();
    this.language.reset();
    this.evaluator.dispose();
  }

  inspectTopology(
    nodeId: string,
    options: TopologyInspectionOptions,
  ): TopologyInspection {
    if (!this.geometry)
      throw new Error('The model geometry snapshot is unavailable.');
    return this.geometry.inspect(nodeId, options);
  }

  get compiledBytes(): number {
    return this.evaluator.compiledBytes;
  }

  get kernelCacheStats() {
    return {
      memory: this.runtime?.tooling.kernelOperationCacheStats(),
      disk: this.persistentStats,
      snapshots: this.snapshotPool?.stats,
      resources: this.assets.cacheStats,
    };
  }

  private disposeRuntime(): void {
    this.disposeGeometry();
    this.snapshotPool?.dispose();
    this.snapshotPool = undefined;
    this.assets.dispose();
    this.runtime?.dispose();
    this.compiler = undefined;
    this.runtime = undefined;
  }

  private disposeGeometry(): void {
    this.geometry?.dispose();
    this.geometry = undefined;
  }
}
