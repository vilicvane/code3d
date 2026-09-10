import CompilerWorker from './compiler.worker?worker';
import type {DesignContext, ModelModule} from './compiler';
import {ModelDiagnosticError} from './diagnostic';
import type {ModelProject} from '../project/project';
import {statProjectFiles, type ProjectFileReader} from '../project/file-reader';
import type {ProjectLanguage} from '../project/project-language';
import {browserPackageFiles} from '../project/browser-packages';
import type {ModelExportInstance, ModelExportOptions} from './model-export';
import type {CompilationProgress} from './compilation-progress';
import type {
  SketchSnapshot,
  TopologyInspection,
  TopologyInspectionOptions,
} from '@code3d/core/tooling';
import type {
  CompileRequest,
  CompilerRequest,
  CompilerResponse,
  FileRequest,
} from './compiler-protocol';
import type {SketchDrag, SketchDragPreview} from './sketch-drag';

type PendingRequest = {
  id: number;
  reject(error: Error): void;
  timeout?: number;
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

export class ModelCompilerClient {
  private worker: Worker;
  private nextId = 1;
  private preparationRevision = 0;
  private pending: PendingRequest | null = null;
  private queuedCompile?: CompileRequest;
  private runningCompile?: {
    request: CompileRequest;
    cancellationTimeout?: number;
  };
  private exportable?: {module: ModelModule; compileId: number};

  constructor(
    private readonly files: ProjectFileReader,
    private readonly onLanguage?: (language: ProjectLanguage) => void,
    private readonly prepareProject?: (
      project: ModelProject,
      rootPath: string,
    ) => Promise<void>,
  ) {
    this.worker = this.createWorker();
  }

  async compile(
    project: ModelProject,
    rootPath: string,
    designContext?: DesignContext,
    onProgress?: CompilationProgress,
  ): Promise<ModelModule> {
    this.cancel();
    const preparation = this.preparationRevision;
    await this.prepareProject?.(project, rootPath);
    if (preparation !== this.preparationRevision)
      throw new Error('Compilation superseded.');
    this.exportable = undefined;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = {
        kind: 'compile',
        id,
        resolve,
        reject,
        onProgress,
      };
      this.queuedCompile = {
        kind: 'compile',
        id,
        project,
        rootPath,
        designContext,
        cancellation: new Int32Array(
          new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
        ),
      };
      this.startQueuedCompile();
    });
  }

  isCompiling(): boolean {
    return this.pending?.kind === 'compile';
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
        timeout: this.deadline(id, 30_000),
      };
      this.send({kind: 'export', id, compileId, instances, options});
    });
  }

  cancel(): boolean {
    this.preparationRevision++;
    const pending = this.pending;
    if (!pending) return false;
    this.pending = null;
    window.clearTimeout(pending.timeout);
    pending.reject(
      new Error(
        pending.kind === 'compile'
          ? 'Compilation superseded.'
          : pending.kind === 'sketch'
            ? 'Sketch preview superseded.'
            : 'Model operation cancelled because the project changed.',
      ),
    );
    if (pending.kind === 'compile') {
      this.exportable = undefined;
      this.queuedCompile = undefined;
      const running = this.runningCompile;
      if (running?.request.id === pending.id) {
        Atomics.store(running.request.cancellation, 0, 1);
        // Allow a synchronous operation to finish and retain its result. A
        // stuck native operation or author loop still has a bounded escape.
        running.cancellationTimeout = window.setTimeout(() => {
          this.restartWorker();
          this.startQueuedCompile();
        }, 5_000);
      }
    } else if (pending.kind !== 'sketch') this.restartWorker();
    return true;
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
        timeout: this.deadline(id, 15_000),
      };
      this.send({kind: 'sketch', id, layers, drag});
    });
  }

  dispose(): void {
    this.preparationRevision++;
    if (this.pending) {
      window.clearTimeout(this.pending.timeout);
      this.pending.reject(new Error('Project closed.'));
      this.pending = null;
    }
    this.queuedCompile = undefined;
    this.finishRunningCompile();
    this.worker.terminate();
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
      this.send({kind: 'topology', id, compileId, nodeId, options});
    });
  }

  private deadline(id: number, milliseconds: number): number {
    return window.setTimeout(() => {
      const pending = this.pending;
      if (pending?.id !== id) return;
      this.pending = null;
      this.restartWorker();
      pending.reject(
        new Error(
          pending.kind === 'export'
            ? 'Export exceeded 30 seconds and was terminated. Run the model again before retrying.'
            : pending.kind === 'sketch'
              ? 'Sketch solving exceeded 15 seconds and was terminated.'
              : 'Project preparation exceeded 120 seconds and was terminated.',
        ),
      );
    }, milliseconds);
  }

  private send(message: CompilerRequest, worker = this.worker): void {
    worker.postMessage(message);
  }

  private startQueuedCompile(): void {
    if (this.runningCompile || !this.queuedCompile) return;
    const request = this.queuedCompile;
    this.queuedCompile = undefined;
    this.runningCompile = {request};
    this.pending!.timeout = this.deadline(request.id, 120_000);
    this.send(request);
  }

  private finishRunningCompile(): void {
    window.clearTimeout(this.runningCompile?.cancellationTimeout);
    this.runningCompile = undefined;
  }

  private async readFile(worker: Worker, request: FileRequest): Promise<void> {
    try {
      const files =
        request.source === 'builtin' ? browserPackageFiles : this.files;
      const value = await (request.operation === 'statMany'
        ? statProjectFiles(files, request.paths)
        : files[request.operation](request.path));
      if (worker === this.worker)
        this.send({kind: 'file-result', id: request.id, value}, worker);
    } catch (error) {
      if (worker === this.worker)
        this.send(
          {
            kind: 'file-result',
            id: request.id,
            error: error instanceof Error ? error.message : String(error),
          },
          worker,
        );
    }
  }

  private createWorker(): Worker {
    const worker = new CompilerWorker();
    worker.onmessage = ({data}: MessageEvent<CompilerResponse>) => {
      if (worker !== this.worker) return;
      if (data.kind === 'file') {
        void this.readFile(worker, data);
        return;
      }
      if (
        (data.kind === 'result' || data.kind === 'cancelled') &&
        data.id === this.runningCompile?.request.id
      ) {
        this.finishRunningCompile();
        if (this.pending?.id !== data.id) {
          this.startQueuedCompile();
          return;
        }
      }
      if (data.kind === 'cancelled') return;
      const pending = this.pending;
      if (!pending || pending.id !== data.id) return;
      if (data.kind === 'language') {
        this.onLanguage?.(data.language);
        return;
      }
      if (data.kind === 'progress') {
        if (pending.kind !== 'compile') return;
        if (data.phase === 'evaluating-model') {
          window.clearTimeout(pending.timeout);
          pending.timeout = undefined;
        }
        pending.onProgress?.(data.phase);
        return;
      }
      window.clearTimeout(pending.timeout);
      this.pending = null;
      if (!data.ok) pending.reject(new ModelDiagnosticError(data.diagnostic));
      else if (pending.kind === 'compile' && data.kind === 'result') {
        this.exportable = {module: data.module, compileId: data.id};
        pending.resolve(data.module);
      } else if (pending.kind === 'export' && data.kind === 'export') {
        pending.resolve(data.blob);
      } else if (pending.kind === 'topology' && data.kind === 'topology') {
        pending.resolve(data.topology);
      } else if (pending.kind === 'sketch' && data.kind === 'sketch') {
        pending.resolve(data.preview);
      }
    };
    worker.onerror = ({message}) => {
      if (worker !== this.worker) return;
      if (this.runningCompile?.cancellationTimeout !== undefined) {
        this.restartWorker();
        this.startQueuedCompile();
        return;
      }
      const pending = this.pending;
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      this.pending = null;
      pending.reject(new Error(message || 'The model worker failed.'));
      this.restartWorker();
    };
    return worker;
  }

  private restartWorker(): void {
    this.finishRunningCompile();
    this.worker.terminate();
    this.exportable = undefined;
    this.worker = this.createWorker();
  }
}
