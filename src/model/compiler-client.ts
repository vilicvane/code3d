import CompilerWorker from './compiler.worker?worker';
import type {ModelModule} from './compiler';
import type {ModelProject} from '../project/project';

type CompileResponse =
  | Readonly<{id: number; ok: true; module: ModelModule}>
  | Readonly<{
      id: number;
      ok: false;
      error: Readonly<{
        message: string;
        file?: string;
        start?: number;
        length?: number;
      }>;
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

  compile(project: ModelProject): Promise<ModelModule> {
    if (this.pending) {
      this.pending.reject(new Error('Compilation superseded.'));
      window.clearTimeout(this.pending.timeout);
      this.restartWorker();
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeoutMilliseconds = this.kernelInitialized ? 3000 : 20_000;
      const timeout = window.setTimeout(() => {
        if (this.pending?.id !== id) {
          return;
        }
        this.pending = null;
        this.restartWorker();
        reject(
          new Error(
            this.kernelInitialized
              ? '模型执行超过 3 秒，已终止本次运行。'
              : 'OpenCascade 初始化或首次建模超过 20 秒，已终止本次运行。',
          ),
        );
      }, timeoutMilliseconds);

      this.pending = {id, resolve, reject, timeout};
      this.worker.postMessage({id, project});
    });
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
        const error = new Error(
          'stack' in data.error && typeof data.error.stack === 'string'
            ? data.error.stack
            : data.error.message,
        ) as Error & {
          start?: number;
          length?: number;
          file?: string;
        };
        error.file = data.error.file;
        error.start = data.error.start;
        error.length = data.error.length;
        pending.reject(error);
      }
    };
    worker.onerror = ({message}) => {
      const pending = this.pending;
      if (!pending) {
        return;
      }
      window.clearTimeout(pending.timeout);
      this.pending = null;
      pending.reject(new Error(message || '模型 Worker 运行失败。'));
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
