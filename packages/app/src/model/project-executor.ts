import type {
  ModelGeometrySnapshot,
  SketchSnapshot,
  TopologyInspection,
  TopologyInspectionOptions,
} from '@code3d/core/tooling';
import type {ExecutionSettings} from '../app-settings';
import type {ArtifactStoreConnection} from './artifact-store';
import type {CompilationProgress} from './compilation-progress';
import type {ModelExecutionConfig, ModelModule} from './compiler';
import {ModelDiagnosticError, diagnosticFromError} from './diagnostic';
import {createModelExecutor} from './executor';
import type {InspectSelection} from './inspection';
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
  previewSketchConstraintEdit,
  type SketchConstraintEdit,
  type SketchConstraintEditPreview,
  type SketchDrag,
  type SketchDragPreview,
} from './sketch-drag';
import {SnapshotWorkerPool, type SnapshotPoolOptions} from './snapshot-pool';

/** Native geometry and dependency instances live only on this side of the artifact boundary. */
export class ProjectExecutor {
  private runtime?: ProjectRuntime;
  private executionIdentity?: string;
  private executor?: ReturnType<typeof createModelExecutor>;
  private geometry?: ModelGeometrySnapshot;
  private inspectionGeometry?: ModelGeometrySnapshot;
  private snapshotPool?: SnapshotWorkerPool;
  constructor(
    private readonly evaluator = new ModuleEvaluator(),
    private readonly snapshotOptions?: SnapshotPoolOptions,
    private readonly storage?: ArtifactStoreConnection,
  ) {}

  async execute(
    artifact: ProjectBuildArtifact,
    onProgress?: CompilationProgress,
    checkCancelled: () => void = () => {},
    settings?: ExecutionSettings,
    execution: ModelExecutionConfig = {},
  ): Promise<ModelModule> {
    try {
      await this.storage?.ready;
      checkCancelled();
      this.disposeGeometry();
      if (
        this.executionIdentity !== artifact.dependencies.executionIdentity ||
        this.runtime?.failedImport
      ) {
        this.disposeRuntime();
        onProgress?.('initializing-runtime');
        this.runtime = await ProjectRuntime.create(
          artifact.dependencies,
          this.evaluator,
        );
        this.executor = createModelExecutor(
          this.runtime.tooling,
          this.evaluator,
        );
        this.snapshotPool = new SnapshotWorkerPool(
          this.runtime.tooling,
          this.runtime.snapshotRuntime,
          this.snapshotOptions,
        );
        this.executionIdentity = artifact.dependencies.executionIdentity;
      }
      const runtime = this.runtime!;
      if (settings) {
        runtime.tooling.setKernelCacheBudget(settings.memoryCacheBytes);
        runtime.tooling.setKernelCachePersistenceThreshold(
          settings.cachePersistenceThresholdMs,
        );
        this.snapshotPool!.setConcurrency(settings.snapshotConcurrency);
      }
      runtime.resources.install(artifact.resources);
      runtime.resources.begin(this.storage?.scope('resources'), checkCancelled);
      runtime.tooling.setKernelArtifactStore(
        this.storage?.scope(runtime.artifactIdentity),
      );
    } catch (error) {
      const diagnostic = diagnosticFromError(error, 'module');
      throw new ModelDiagnosticError({
        ...diagnostic,
        sourceRef: diagnostic.sourceRef ?? artifact.runtimeSourceRef,
      });
    }
    const runtime = this.runtime!;
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
        execution,
      );
    } finally {
      await runtime.resources.finish();
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
      {
        shapes: new Map([
          ...this.geometry.shapes,
          ...(this.inspectionGeometry?.shapes ?? []),
        ]),
      },
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

  previewSketchConstraintEdit(
    layers: readonly SketchSnapshot[],
    edit: SketchConstraintEdit,
  ): SketchConstraintEditPreview {
    if (!this.runtime) throw new Error('The sketch runtime is not ready.');
    return previewSketchConstraintEdit(this.runtime.tooling, layers, edit);
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
    return (
      this.inspectionGeometry?.shapes.has(nodeId)
        ? this.inspectionGeometry
        : this.geometry
    ).inspect(nodeId, options);
  }

  async inspect(
    selection: InspectSelection,
    checkCancelled: () => void = () => {},
  ) {
    if (!this.runtime || !this.executor) return;
    this.runtime.resources.begin(
      this.storage?.scope('resources'),
      checkCancelled,
    );
    this.runtime.tooling.setKernelArtifactStore(
      this.storage?.scope(this.runtime.artifactIdentity),
    );
    let nextGeometry: ModelGeometrySnapshot | undefined;
    try {
      const scene = await this.executor.inspect(
        selection,
        objects =>
          this.snapshotPool!.compute(
            this.runtime!.tooling.planModelSnapshotQueries(objects),
            checkCancelled,
          ),
        checkCancelled,
        objects => {
          nextGeometry = this.runtime!.tooling.retainModelGeometry(objects);
        },
      );
      checkCancelled();
      if (scene !== undefined) {
        this.inspectionGeometry?.dispose();
        this.inspectionGeometry = nextGeometry;
        nextGeometry = undefined;
      }
      return scene;
    } catch (error) {
      checkCancelled();
      const diagnostic = diagnosticFromError(
        error,
        'inspect',
        this.runtime.tooling.describeOpenCascadeException,
      );
      throw new ModelDiagnosticError({
        ...diagnostic,
        sourceRef: diagnostic.sourceRef ?? {
          file: selection.file,
          start: selection.offset,
          end: selection.offset + 1,
        },
      });
    } finally {
      await this.runtime.resources.finish();
      nextGeometry?.dispose();
      this.runtime.tooling.setKernelArtifactStore(undefined);
    }
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
      resources: this.runtime?.resources.cacheStats,
    };
  }
  private disposeRuntime(): void {
    this.executor?.dispose();
    this.disposeGeometry();
    this.snapshotPool?.dispose();
    this.snapshotPool = undefined;
    this.runtime?.dispose();
    this.runtime = undefined;
    this.executionIdentity = undefined;
    this.executor = undefined;
  }
  private disposeGeometry(): void {
    this.inspectionGeometry?.dispose();
    this.inspectionGeometry = undefined;
    this.geometry?.dispose();
    this.geometry = undefined;
  }
}
