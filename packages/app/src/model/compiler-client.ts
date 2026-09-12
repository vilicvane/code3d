import type {
  SketchSnapshot,
  TopologyInspection,
  TopologyInspectionOptions,
} from '@code3d/core/tooling';
import {action, makeObservable, observableRef, runInAction} from 'mobx';
import {browserPackageFiles} from '../project/browser-packages';
import {statProjectFiles, type ProjectFileReader} from '../project/file-reader';
import type {ModelProject} from '../project/project';
import type {ProjectLanguage} from '../project/project-language';
import type {
  CompilationPhase,
  CompilationProgress,
} from './compilation-progress';
import type {DesignContext, ModelModule} from './compiler';
import {
  ArtifactChannel,
  type CompileRequest,
  type CompilerResponse,
  type ExecutorRequest,
  type ExecutorResponse,
  type FileRequest,
} from './compiler-protocol';
import CompilerWorker from './compiler.worker?worker';
import {ArtifactStoreHost} from './artifact-store-host';
import {ModelDiagnosticError} from './diagnostic';
import ExecutorWorker from './executor.worker?worker';
import type {ModelExportInstance, ModelExportOptions} from './model-export';
import type {ProjectBuildArtifact} from './project-compiler';
import type {SketchDrag, SketchDragPreview} from './sketch-drag';

type PendingRequest = {
  id: number;
  reject(error: Error): void;
} & (
  | {
      kind: 'compile';
      onProgress?: CompilationProgress;
      resolve(module: ModelModule): void;
    }
  | {kind: 'export'; resolve(blob: Blob): void}
  | {kind: 'topology'; resolve(topology: TopologyInspection): void}
  | {kind: 'sketch'; resolve(preview: SketchDragPreview): void}
);

type ExecuteRequest = Omit<
  Extract<ExecutorRequest, {kind: 'execute'}>,
  'artifact' | 'dependency'
> & {artifact: ProjectBuildArtifact};
type Execution = {
  request: ExecuteRequest;
  compileId: number;
  cancellationTimeout?: number;
  cached?: boolean;
  compilationError?: Error;
};

/** Independent compiler and executor lifetimes, coordinated by the newest requested source. */
export class ModelCompilerClient {
  private readonly storage = new ArtifactStoreHost();
  private compiler: Worker;
  private executor: Worker;
  private nextId = 1;
  private readonly compiledArtifacts = new ArtifactChannel();
  private readonly executionArtifacts = new ArtifactChannel();
  private preparationRevision = 0;
  private pending: PendingRequest | null = null;
  private queuedCompile?: CompileRequest;
  private runningCompile?: CompileRequest;
  private restoreCancellation?: Int32Array<SharedArrayBuffer>;
  private queuedExecution?: Execution;
  private runningExecution?: Execution;
  private exportable?: {module: ModelModule; compileId: number};
  phase: CompilationPhase | undefined;
  restored: Readonly<{rootPath: string; module: ModelModule}> | undefined;
  private lastEntry?: string;
  private compiledArtifact?: string;
  private executorDependency?: string;
  private cacheReset?: {
    promise: Promise<void>;
    finish(error?: Error): void;
  };
  private publication?: {
    rootPath: string;
    designContext?: DesignContext;
    stamp: number;
  };
  private cachedResult?: {
    requestId: number;
    executionId: number;
    artifactId: string;
    module: ModelModule;
  };

  constructor(
    private readonly files: ProjectFileReader,
    private readonly onLanguage?: (language: ProjectLanguage) => void,
    private readonly prepareProject?: (
      project: ModelProject,
      rootPath: string,
    ) => Promise<void>,
    private readonly projectIdentity?: string,
  ) {
    makeObservable<this, 'pending' | 'exportable'>(this, {
      pending: observableRef,
      exportable: observableRef,
      phase: observableRef,
      restored: observableRef,
      cancel: action,
      dispose: action,
      refreshDependencies: action,
      clearBuildCache: action,
      export: action,
      previewSketchDrag: action,
      inspectTopology: action,
    });
    this.compiler = this.createCompiler();
    this.executor = this.createExecutor();
  }

