import type {
  SketchSnapshot,
  SketchPosition,
  SketchConstraint,
  SketchPointAddress,
  SourceRef,
  ModelSnapshotObject,
} from '@code3d/core/tooling';
import {
  solveSketchSnapshot,
  sketchDragRequiresSolver,
  withSketchEntityParameters,
} from '@code3d/core/tooling';
import {
  previewSketchDrag,
  type SketchDrag,
  type SketchDragPreview,
  type SketchGeometryData,
} from '../model/sketch-drag';
import type {CompiledSketch} from '../model/sketch-trace';
import type {ModelDiagnostic} from '../model/diagnostic';
import {SketchEditor, type SketchEditorView} from '../ui/sketch-editor';
import {action, computed, makeObservable, observableRef, reaction} from 'mobx';
import {
  sketchContextOutlines,
  type SketchContextOutline,
} from './sketch-context';
import {
  analyzeSketchSource,
  sketchDraftEntity,
  type SketchChange,
  type SketchEditIntent,
} from './sketch-source';

/** Keeps successful source transactions visible while recompilation is pending. */
export class SketchEditorController {
  private readonly editor: SketchEditor;
  private active?: CompiledSketch;
  private layers: readonly SketchSnapshot[] = [];
  private sourceLayers: readonly CompiledSketch[] = [];
  private selectionRef?: SourceRef;
  private data: readonly SketchGeometryData[] = [];
  private stale = false;
  private revision = 0;
  private context: readonly SketchContextOutline[] = [];
  private viewScope = '';
  private sourceRange?: SourceRef;
  private pendingSynchronization?: {
    sourceVersion: number;
    layer: string;
    sourceRef: SourceRef;
    undoGroup: string;
  };
  private readonly stopView: () => void;

  constructor(
    container: HTMLElement,
    private readonly host: {
      readSource(ref: SourceRef): string | undefined;
      resolveSourceRef(ref: SourceRef): SourceRef | undefined;
      sourceVersion(): number;
      sourceHistoryVersion(file: string): number;
      commit(intent: SketchEditIntent, undoGroup?: string): boolean;
      cancelEditGroup(file: string, undoGroup: string): void;
      resumeEditGroup(file: string, undoGroup: string): void;
      reportResult(operation: SketchChange['kind'], error?: string): void;
      solve(
        layers: readonly SketchSnapshot[],
        drag: SketchDrag,
      ): Promise<SketchDragPreview>;
    },
  ) {
    makeObservable<
      this,
      | 'active'
      | 'layers'
      | 'sourceLayers'
      | 'selectionRef'
      | 'data'
      | 'stale'
      | 'revision'
      | 'context'
      | 'viewScope'
      | 'view'
      | 'commit'
    >(this, {
      active: observableRef,
      layers: observableRef,
      sourceLayers: observableRef,
      selectionRef: observableRef,
      data: observableRef,
      stale: observableRef,
      revision: observableRef,
      context: observableRef,
      viewScope: observableRef,
      view: computed,
      hasTarget: computed,
      diagnosticScope: computed,
      isStale: computed,
      select: action,
      hide: action,
      invalidate: action,
      retain: action,
      synchronizeSource: action,
      sourceEdited: action,
      sourceHistoryChanged: action,
      commit: action,
      dispose: action,
    });
    this.editor = new SketchEditor(
      container,
      (change, preview) => this.commit(change, preview),
      (id, position, previous, mergeTarget) =>
        this.preview(id, position, previous, mergeTarget),
      error => this.host.reportResult('move', error),
      {
        version: () =>
          this.host.sourceHistoryVersion(this.active!.definitionRef!.file),
        checkpoint: () => this.checkpointGeometry(),
      },
    );
    this.stopView = reaction(
      () => this.view,
      view => {
        if (view) this.editor.show(view);
        else this.editor.hide();
      },
      {fireImmediately: true},
    );
  }

