import type {SketchDrawing} from './sketch-drawing';

type Step = {
  before: () => void;
  after: () => void;
  source?: {version: number; before: () => void; after: () => void};
};

export type SketchDrawingSourceHistory = {
  version(): number;
  /** Restore only the transient geometry view; Monaco owns persisted edits. */
  checkpoint(): () => void;
};

/** Tool checkpoints accompany Monaco transactions; only uncommitted clicks have local history. */
export class SketchDrawingHistory {
  private steps: Step[] = [];
  private cursor = 0;
  private discardedSourceRedo = false;

  clear(): void {
    this.steps = [];
    this.cursor = 0;
    this.discardedSourceRedo = false;
  }

  place(
    drawing: SketchDrawing,
    source: SketchDrawingSourceHistory,
    place: () => string | undefined,
  ): string | undefined {
    const before = drawing.checkpoint();
    const version = source.version();
    const beforeSource = source.checkpoint();
    const error = place();
    if (error) return error;
    const committed = source.version() !== version;
    this.discardedSourceRedo =
      !committed &&
      (this.discardedSourceRedo ||
        this.steps.slice(this.cursor).some(step => step.source));
    this.steps.splice(this.cursor, this.steps.length - this.cursor, {
      before,
      after: drawing.checkpoint(),
      source: committed
        ? {version, before: beforeSource, after: source.checkpoint()}
        : undefined,
    });
    this.cursor++;
    return undefined;
  }

  /** Return false when the source editor must perform the operation first. */
  run(action: 'undo' | 'redo'): boolean {
    const step = this.steps[action === 'undo' ? this.cursor - 1 : this.cursor];
    if (!step) return action === 'redo' && this.discardedSourceRedo;
    if (step.source) return false;
    this.restore(action, step);
    return true;
  }

  sourceChanged(
    action: 'undo' | 'redo',
    history: {before: number; after: number},
  ): boolean {
    const step = this.steps[action === 'undo' ? this.cursor - 1 : this.cursor];
    if (
      !step?.source ||
      step.source.version !== history[action === 'undo' ? 'after' : 'before']
    )
      return false;
    step.source[action === 'undo' ? 'before' : 'after']();
    this.restore(action, step);
    return true;
  }

  private restore(action: 'undo' | 'redo', step: Step): void {
    if (action === 'undo') {
      step.before();
      this.cursor--;
    } else {
      step.after();
      this.cursor++;
    }
  }
}
