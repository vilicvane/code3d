import type {ModelModule} from './compiler';
import type {ModelDiagnostic} from './diagnostic';

export type ModelPreviewRequest = Readonly<{
  revision: number;
  file: string | undefined;
  sourceVersion: number;
}>;

/** Own the displayed result and in-flight requests for one file load. */
export class ModelPreviewState {
  private generation = 0;
  private snapshot?: {module: ModelModule; sourceVersion: number};
  private resultCurrent = false;
  private changingFile = false;
  private changingSource = false;
  file: string | undefined;
  status: 'ready' | 'error' = 'ready';
  diagnostic: ModelDiagnostic | undefined;
  warnings: readonly ModelDiagnostic[] = [];
  hasPreviewedTarget = false;
  busy = true;

  get revision(): number {
    return this.generation;
  }

  get module(): ModelModule | null {
    return this.snapshot?.module ?? null;
  }

  get sourceVersion(): number | undefined {
    return this.resultCurrent && !this.changingSource
      ? this.snapshot?.sourceVersion
      : undefined;
  }

  activate(
    file: string | undefined,
    clearView: () => void,
    reload = false,
  ): void {
    if (file === this.file && !reload) return;
    this.invalidate();
    this.file = file;
    this.snapshot = undefined;
    this.resultCurrent = false;
    this.status = 'ready';
    this.diagnostic = undefined;
    this.warnings = [];
    this.changingFile = true;
    try {
      clearView();
    } finally {
      this.changingFile = false;
      this.hasPreviewedTarget = false;
    }
  }

  invalidate(): void {
    this.generation++;
  }

  begin(sourceVersion: number): ModelPreviewRequest {
    this.invalidate();
    return {revision: this.revision, file: this.file, sourceVersion};
  }

  isCurrent(request: ModelPreviewRequest, sourceVersion: number): boolean {
    return (
      request.revision === this.revision &&
      request.file === this.file &&
      request.sourceVersion === sourceVersion
    );
  }

  accept(request: ModelPreviewRequest, module: ModelModule): void {
    this.snapshot = {module, sourceVersion: request.sourceVersion};
    this.resultCurrent = true;
    this.status = module.diagnostic ? 'error' : 'ready';
    this.diagnostic = module.diagnostic;
    this.warnings = module.warnings;
  }

  fail(diagnostic?: ModelDiagnostic): void {
    // Same-file preparation failures retain the display, but not editable data.
    this.resultCurrent = false;
    this.status = 'error';
    this.diagnostic = diagnostic;
    this.warnings = [];
  }

  observeTarget(present: boolean): void {
    if (this.file && !this.changingFile) this.hasPreviewedTarget ||= present;
  }

  editSource<T>(update: () => T): T {
    this.changingSource = true;
    try {
      return update();
    } finally {
      this.changingSource = false;
    }
  }
}
