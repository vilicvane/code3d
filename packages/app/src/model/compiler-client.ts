import CompilerWorker from './compiler.worker?worker';
import type {ModelModule} from './compiler';
import {ModelDiagnosticError} from './diagnostic';
import type {ModelProject} from '../project/project';
import type {ProjectFileReader} from '../project/file-reader';
import type {ProjectLanguage} from '../project/project-language';
import {browserPackageFiles} from '../project/browser-packages';
import type {ModelExportInstance, ModelExportOptions} from './model-export';
import type {CompilationProgress} from './compilation-progress';
import type {SketchSnapshot} from '@code3d/core/tooling';
import type {
  CompilerRequest,
  CompilerResponse,
  FileRequest,
} from './compiler-protocol';
import type {SketchDrag, SketchDragPreview} from './sketch-drag';

type PendingRequest = {
  id: number;
  reject(error: Error): void;
  timeout: number;
} & (
  | {
      kind: 'compile';
      evaluating: boolean;
      onProgress?: CompilationProgress;
      resolve(module: ModelModule): void;
    }
  | {kind: 'export'; resolve(blob: Blob): void}
  | {kind: 'sketch'; resolve(preview: SketchDragPreview): void}
);

export class ModelCompilerClient {
  private worker: Worker;
  private nextId = 1;
  private pending: PendingRequest | null = null;
  private exportable?: {module: ModelModule; compileId: number};

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
    onProgress?: CompilationProgress,
  ): Promise<ModelModule> {
    this.cancel();
    this.exportable = undefined;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = {
        kind: 'compile',
        id,
        resolve,
        reject,
        evaluating: false,
        onProgress,
        timeout: this.deadline(id, 120_000),
      };
      this.send({kind: 'compile', id, project, rootPath, designContextId});
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
            : 'Export cancelled because the model changed.',
      ),
    );
    // An executing model may contain a synchronous infinite loop. Preparation
    // can finish asynchronously without throwing away the installed kernel.
    if (
      pending.kind === 'export' ||
      (pending.kind === 'compile' && pending.evaluating)
    )
      this.restartWorker();
    else this.send({kind: 'cancel', id: pending.id});
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
    if (this.pending) {
      window.clearTimeout(this.pending.timeout);
      this.pending.reject(new Error('Project closed.'));
      this.pending = null;
    }
    this.worker.terminate();
    this.exportable = undefined;
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
              : pending.evaluating
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
      if (data.kind === 'progress') {
        if (pending.kind !== 'compile') return;
        if (data.phase === 'evaluating-model') {
          window.clearTimeout(pending.timeout);
          pending.evaluating = true;
          pending.timeout = this.deadline(data.id, 15_000);
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
      } else if (pending.kind === 'sketch' && data.kind === 'sketch') {
        pending.resolve(data.preview);
      }
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
    this.exportable = undefined;
    this.worker = this.createWorker();
  }
}