  select(
    id: string | undefined,
    sketches: ReadonlyMap<string, CompiledSketch>,
    selectionRef: SourceRef | undefined,
    viewScope: string,
    objects: ReadonlyMap<string, ModelSnapshotObject> = new Map(),
  ): void {
    const next = id ? sketches.get(id) : undefined;
    this.revision++;
    this.viewScope = viewScope;
    this.active = next;
    this.sourceRange = next?.callRef ?? next?.definitionRef;
    this.context = this.active
      ? sketchContextOutlines(this.active, objects)
      : [];
    this.data = this.active?.data ?? [];
    this.stale = false;
    this.selectionRef = selectionRef;
    const layers: CompiledSketch[] = [];
    for (
      let layer: CompiledSketch | undefined = this.active;
      layer;
      layer = layer.base ? sketches.get(layer.base) : undefined
    )
      layers.unshift(layer);
    this.layers = layers;
    this.sourceLayers = layers;
  }

  get diagnosticScope(): readonly CompiledSketch[] | undefined {
    return this.active ? this.sourceLayers : undefined;
  }

  get dragPreview() {
    return this.editor.dragPreview;
  }

  get navigation() {
    return this.editor.navigation;
  }

  dispose(): void {
    this.revision++;
    this.cancelSynchronization();
    this.stopView();
    this.editor.dispose();
  }

  get hasTarget(): boolean {
    return this.active !== undefined;
  }

  get isStale(): boolean {
    return !!this.active && this.stale;
  }

  containsSource(file: string, offset: number): boolean {
    const ref =
      this.selectionRef && this.host.resolveSourceRef(this.selectionRef);
    return (
      !!ref && ref.file === file && offset >= ref.start && offset <= ref.end
    );
  }

  /** The authored call of the sketch being edited, rebased to current source. */
  private sketchSource(): SourceRef | undefined {
    const ref =
      this.sourceRange ?? this.active?.callRef ?? this.active?.definitionRef;
    return ref && this.host.resolveSourceRef(ref);
  }

  private withinSource(
    cursor: {file: string; offset: number} | undefined,
    source: SourceRef,
  ): boolean {
    return (
      !!cursor &&
      cursor.file === source.file &&
      cursor.offset >= source.start &&
      cursor.offset <= source.end
    );
  }

  sourceRefs(): SourceRef[] {
    return this.active
      ? [
          ...(this.selectionRef ? [this.selectionRef] : []),
          ...this.sourceLayers.flatMap(layer =>
            layer.definitionRef ? [layer.definitionRef] : [],
          ),
        ]
      : [];
  }

  /** Follow the caret: restore the last successful sketch while it stays inside
   * that sketch's source range, and mark the view stale once the settled
   * compilation no longer provides it. A failing edit therefore keeps showing
   * what was last drawn instead of closing the 2D tool.
   */
  retain(
    cursor: {file: string; offset: number} | undefined,
    sketches: ReadonlyMap<string, CompiledSketch>,
  ): boolean {
    const memorized = this.sourceLayers.at(-1);
    if (!memorized) return false;
    const source = this.sketchSource();
    const selection =
      this.selectionRef && this.host.resolveSourceRef(this.selectionRef);
    if (
      (!source || !this.withinSource(cursor, source)) &&
      (!selection || !this.withinSource(cursor, selection))
    )
      return false;
    // A compilation that still provides this sketch lets the caret drive.
    if (sketches.has(memorized.id)) return false;
    this.sourceLayers = this.sourceLayers.map(layer => ({
      ...layer,
      definitionRef:
        layer.definitionRef && this.host.resolveSourceRef(layer.definitionRef),
    }));
    const last = this.sourceLayers.at(-1);
    if (!last) return false;
    this.revision++;
    this.editor.cancel();
    this.active = last;
    this.layers = this.sourceLayers;
    this.data = last.data;
    this.stale = !sketches.has(last.id);
    return true;
  }

  /** Hide the 2D tool; the memorized sketch stays so the caret can restore it. */
  hide(): void {
    this.revision++;
    this.active = undefined;
  }
  invalidate(): void {
    this.revision++;
    this.cancelSynchronization();
    this.stale = true;
    this.editor.cancel();
  }

  runHistoryAction(action: 'undo' | 'redo'): boolean {
    return this.editor.runHistoryAction(action);
  }

  sourceHistoryChanged(
    file: string,
    action: 'undo' | 'redo',
    history: {before: number; after: number},
  ): void {
    const restored =
      this.active?.definitionRef?.file === file &&
      this.editor.sourceHistoryChanged(action, history);
    if (restored) {
      this.revision++;
      this.cancelSynchronization();
    } else this.invalidate();
  }

  private checkpointGeometry(): () => void {
    const {layers, data} = this;
    return action(() => {
      this.layers = layers;
      this.data = data;
      this.stale = false;
    });
  }

