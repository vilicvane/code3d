import type {
  ModelGeometrySnapshot,
  SketchSnapshot,
  TopologyInspection,
  TopologyInspectionOptions,
} from '@code3d/core/tooling';
import type {ArtifactStoreConnection} from './artifact-store';
import type {CompilationProgress} from './compilation-progress';
import type {ModelModule} from './compiler';
import {ModelDiagnosticError, diagnosticFromError} from './diagnostic';
import {createModelExecutor} from './executor';
import {
  exportModel,
  type ModelExportInstance,
  type ModelExportOptions,
} from './model-export';
import {ModuleEvaluator} from './module-evaluator';
import type {ProjectBuildArtifact} from './project-compiler';
import {ProjectRuntime} from './project-runtime';
import {
  previewSketchDrag,
  type SketchDrag,
  type SketchDragPreview,
} from './sketch-drag';
import {SnapshotWorkerPool, type SnapshotPoolOptions} from './snapshot-pool';

/** Native geometry and dependency instances live only on this side of the artifact boundary. */
export class ProjectExecutor {
  private runtime?: ProjectRuntime;
  private identity?: string;
  private executor?: ReturnType<typeof createModelExecutor>;
  private geometry?: ModelGeometrySnapshot;
  private snapshotPool?: SnapshotWorkerPool;
  private resourceStats?: ProjectBuildArtifact['resourceStats'];
  constructor(
    private readonly evaluator = new ModuleEvaluator(),
    private readonly snapshotOptions?: SnapshotPoolOptions,
    private readonly storage?: ArtifactStoreConnection,
  ) {}

  async execute(
    artifact: ProjectBuildArtifact,
    onProgress?: CompilationProgress,
    checkCancelled: () => void = () => {},
  ): Promise<ModelModule> {
    await this.storage?.ready;
    checkCancelled();
    this.disposeGeometry();
    if (this.identity !== artifact.dependencies.id) {
      this.disposeRuntime();
      onProgress?.('initializing-runtime');
      this.runtime = await ProjectRuntime.create(
        artifact.dependencies,
        this.evaluator,
      ).catch(error => {
        const diagnostic = diagnosticFromError(error, 'module');
        throw new ModelDiagnosticError({
          ...diagnostic,
          sourceRef: diagnostic.sourceRef ?? artifact.runtimeSourceRef,
        });
      });
      this.identity = artifact.dependencies.id;
      this.executor = createModelExecutor(this.runtime.tooling, this.evaluator);
      this.snapshotPool = new SnapshotWorkerPool(
        this.runtime.tooling,
        this.runtime.snapshotRuntime,
        this.snapshotOptions,
      );
    }
    const runtime = this.runtime!;
    runtime.resources.install(artifact.resources);
    this.resourceStats = artifact.resourceStats;
    runtime.tooling.setKernelArtifactStore(
      this.storage?.scope(runtime.artifactIdentity),
    );
    try {
      for (const path of artifact.staticPackages) {
        checkCancelled();
        await runtime.importModule(path);
      }
      return await this.executor!.execute(
        artifact.model,
        runtime.modules,
        runtime.importModule,
        runtime.resources.url,
        onProgress,
        objects => {
          checkCancelled();
          this.geometry = runtime.tooling.retainModelGeometry(objects);
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
    const persistence = this.storage?.stats;
    const memory = this.runtime?.tooling.kernelOperationCacheStats();
    return {
      memory: memory
        ? {...memory, pendingPersistenceBytes: this.storage?.pendingBytes ?? 0}
        : undefined,
      disk: persistence?.disk,
      persistence,
      snapshots: this.snapshotPool?.stats,
      resources: this.resourceStats,
    };
  }
  private disposeRuntime(): void {
    this.disposeGeometry();
    this.snapshotPool?.dispose();
    this.snapshotPool = undefined;
    this.runtime?.dispose();
    this.runtime = undefined;
    this.identity = undefined;
    this.executor = undefined;
  }
  private disposeGeometry(): void {
    this.geometry?.dispose();
    this.geometry = undefined;
  }
}
