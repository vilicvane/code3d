import CompilerWorker from './compiler.worker?worker';
import type {ModelModule} from './compiler';
import {ModelDiagnosticError} from './diagnostic';
import type {ModelProject} from '../project/project';
import type {ProjectFileReader} from '../project/file-reader';
import type {ProjectLanguage} from '../project/project-language';
import {browserPackageFiles} from '../project/browser-packages';
import type {
  CompilerRequest,
  CompilerResponse,
  FileRequest,
} from './compiler-protocol';

type PendingCompile = {
  id: number;
  resolve(module: ModelModule): void;
  reject(error: Error): void;
  timeout: number;
  evaluating: boolean;
};

export class ModelCompilerClient {
  private worker: Worker;
  private nextId = 1;
  private pending: PendingCompile | null = null;

  constructor(
    private readonly files: ProjectFileReader,
    private readonly onLanguage?: (language: ProjectLanguage) => void,
  ) {
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
      this.pending = {
        id,
        resolve,
        reject,
        evaluating: false,
        timeout: this.deadline(id, 120_000),
      };
      this.send({kind: 'compile', id, project, rootPath, designContextId});
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
    // An executing model may contain a synchronous infinite loop. Preparation
    // can finish asynchronously without throwing away the installed kernel.
    if (pending.evaluating) this.restartWorker();
    else this.send({kind: 'cancel', id: pending.id});
    return true;
  }

  dispose(): void {
    if (this.pending) {
      window.clearTimeout(this.pending.timeout);
      this.pending.reject(new Error('Project closed.'));
      this.pending = null;
    }
    this.worker.terminate();
  }

  private deadline(id: number, milliseconds: number): number {
    return window.setTimeout(() => {
      const pending = this.pending;
      if (pending?.id !== id) return;
      this.pending = null;
      this.restartWorker();
      pending.reject(
        new Error(
          pending.evaluating
            ? 'Model execution exceeded 15 seconds and was terminated.'
            : 'Project preparation exceeded 120 seconds and was terminated.',
        ),
      );
    }, milliseconds);
  }

  private send(message: CompilerRequest, worker = this.worker): void {
    worker.postMessage(message);
  }

  private async readFile(worker: Worker, request: FileRequest): Promise<void> {
    try {
      const files =
        request.source === 'builtin' ? browserPackageFiles : this.files;
      const value = await files[request.operation](request.path);
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
      if (data.kind === 'file') {
        void this.readFile(worker, data);
        return;
      }
      const pending = this.pending;
      if (!pending || pending.id !== data.id) return;
      if (data.kind === 'language') {
        this.onLanguage?.(data.language);
        return;
      }
      window.clearTimeout(pending.timeout);
      if (data.kind === 'evaluating') {
        pending.evaluating = true;
        pending.timeout = this.deadline(data.id, 15_000);
        return;
      }
      this.pending = null;
      if (data.ok) pending.resolve(data.module);
      else pending.reject(new ModelDiagnosticError(data.diagnostic));
    };
    worker.onerror = ({message}) => {
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
    this.worker.terminate();
    this.worker = this.createWorker();
  }
}