  compile(
    project: ModelProject,
    rootPath: string,
    designContext?: DesignContext,
    onProgress?: CompilationProgress,
    persist = true,
  ): Promise<ModelModule> {
    this.cancel();
    const revision = this.preparationRevision;
    return new Promise((resolve, reject) =>
      runInAction(() => {
        const id = this.nextId++;
        this.exportable = undefined;
        this.phase = undefined;
        this.restored = undefined;
        this.cachedResult = undefined;
        this.compiledArtifact = undefined;
        this.pending = {
          kind: 'compile',
          id,
          resolve,
          reject,
          onProgress,
        };
        if (this.prepareProject) {
          this.progress(id, 'loading-runtime');
          if (revision !== this.preparationRevision) return;
        }
        const entry = JSON.stringify([rootPath, designContext]);
        if (persist && this.projectIdentity && entry !== this.lastEntry) {
          this.compiler.postMessage({
            kind: 'restore',
            id,
            cancellation: (this.restoreCancellation = cancellation()),
            projectIdentity: this.projectIdentity,
            rootPath,
            designContext,
          });
        }
        this.lastEntry = entry;
        const stamp = performance.timeOrigin + performance.now();
        this.publication = persist
          ? {rootPath, designContext, stamp}
          : undefined;
        void Promise.resolve(this.prepareProject?.(project, rootPath)).then(
          () =>
            runInAction(() => {
              if (revision !== this.preparationRevision) return;
              this.queuedCompile = {
                kind: 'compile',
                id,
                project,
                rootPath,
                designContext,
                cancellation: cancellation(),
                stamp,
                projectIdentity: persist ? this.projectIdentity : undefined,
              };
              this.startCompile();
            }),
          error => runInAction(() => this.fail(id, error)),
        );
      }),
    );
  }

  isCompiling(): boolean {
    return this.pending?.kind === 'compile';
  }

  refreshDependencies(): void {
    this.cancel();
    this.compiler.postMessage({kind: 'refresh-dependencies'});
  }

