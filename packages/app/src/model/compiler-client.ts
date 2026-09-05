import CompilerWorker from './compiler.worker?worker';
import type {ModelModule} from './compiler';
import {ModelDiagnosticError} from './diagnostic';
import type {ModelProject} from '../project/project';
import type {CompilerResponse} from './compiler-protocol';
import type {ModelExportInstance, ModelExportOptions} from './model-export';

type PendingRequest = {
  id: number;
  reject(error: Error): void;
  timeout: number;
} & (
  | {kind: 'compile'; resolve(module: ModelModule): void}
  | {kind: 'export'; resolve(blob: Blob): void}
);

export class ModelCompilerClient {
  private worker: Worker;
  private nextId = 1;
  private pending: PendingRequest | null = null;
  private kernelInitialized = false;
  private exportable?: {module: ModelModule; compileId: number};

  constructor() {
    this.worker = this.createWorker();
  }

  compile(
    project: ModelProject,
    rootPath: string,
    designContextId?: string,
  ): Promise<ModelModule> {
    this.cancel();
    this.exportable = undefined;

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeoutMilliseconds = this.kernelInitialized ? 15_000 : 30_000;
      const initialized = this.kernelInitialized;
      const timeout = window.setTimeout(() => {
        if (this.pending?.id !== id) {
          return;
        }
        this.pending = null;
        this.restartWorker();
        reject(
          new Error(
            initialized
              ? 'Model execution exceeded 15 seconds and was terminated.'
              : 'OpenCascade initialization or the first model run exceeded 30 seconds and was terminated.',
          ),
        );
      }, timeoutMilliseconds);

      this.pending = {kind: 'compile', id, resolve, reject, timeout};
      this.worker.postMessage({
        kind: 'compile',
        id,
        project,
        rootPath,
        designContextId,
      });
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
      const timeout = window.setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = null;
        this.restartWorker();
        reject(
          new Error(
            'Export exceeded 30 seconds and was terminated. Run the model again before retrying.',
          ),
        );
      }, 30_000);
      this.pending = {kind: 'export', id, resolve, reject, timeout};
      this.worker.postMessage({
        kind: 'export',
        id,
        compileId,
        instances,
        options,
      });
    });
  }

  cancel(): boolean {
    const pending = this.pending;
    if (!pending) return false;
    this.pending = null;
    window.clearTimeout(pending.timeout);
    pending.reject(
      new Error(
        pending.kind === 'compile'
          ? 'Compilation superseded.'
          : 'Export cancelled because the model changed.',
      ),
    );
    this.restartWorker();
    return true;
  }

  private createWorker(): Worker {
    const worker = new CompilerWorker();
    worker.onmessage = ({data}: MessageEvent<CompilerResponse>) => {
      const pending = this.pending;
      if (!pending || pending.id !== data.id) {
        return;
      }

      window.clearTimeout(pending.timeout);
      this.pending = null;
      if (data.ok) {
        this.kernelInitialized = true;
        if (pending.kind === 'compile' && data.kind === 'compile') {
          this.exportable = {module: data.module, compileId: data.id};
          pending.resolve(data.module);
        } else if (pending.kind === 'export' && data.kind === 'export') {
          pending.resolve(data.blob);
        }
      } else {
        pending.reject(new ModelDiagnosticError(data.diagnostic));
      }
    };
    worker.onerror = ({message}) => {
      const pending = this.pending;
      if (!pending) {
        return;
      }
      window.clearTimeout(pending.timeout);
      this.pending = null;
      pending.reject(new Error(message || 'The model worker failed.'));
      this.restartWorker();
    };
    return worker;
  }

  private restartWorker(): void {
    this.worker.terminate();
    this.kernelInitialized = false;
    this.exportable = undefined;
    this.worker = this.createWorker();
  }
}