  /** Formatting is part of the same source operation; other tool edits supersede it. */
  sourceEdited(undoGroup?: string): void {
    const pending = this.pendingSynchronization;
    if (!pending) return;
    if (undoGroup === pending.undoGroup)
      pending.sourceVersion = this.host.sourceVersion();
    else this.cancelSynchronization();
  }

  /** Complete this GUI edit with the compiler's safe source repair before
   * publishing its result. Ordinary source edits still require an explicit Fix.
   */
  synchronizeSource(diagnostics: readonly ModelDiagnostic[]): boolean {
    const pending = this.pendingSynchronization;
    if (!pending) return false;
    // The source editor retains committed groups until its deferred formatter
    // finishes, so returning to the code does not add a separate undo step.
    this.pendingSynchronization = undefined;
    if (pending.sourceVersion !== this.host.sourceVersion()) {
      this.host.cancelEditGroup(pending.sourceRef.file, pending.undoGroup);
      return false;
    }
    const diagnostic = diagnostics.find(
      diagnostic =>
        diagnostic.viewport === 'sketch-source-sync' &&
        diagnostic.relatedSketchIds?.includes(pending.layer),
    );
    const intent = diagnostic?.actions?.find(
      action => action.intent.kind === 'sketch.edit',
    )?.intent;
    if (intent?.kind !== 'sketch.edit') return false;
    const current = this.host.resolveSourceRef(pending.sourceRef);
    if (
      !current ||
      current.file !== intent.sourceRef.file ||
      current.start !== intent.sourceRef.start ||
      current.end !== intent.sourceRef.end
    )
      return false;
    // The new compilation has not published its source refs yet. Resolve the
    // original edit's tracked ref, whose range already follows that edit.
    this.host.resumeEditGroup(pending.sourceRef.file, pending.undoGroup);
    return this.host.commit(
      {...intent, sourceRef: pending.sourceRef},
      pending.undoGroup,
    );
  }

  private cancelSynchronization(): void {
    const pending = this.pendingSynchronization;
    this.pendingSynchronization = undefined;
    if (pending)
      this.host.cancelEditGroup(pending.sourceRef.file, pending.undoGroup);
  }

  private async preview(
    id: number,
    position: SketchPosition,
    previous?: SketchDragPreview,
    mergeTarget?: SketchPointAddress,
  ): Promise<SketchDragPreview> {
    const revision = this.revision;
    const source =
      this.active?.definitionRef &&
      this.host.readSource(this.active.definitionRef);
    if (source === undefined || this.stale)
      throw new Error('Waiting for the updated sketch.');
    const {editable} = analyzeSketchSource(source);
    const continuation = previous?.continuation ?? previous;
    const layers = continuation
      ? [...this.layers.slice(0, -1), continuation.snapshot]
      : this.layers;
    const drag: SketchDrag = {
      id,
      position,
      editable,
      data: continuation?.data ?? this.data,
      reference: previous?.reference,
      mergeTarget,
    };
    // The zero-equation case is kernel-independent. Use the same numeric and
    // source-replay logic without waiting for the preceding edit's compilation.
    const solved = sketchDragRequiresSolver(
      previous?.reference
        ? [...layers.slice(0, -1), previous.reference]
        : layers,
    )
      ? await this.host.solve(layers, drag)
      : previewSketchDrag({solveSketchSnapshot}, layers, drag);
    if (revision !== this.revision)
      throw new Error('The sketch changed during this gesture.');
    return solved;
  }

  private get view(): SketchEditorView | undefined {
    if (!this.active) return;
    const source =
      this.active.definitionRef &&
      this.host.readSource(this.active.definitionRef);
    const parsed =
      source === undefined ? undefined : analyzeSketchSource(source);
    return {
      key: JSON.stringify([this.viewScope, this.active.id]),
      id: this.active.id,
      revision: this.revision,
      layers: this.layers,
      data: this.data,
      context: this.context,
      editable: parsed?.editable ?? new Map(),
      constraintValues: parsed?.constraintValues ?? new Map(),
      referenceable: new Set(Object.keys(this.active.references)),
      readOnlyReason: this.stale
        ? 'Last successful sketch · Editing unavailable until code compiles'
        : source === undefined
          ? 'This sketch has no editable inline tuple array.'
          : parsed?.reason,
    };
  }