  clearBuildCache(): Promise<void> {
    if (this.cacheReset) return this.cacheReset.promise;
    this.cancel();
    this.restartCompiler();
    this.restored = undefined;
    this.cachedResult = undefined;
    this.compiledArtifact = undefined;
    this.publication = undefined;
    this.exportable = undefined;
    if (!this.projectIdentity) return Promise.resolve();
    let finish!: (error?: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      finish = error => (error ? reject(error) : resolve());
    });
    this.cacheReset = {
      promise,
      finish,
    };
    this.compiler.postMessage({
      kind: 'clear-build-cache',
      projectIdentity: this.projectIdentity,
    });
    return promise;
  }

  private finishCacheReset(error?: Error): void {
    const pending = this.cacheReset;
    if (!pending) return;
    this.cacheReset = undefined;
    pending.finish(error);
  }
  canExport(module: ModelModule): boolean {
    return !this.pending && this.exportable?.module === module;
  }
  export(
    module: ModelModule,
    instances: readonly ModelExportInstance[],
    options: ModelExportOptions,
  ): Promise<Blob> {
    if (!this.canExport(module)) {
      return Promise.reject(
        new Error(
          'The model has changed or is still compiling. Reopen export when it is ready.',
        ),
      );
    }
    const compileId = this.exportable!.compileId;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = {
        kind: 'export',
        id,
        resolve,
        reject,
      };
      this.sendExecution({kind: 'export', id, compileId, instances, options});
    });
  }

  cancel(): boolean {
    if (this.restoreCancellation) Atomics.store(this.restoreCancellation, 0, 1);
    this.restoreCancellation = undefined;
    this.preparationRevision++;
    const pending = this.pending;
    this.pending = null;
    this.queuedCompile = undefined;
    this.queuedExecution = undefined;
    if (this.runningCompile) {
      Atomics.store(this.runningCompile.cancellation, 0, 1);
      this.compiler.postMessage({
        kind: 'cancel-compile',
        id: this.runningCompile.id,
      });
    }
    this.storage.cancelReads(this.compiler);
    this.cancelExecution();
    if (!pending) return false;
    this.exportable = undefined;
    pending.reject(
      new Error(
        pending.kind === 'compile'
          ? 'Compilation superseded.'
          : pending.kind === 'sketch'
            ? 'Sketch preview superseded.'
            : 'Model operation cancelled because the project changed.',
      ),
    );
    // Export, topology inspection and sketch solving are synchronous native
    // operations. Explicit cancellation releases their Worker immediately.
    if (pending.kind !== 'compile') this.restartExecutor();
    return true;
  }

  private cancelExecution(): void {
    const running = this.runningExecution;
    if (!running || running.cancellationTimeout !== undefined) return;
    Atomics.store(running.request.cancellation, 0, 1);
    this.storage.cancelReads(this.executor);
    running.cancellationTimeout = window.setTimeout(
      () =>
        runInAction(() => {
          this.restartExecutor();
          this.startExecution();
        }),
      5_000,
    );
  }
  previewSketchDrag(
    layers: readonly SketchSnapshot[],
    drag: SketchDrag,
  ): Promise<SketchDragPreview> {
    if (this.pending || !this.exportable)
      return Promise.reject(new Error('Waiting for the updated sketch.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = {
        kind: 'sketch',
        id,
        resolve,
        reject,
      };
      this.sendExecution({kind: 'sketch', id, layers, drag});
    });
  }

  dispose(): void {
    this.cancel();
    this.finishCacheReset(new Error('The project was closed.'));
    this.finishExecution();
    this.compiler.terminate();
    this.storage.disconnect(this.compiler);
    this.executor.terminate();
    this.storage.disconnect(this.executor);
    this.storage.dispose();
    this.compiledArtifacts.reset();
    this.executionArtifacts.reset();
    this.runningCompile = undefined;
    this.exportable = undefined;
  }
  inspectTopology(
    module: ModelModule,
    nodeId: string,
    options: TopologyInspectionOptions,
  ): Promise<TopologyInspection> {
    if (!this.canExport(module))
      return Promise.reject(
        new Error('The model geometry snapshot is unavailable.'),
      );
    const compileId = this.exportable!.compileId;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = {
        kind: 'topology',
        id,
        resolve,
        reject,
      };
      this.sendExecution({kind: 'topology', id, compileId, nodeId, options});
    });
  }

  private sendExecution(message: ExecutorRequest): void {
    this.executor.postMessage(message);
  }
  private startCompile(): void {
    if (this.runningCompile || !this.queuedCompile) return;
    this.runningCompile = this.queuedCompile;
    this.queuedCompile = undefined;
    this.compiler.postMessage(this.runningCompile);
  }
  private startExecution(): void {
    if (this.runningExecution || !this.queuedExecution) return;
    const dependency = this.queuedExecution.request.artifact.dependencies.id;
    // Native ESM records and kernel instances are released with their Worker.
    if (this.executorDependency && this.executorDependency !== dependency)
      this.restartExecutor();
    this.executorDependency = dependency;
    this.runningExecution = this.queuedExecution;
    this.queuedExecution = undefined;
    const request = this.runningExecution.request;
    this.sendExecution({
      ...request,
      ...this.executionArtifacts.encode(request.artifact),
    });
  }
  private finishExecution(): void {
    window.clearTimeout(this.runningExecution?.cancellationTimeout);
    this.runningExecution = undefined;
  }

  private async readFile(worker: Worker, request: FileRequest): Promise<void> {
    try {
      const files =
        request.source === 'builtin' ? browserPackageFiles : this.files;
      const value = await (request.operation === 'statMany'
        ? statProjectFiles(files, request.paths)
        : files[request.operation](request.path));
      if (worker === this.compiler)
        worker.postMessage({kind: 'file-result', id: request.id, value});
    } catch (error) {
      if (worker === this.compiler)
        worker.postMessage({
          kind: 'file-result',
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }
  private progress(id: number, phase: CompilationPhase): void {
    const pending = this.pending;
    if (pending?.kind !== 'compile' || pending.id !== id) return;
    this.phase = phase;
    pending.onProgress?.(phase);
  }
  private createCompiler(): Worker {
    const worker = new CompilerWorker();
    this.storage.connect(worker);
    worker.onmessage = ({data: message}: MessageEvent<CompilerResponse>) =>
      runInAction(() => {
        if (worker !== this.compiler) return;
        if (message.kind === 'build-cache-cleared') {
          this.finishCacheReset(
            message.error ? new Error(message.error) : undefined,
          );
          return;
        }
        const data =
          message.kind === 'compiled' || message.kind === 'cached'
            ? {...message, artifact: this.compiledArtifacts.decode(message)}
            : message;
        if (data.kind === 'file') {
          void this.readFile(worker, data);
          return;
        }
        if (data.kind === 'progress') {
          this.progress(data.id, data.phase);
          return;
        }
        if (data.kind === 'language') {
          if (data.id === this.pending?.id) this.onLanguage?.(data.language);
          return;
        }
        if (data.kind === 'cached') {
          if (data.id === this.pending?.id && !this.compiledArtifact) {
            this.queuedExecution = {
              compileId: data.id,
              cached: true,
              request: {
                kind: 'execute',
                id: this.nextId++,
                artifact: data.artifact,
                cancellation: cancellation(),
              },
            };
            this.cancelExecution();
            this.startExecution();
          }
          return;
        }
        if (data.id === this.runningCompile?.id)
          this.runningCompile = undefined;
        this.startCompile();
        if (data.id !== this.pending?.id) return;
        if (data.kind === 'compiled') {
          this.compiledArtifact = data.artifact.id;
          if (
            this.cachedResult?.requestId === data.id &&
            this.cachedResult.artifactId === data.artifact.id
          ) {
            this.acceptExecution(
              this.cachedResult.module,
              this.cachedResult.executionId,
            );
            return;
          }
          if (
            this.runningExecution?.compileId === data.id &&
            this.runningExecution.request.artifact.id === data.artifact.id
          ) {
            this.runningExecution.cached = false;
            return;
          }
          this.queuedExecution = {
            compileId: data.id,
            request: {
              kind: 'execute',
              id: this.nextId++,
              artifact: data.artifact,
              cancellation: cancellation(),
            },
          };
          // Finish restoring this entry's last successful view before executing
          // its update. A newer compile request still cancels both immediately.
          if (
            !this.runningExecution?.cached ||
            this.runningExecution.compileId !== data.id
          )
            this.cancelExecution();
          this.startExecution();
        } else if (data.kind === 'result' && !data.ok) {
          const error = new ModelDiagnosticError(data.diagnostic);
          if (
            this.runningExecution?.cached &&
            this.runningExecution.compileId === data.id
          )
            this.runningExecution.compilationError = error;
          else this.fail(data.id, error);
        }
      });
    worker.onerror = ({message}) =>
      runInAction(() => {
        if (worker !== this.compiler) return;
        if (this.runningCompile)
          this.fail(
            this.runningCompile.id,
            new Error(message || 'The compiler worker failed.'),
          );
        this.restartCompiler();
        this.startCompile();
      });
    return worker;
  }
  private createExecutor(): Worker {
    const worker = new ExecutorWorker();
    this.storage.connect(worker);
    worker.onmessage = ({data}: MessageEvent<ExecutorResponse>) =>
      runInAction(() => {
        if (worker !== this.executor) return;
        const running =
          this.runningExecution?.request.id === data.id
            ? this.runningExecution
            : undefined;
        if (data.kind === 'progress') {
          if (running) this.progress(running.compileId, data.phase);
          return;
        }
        if (running && (data.kind === 'result' || data.kind === 'cancelled')) {
          this.finishExecution();
          this.startExecution();
          if (
            data.kind === 'cancelled' ||
            this.pending?.id !== running.compileId
          )
            return;
          if (running.cached) {
            if (data.ok) {
              this.cachedResult = {
                requestId: running.compileId,
                executionId: data.id,
                artifactId: running.request.artifact.id,
                module: data.module,
              };
              if (!data.module.diagnostic) {
                this.restored = {
                  rootPath: running.request.artifact.model.rootPath,
                  module: data.module,
                };
                this.publishSuccessful(running.request.artifact.id);
              }
            }
            if (running.compilationError)
              this.fail(running.compileId, running.compilationError);
          } else if (data.ok) this.acceptExecution(data.module, data.id);
          else
            this.fail(
              running.compileId,
              new ModelDiagnosticError(data.diagnostic),
            );
          return;
        }
        const pending = this.pending;
        if (!pending || data.kind === 'cancelled' || pending.id !== data.id)
          return;
        this.pending = null;
        if (!data.ok) pending.reject(new ModelDiagnosticError(data.diagnostic));
        else if (pending.kind === 'export' && data.kind === 'export')
          pending.resolve(data.blob);
        else if (pending.kind === 'topology' && data.kind === 'topology')
          pending.resolve(data.topology);
        else if (pending.kind === 'sketch' && data.kind === 'sketch')
          pending.resolve(data.preview);
      });
    worker.onerror = ({message}) =>
      runInAction(() => {
        if (worker !== this.executor) return;
        const error = new Error(message || 'The model worker failed.');
        if (this.pending && this.pending.kind !== 'compile')
          this.fail(this.pending.id, error);
        else if (
          this.runningExecution &&
          this.runningExecution.cancellationTimeout === undefined
        )
          this.fail(this.runningExecution.compileId, error);
        this.restartExecutor();
        this.startExecution();
      });
    return worker;
  }
  private acceptExecution(module: ModelModule, executionId: number): void {
    const pending = this.pending;
    if (pending?.kind !== 'compile') return;
    this.pending = null;
    this.exportable = {module, compileId: executionId};
    if (!module.diagnostic && this.compiledArtifact)
      this.publishSuccessful(this.compiledArtifact);
    pending.resolve(module);
  }

  private publishSuccessful(artifact: string): void {
    if (this.projectIdentity && this.publication)
      this.compiler.postMessage({
        kind: 'execution-succeeded',
        projectIdentity: this.projectIdentity,
        artifact,
        ...this.publication,
      });
  }

  private fail(id: number, error: Error): void {
    const pending = this.pending;
    if (pending?.id !== id) return;
    this.pending = null;
    pending.reject(error);
  }
  private restartCompiler(): void {
    this.finishCacheReset(new Error('The compiler worker was restarted.'));
    this.runningCompile = undefined;
    this.compiler.terminate();
    this.storage.disconnect(this.compiler);
    this.compiledArtifacts.reset();
    this.compiler = this.createCompiler();
    this.lastEntry = undefined;
  }
  private restartExecutor(): void {
    this.finishExecution();
    this.executor.terminate();
    this.storage.disconnect(this.executor);
    this.exportable = undefined;
    this.executorDependency = undefined;
    this.executionArtifacts.reset();
    this.executor = this.createExecutor();
  }
}
function cancellation(): Int32Array<SharedArrayBuffer> {
  return new Int32Array(new SharedArrayBuffer(4));
}
