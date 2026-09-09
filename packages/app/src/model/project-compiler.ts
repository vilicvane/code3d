import type * as esbuild from 'esbuild-wasm';
import ts from '@typescript/typescript6';
import type {
  ModelGeometrySnapshot,
  SketchSnapshot,
  TopologyInspection,
  TopologyInspectionOptions,
} from '@code3d/core/tooling';
import {ProjectFileCache} from '../project/file-cache';
import type {ProjectFileReader} from '../project/file-reader';
import {ProjectPackages} from '../project/project-packages';
import {isBuiltinPackageSpecifier} from '../project/builtin-packages';
import {ProjectBuilder} from '../project/project-builder';
import {ProjectAssets} from '../project/project-assets';
import {
  loadProjectLanguage,
  type ProjectLanguage,
} from '../project/project-language';
import {normalizeProjectPath, type ModelProject} from '../project/project';
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
    this.evaluator = createEvaluator();
  }

  async compile(
    project: ModelProject,
    rootPath: string,
    designContext?: DesignContext,
    onLanguage?: (language: ProjectLanguage) => void,
    onProgress?: CompilationProgress,
    checkCancelled: () => void = () => {},
  ): Promise<ModelModule> {
    checkCancelled();
    onProgress?.('loading-project');
    this.disposeGeometry();
    const changed = await this.files.refresh();
    const packageSelectionChanged = await this.packages.update(project);
    if (
      packageSelectionChanged ||
      [...changed].some(
        path =>
          path.includes('/node_modules/') ||
          /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig\.json)$/.test(
            path,
          ),
      )
    ) {
      this.disposeRuntime();
    }
    // Finish applying invalidation before cancellation can consume these changes.
    checkCancelled();
    const reader = this.packages;
    await Promise.all(
      [
        '/package-lock.json',
        '/npm-shrinkwrap.json',
        '/pnpm-lock.yaml',
        '/yarn.lock',
      ].map(path => this.files.stat(path)),
    );
    checkCancelled();
    const builder = new ProjectBuilder(reader, this.engine, this.assets);
    const language = await loadProjectLanguage(
      reader,
      project,
      reader.packageSpecifiers,
    );
    checkCancelled();
    onLanguage?.(language);
    if (!this.runtime) {
      this.runtime = await ProjectRuntime.create(
        reader,
        builder,
        this.evaluator,
        onProgress,
      ).catch(error => {
        const diagnostic = diagnosticFromError(error, 'module');
        if (diagnostic.sourceRef) throw error;
        for (const file of project.files) {
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
      this.compiler = createModelCompiler(this.runtime.tooling, this.evaluator);
      this.snapshotPool = new SnapshotWorkerPool(
        this.runtime.tooling,
        this.runtime.snapshotRuntime,
        this.snapshotOptions,
      );
    }
    checkCancelled();
    onProgress?.('compiling-model');
    const root = normalizeProjectPath(rootPath);
    const contextFile = this.compiler!.designContextFile(
      project,
      designContext,
    );
    const runtime = this.runtime;
    return withPersistentArtifacts(
      runtime.artifactIdentity,
      async store => {
        runtime.tooling.setKernelArtifactStore(store);
        try {
          const discovery = await runtime.loadDependencies(
            builder,
            `export * from ${JSON.stringify(root)};` +
              (contextFile && contextFile !== root
                ? `\nimport ${JSON.stringify(contextFile)};`
                : ''),
          );
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