  private commit(change: SketchChange, preview?: SketchSnapshot): boolean {
    const active = this.active;
    const expectedText =
      active?.definitionRef && this.host.readSource(active.definitionRef);
    if (!active?.definitionRef || expectedText === undefined || this.stale) {
      this.host.reportResult(
        change.kind,
        'The sketch source is no longer editable. Select the geometry again.',
      );
      return false;
    }
    const local = this.layers.at(-1)!;
    this.cancelSynchronization();
    const undoGroup =
      change.kind === 'dimension' ||
      change.kind === 'constrain' ||
      (change.kind === 'append' && change.constraints?.length)
        ? `sketch:${active.id}:${this.host.sourceVersion()}`
        : undefined;
    const committed = this.host.commit(
      {
        kind: 'sketch.edit',
        sourceRef: active.definitionRef,
        expectedText,
        layer: active.id,
        references: active.references,
        change,
      },
      undoGroup,
    );
    if (!committed) return false;
    this.revision++;
    if (undoGroup)
      this.pendingSynchronization = {
        sourceVersion: this.host.sourceVersion(),
        layer: active.id,
        sourceRef: active.definitionRef,
        undoGroup,
      };
    if (change.kind === 'dimension' || change.kind === 'constrain') {
      // Both literals and expressions use the project's actual solve. Keep the
      // last successful geometry and constraints together until it completes.
      this.stale = true;
      return true;
    }
    const addedConstraints =
      change.kind === 'append' ? (change.constraints ?? []) : [];
    const removed =
      change.kind === 'delete' || change.kind === 'trim' ? change.ids : [];
    const entries =
      change.kind === 'append' || change.kind === 'trim' ? change.entries : [];
    const data = change.kind === 'move' ? change.data : [];
    this.data = [
      ...this.data
        .filter(
          point =>
            !removed.includes(point.id) &&
            !(change.kind === 'move' && change.merge?.id === point.id),
        )
        .map(point => data.find(p => p.id === point.id) ?? point),
      ...entries.flatMap<SketchGeometryData>(([kind, id, values]) => {
        if (kind === 'point') return [{id, parameters: values}];
        if (kind === 'line') return [];
        const original =
          change.kind === 'trim'
            ? change.replacements.find(r => r.ids.includes(id))?.original
            : undefined;
        // Trim copies the authored radius, which may differ from its solved
        // value. Keep that same data for edits made before compilation returns.
        const parameters = original
          ? this.data.find(p => p.id === original.id)!.parameters
          : [values[1]];
        return [{id, parameters}];
      }),
    ];
    const additions = entries.map(sketchDraftEntity);
    const entities = [
      ...local.entities.flatMap(entity => {
        const replacement = additions.find(e => e.id === entity.id);
        if (replacement) return [replacement];
        if (removed.includes(entity.id)) return [];
        const parameters = data.find(p => p.id === entity.id)?.parameters;
        return [
          parameters ? withSketchEntityParameters(entity, parameters) : entity,
        ];
      }),
      ...additions.filter(
        entity => !local.entities.some(e => e.id === entity.id),
      ),
    ];
    const copiedConstraints: SketchConstraint<SketchPointAddress>[] = [];
    const constraints = local.constraints.flatMap(
      (constraint, index): SketchConstraint<SketchPointAddress>[] => {
        if (
          (change.kind === 'delete' || change.kind === 'trim') &&
          change.constraints.includes(index)
        )
          return [];
        const rewrite =
          change.kind === 'trim' &&
          change.constraintReplacements.find(c => c.index === index);
        if (!rewrite) return [constraint];
        const [kind, , value] = constraint;
        const replacements: SketchConstraint<SketchPointAddress>[] =
          rewrite.targets.map(
            target =>
              (value === undefined
                ? [kind, target]
                : [
                    kind,
                    target,
                    value,
                  ]) as SketchConstraint<SketchPointAddress>,
          );
        // The source resolver replaces the first target in place and appends
        // copies. Keep the same indices for another edit before compilation.
        copiedConstraints.push(...replacements.slice(1));
        return replacements.slice(0, 1);
      },
    );
    constraints.push(...copiedConstraints);
    constraints.push(...addedConstraints);
    this.layers = [
      ...this.layers.slice(0, -1),
      preview ?? {...local, entities, constraints},
    ];
    return true;
  }
}
