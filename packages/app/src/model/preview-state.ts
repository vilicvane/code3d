import {
  compilationPhaseLabels,
  compilationPhaseDescriptions,
  type CompilationPhase,
} from './compilation-progress.ts';
import {action, computed, makeObservable, observableRef} from 'mobx';
import type {ModelModule} from './compiler';
import type {ModelDiagnostic} from './diagnostic';

export type ModelPreviewRequest = Readonly<{
  revision: number;
  file: string | undefined;
  sourceVersion: number;
}>;

/** Own current-file results and the handover from the previously displayed file. */
export class ModelPreviewState {
  private generation = 0;
  private snapshot?: {module: ModelModule; sourceVersion: number};
  private resultCurrent = false;
  private awaitingFile = false;
  private retaining = false;
  private changingSource = false;
  private activity: Readonly<{
    state: 'busy' | 'ready' | 'error';
    label?: string;
    compilation?: {member?: string};
  }> = {state: 'busy', label: 'Loading editor'};
  file: string | undefined;
  status: 'ready' | 'error' = 'ready';
  diagnostic: ModelDiagnostic | undefined;
  warnings: readonly ModelDiagnostic[] = [];
  hasPreviewedTarget = false;
  private readonly compilationPhase: () => CompilationPhase | undefined;
  constructor(
    compilationPhase: () => CompilationPhase | undefined = () => undefined,
  ) {
    this.compilationPhase = compilationPhase;
    makeObservable<
      this,
      | 'snapshot'
      | 'resultCurrent'
      | 'awaitingFile'
      | 'retaining'
      | 'changingSource'
      | 'activity'
    >(this, {
      snapshot: observableRef,
      resultCurrent: observableRef,
      awaitingFile: observableRef,
      retaining: observableRef,
      changingSource: observableRef,
      activity: observableRef,
      file: observableRef,
      status: observableRef,
      diagnostic: observableRef,
      warnings: observableRef,
      hasPreviewedTarget: observableRef,
      module: computed,
      sourceVersion: computed,
      retainingView: computed,
      pendingFile: computed,
      presentation: computed,
      statusDiagnostic: computed,
      busy: computed,
      empty: computed,
      showHint: computed,
      activate: action,
      begin: action,
      accept: action,
      restore: action,
      presented: action,
      fail: action,
      observeTarget: action,
      editSource: action,
      showStatus: action,
      beginCompilation: action,
    });
  }

  get retainingView(): boolean {
    return this.retaining;
  }

  get pendingFile(): boolean {
    return this.awaitingFile;
  }

  get presentation() {
    const compilation = this.activity.compilation;
    const phase = compilation ? this.compilationPhase() : undefined;
    return {
      state: this.activity.state,
      label: phase
        ? `${compilationPhaseLabels[phase]}${compilation?.member ? ` · ${compilation.member}` : ''}`
        : this.activity.label,
      description: phase ? compilationPhaseDescriptions[phase] : undefined,
      delay: phase === 'preparing-preview' ? 200 : 0,
    };
  }

  beginCompilation(member?: string): void {
    this.activity = {state: 'busy', compilation: {member}};
  }

  get statusDiagnostic(): ModelDiagnostic | undefined {
    return this.activity.state === 'error' ? this.diagnostic : undefined;
  }

  get busy(): boolean {
    return this.activity.state === 'busy';
  }

  get empty(): boolean {
    return !this.hasPreviewedTarget && !this.retaining;
  }

  get showHint(): boolean {
    return this.empty && !this.busy;
  }

  showStatus(state: 'busy' | 'ready' | 'error', label?: string): void {
    this.activity = {state, label};
  }

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

  activate(file: string | undefined, reload = false): boolean {
    if (file === this.file && !reload) return false;
    this.retaining =
      !!file && !reload && (this.hasPreviewedTarget || this.retaining);
    this.invalidate();
    this.file = file;
    this.snapshot = undefined;
    this.resultCurrent = false;
    this.status = 'ready';
    this.diagnostic = undefined;
    this.warnings = [];
    this.awaitingFile = file !== undefined;
    this.hasPreviewedTarget = false;
    return true;
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
    this.awaitingFile = false;
    this.snapshot = {module, sourceVersion: request.sourceVersion};
    this.resultCurrent = true;
    this.status = module.diagnostic ? 'error' : 'ready';
    this.diagnostic = module.diagnostic;
    this.warnings = module.warnings;
  }

  /** Cached geometry is displayable while its source snapshot is being checked. */
  restore(request: ModelPreviewRequest, module: ModelModule): void {
    this.awaitingFile = false;
    this.snapshot = {module, sourceVersion: request.sourceVersion};
    this.resultCurrent = false;
    this.diagnostic = undefined;
    this.warnings = [];
  }

  /** Release the previous view after its replacement has been rendered. */
  presented(present: boolean): void {
    this.retaining = false;
    this.observeTarget(present);
  }

  fail(diagnostic?: ModelDiagnostic): void {
    // Same-file preparation failures retain the display, but not editable data.
    this.resultCurrent = false;
    this.awaitingFile = false;
    this.retaining = false;
    this.status = 'error';
    this.diagnostic = diagnostic;
    this.warnings = [];
  }

  observeTarget(present: boolean): void {
    if (this.file && !this.awaitingFile && !this.retaining)
      this.hasPreviewedTarget ||= present;
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
