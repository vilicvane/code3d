import type {
  SketchSnapshot,
  SketchPosition,
  SketchConstraint,
  SketchPointAddress,
  SourceRef,
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
import {SketchEditor} from '../ui/sketch-editor';
import {
  analyzeSketchSource,
  isNumericSketchConstraint,
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

  constructor(
    container: HTMLElement,
    private readonly host: {
      onGridStepChange?(step: number | undefined): void;
      readSource(ref: SourceRef): string | undefined;
      resolveSourceRef(ref: SourceRef): SourceRef | undefined;
      commit(intent: SketchEditIntent): boolean;
      solve(
        layers: readonly SketchSnapshot[],
        drag: SketchDrag,
      ): Promise<SketchDragPreview>;
    },
  ) {
    this.editor = new SketchEditor(
      container,
      (change, preview) => this.commit(change, preview),
      (id, position, previous, mergeTarget) =>
        this.preview(id, position, previous, mergeTarget),
      host.onGridStepChange,
    );
  }

  show(
    id: string | undefined,
    sketches: ReadonlyMap<string, CompiledSketch>,
    selectionRef: SourceRef | undefined,
  ): void {
    this.revision++;
    this.active = id ? sketches.get(id) : undefined;
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
    this.render();
  }

  get diagnosticScope(): readonly CompiledSketch[] | undefined {
    return this.active ? this.sourceLayers : undefined;
  }

  get hasTarget(): boolean {
    return this.active !== undefined;
  }

  get isStale(): boolean {
    return !!this.active && this.stale;
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

  /** Keep an explicitly selected last-good view only when evaluation cannot reach it.
   * An error after a successful sketch must not put it through a read-only state:
   * that would cancel the active tool even though this sketch remains editable.
   */
  retain(
    diagnostic: ModelDiagnostic | undefined,
    cursor: {file: string; offset: number} | undefined,
    sketches: ReadonlyMap<string, CompiledSketch>,
  ): boolean {
    const selection =
      this.selectionRef && this.host.resolveSourceRef(this.selectionRef);
    if (
      !this.active ||
      sketches.has(this.active.id) ||
      !diagnostic ||
      !cursor ||
      !selection ||
      selection.file !== cursor.file ||
      cursor.offset < selection.start ||
      cursor.offset > selection.end
    )
      return false;
    this.selectionRef = selection;
    this.sourceLayers = this.sourceLayers.map(layer => ({
      ...layer,
      definitionRef:
        layer.definitionRef && this.host.resolveSourceRef(layer.definitionRef),
    }));
    this.active = this.sourceLayers.at(-1);
    this.stale = true;
    this.render();
    return true;
  }

  hide(): void {
    this.revision++;
    this.active = undefined;
    this.sourceLayers = [];
    this.selectionRef = undefined;
    this.editor.hide();
  }
  invalidate(): void {
    this.revision++;
    this.stale = true;
    this.editor.cancel();
    this.render();
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

  private render(): void {
    if (!this.active) {
      this.editor.hide();
      return;
    }
    const source =
      this.active.definitionRef &&
      this.host.readSource(this.active.definitionRef);
    const parsed =
      source === undefined ? undefined : analyzeSketchSource(source);
    this.editor.show({
      id: this.active.id,
      revision: this.revision,
      layers: this.layers,
      data: this.data,
      editable: parsed?.editable ?? new Map(),
      constraintValues: parsed?.constraintValues ?? new Map(),
      referenceable: new Set(Object.keys(this.active.references)),
      readOnlyReason: this.stale
        ? 'Last successful sketch · Editing unavailable until code compiles'
        : source === undefined
          ? 'This sketch has no editable inline tuple array.'
          : parsed?.reason,
    });
  }

  private commit(change: SketchChange, preview?: SketchSnapshot): boolean {
    const active = this.active;
    const expectedText =
      active?.definitionRef && this.host.readSource(active.definitionRef);
    if (!active?.definitionRef || expectedText === undefined || this.stale)
      return false;
    const local = this.layers.at(-1)!;
    const committed = this.host.commit({
      kind: 'sketch.edit',
      sourceRef: active.definitionRef,
      expectedText,
      layer: active.id,
      references: active.references,
      change,
    });
    if (!committed) return false;
    this.revision++;
    const changedDimension =
      change.kind === 'dimension' ? change.value : undefined;
    const addedConstraints =
      change.kind === 'constrain' || change.kind === 'append'
        ? (change.constraints ?? [])
        : [];
    if (
      typeof changedDimension === 'string' ||
      !addedConstraints.every(isNumericSketchConstraint)
    ) {
      // Source expressions are evaluated in the real project scope by the next
      // compile. Do not publish a snapshot with a guessed numeric constraint.
      this.stale = true;
      this.render();
      return true;
    }
    const removed =
      change.kind === 'delete' || change.kind === 'trim' ? change.ids : [];
    const entries =
      change.kind === 'append' || change.kind === 'trim' ? change.entries : [];
    const data =
      change.kind === 'move' || change.kind === 'constrain' ? change.data : [];
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
        if (change.kind === 'dimension' && change.index === index)
          return [
            [
              constraint[0],
              constraint[1],
              changedDimension!,
            ] as SketchConstraint<SketchPointAddress>,
          ];
        if (
          ((change.kind === 'delete' || change.kind === 'trim') &&
            change.constraints.includes(index)) ||
          (change.kind === 'constrain' &&
            change.removedConstraints?.includes(index))
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
    this.render();
    return true;
  }
}
