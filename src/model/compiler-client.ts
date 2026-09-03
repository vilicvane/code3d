import CompilerWorker from './compiler.worker?worker';
import type {ModelModule} from './compiler';
import {ModelDiagnosticError, type ModelDiagnostic} from './diagnostic';
import type {ModelProject} from '../project/project';

type CompileResponse =
  | Readonly<{id: number; ok: true; module: ModelModule}>
  | Readonly<{
      id: number;
      ok: false;
      diagnostic: ModelDiagnostic;
    }>;

type PendingCompile = {
  id: number;
  resolve(module: ModelModule): void;
  reject(error: Error): void;
  timeout: number;
};

export class ModelCompilerClient {
  private worker: Worker;
  private nextId = 1;
  private pending: PendingCompile | null = null;
  private kernelInitialized = false;

  constructor() {
    this.worker = this.createWorker();
  }

  compile(
    project: ModelProject,
    rootPath: string,
    designContextId?: string,
  ): Promise<ModelModule> {
    this.cancel();

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeoutMilliseconds = this.kernelInitialized ? 15_000 : 30_000;
      const timeout = window.setTimeout(() => {
        if (this.pending?.id !== id) {
          return;
        }
        this.pending = null;
        this.restartWorker();
        reject(
          new Error(
            this.kernelInitialized
              ? 'Model execution exceeded 15 seconds and was terminated.'
              : 'OpenCascade initialization or the first model run exceeded 30 seconds and was terminated.',
          ),
        );
      }, timeoutMilliseconds);

      this.pending = {id, resolve, reject, timeout};
      this.worker.postMessage({id, project, rootPath, designContextId});
    });
  }

  isCompiling(): boolean {
    return this.pending !== null;
  }

  cancel(): boolean {
    const pending = this.pending;
    if (!pending) return false;
    this.pending = null;
    window.clearTimeout(pending.timeout);
    pending.reject(new Error('Compilation superseded.'));
    this.restartWorker();
    return true;
  }

  private createWorker(): Worker {
    const worker = new CompilerWorker();
    worker.onmessage = ({data}: MessageEvent<CompileResponse>) => {
      const pending = this.pending;
      if (!pending || pending.id !== data.id) {
        return;
      }

      window.clearTimeout(pending.timeout);
      this.pending = null;
      if (data.ok) {
        this.kernelInitialized = true;
        pending.resolve(data.module);
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
    this.worker = this.createWorker();
  }
}
