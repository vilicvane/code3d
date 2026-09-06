import type {
  SketchSnapshot,
  SketchPosition,
  SketchConstraint,
  SketchPointAddress,
  SourceRef,
} from '@code3d/core/tooling';
import {solveSketchSnapshot} from '@code3d/core/tooling';
import {
  previewSketchDrag,
  type SketchDrag,
  type SketchDragPreview,
  type SketchPointData,
} from '../model/sketch-drag';
import type {CompiledSketch} from '../model/sketch-trace';
import {SketchEditor} from '../ui/sketch-editor';
import {
  analyzeSketchSource,
  type SketchChange,
  type SketchEditIntent,
} from './sketch-source';

/** Keeps successful source transactions visible while recompilation is pending. */
export class SketchEditorController {
  private readonly editor: SketchEditor;
  private active?: CompiledSketch;
  private layers: readonly SketchSnapshot[] = [];
  private data: readonly SketchPointData[] = [];
  private stale = false;
  private revision = 0;

  constructor(
    container: HTMLElement,
    private readonly host: {
      readSource(ref: SourceRef): string | undefined;
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
      (id, position, previous) => this.preview(id, position, previous),
    );
  }

  show(
    id: string | undefined,
    sketches: ReadonlyMap<string, CompiledSketch>,
  ): void {
    this.revision++;
    this.active = id ? sketches.get(id) : undefined;
    this.data = this.active?.data ?? [];
    this.stale = false;
    const layers: SketchSnapshot[] = [];
    for (
      let layer: SketchSnapshot | undefined = this.active;
      layer;
      layer = layer.base ? sketches.get(layer.base) : undefined
    )
      layers.unshift(layer);
    this.layers = layers;
    this.render();
  }

  hide(): void {
    this.revision++;
    this.active = undefined;
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
  ): Promise<SketchDragPreview> {
    const revision = this.revision;
    const source =
      this.active?.definitionRef &&
      this.host.readSource(this.active.definitionRef);
    if (source === undefined || this.stale)
      throw new Error('Waiting for the updated sketch.');
    const {editable} = analyzeSketchSource(source);
    const layers = previous
      ? [...this.layers.slice(0, -1), previous.snapshot]
      : this.layers;
    const drag: SketchDrag = {
      id,
      position,
      editable,
      data: previous?.data ?? this.data,
    };
    // The zero-equation case is kernel-independent. Use the same numeric and
    // source-replay logic without waiting for the preceding edit's compilation.
    const solved = layers.at(-1)!.constraints.length
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
      layers: this.layers,
      data: this.data,
      editable: parsed?.editable ?? new Map(),
      referenceable: new Set(Object.keys(this.active.references)),
      readOnlyReason: this.stale
        ? 'Waiting for the updated sketch'
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
    const removed =
      change.kind === 'delete' || change.kind === 'trim' ? change.ids : [];
    const entries =
      change.kind === 'append' || change.kind === 'trim' ? change.entries : [];
    const positions = change.kind === 'move' ? change.positions : [];
    this.data = [
      ...this.data
        .filter(point => !removed.includes(point.id))
        .map(point => positions.find(p => p.id === point.id) ?? point),
      ...entries.flatMap(([kind, id, position]) =>
        kind === 'point' ? [{id, position}] : [],
      ),
    ];
    const additions: SketchSnapshot['entities'] = entries.map(
      ([kind, id, data]) =>
        kind === 'point'
          ? {kind, id, position: data}
          : {kind, id, points: data},
    );
    const entities = [
      ...local.entities.flatMap(entity => {
        const replacement = additions.find(e => e.id === entity.id);
        if (replacement) return [replacement];
        if (removed.includes(entity.id)) return [];
        const position =
          entity.kind === 'point' &&
          positions.find(p => p.id === entity.id)?.position;
        return [position ? {...entity, position} : entity];
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
          change.lineConstraints.find(c => c.index === index);
        if (!rewrite) return [constraint];
        const [kind, data] = constraint;
        const replacements: SketchConstraint<SketchPointAddress>[] =
          kind === 'horizontal' || kind === 'vertical'
            ? rewrite.lines.map(id => [kind, id])
            : kind === 'length' || kind === 'angle'
              ? rewrite.lines.map(id => [kind, [id, data[1]]])
              : [constraint];
        // The source resolver replaces the first target in place and appends
        // copies. Keep the same indices for another edit before compilation.
        copiedConstraints.push(...replacements.slice(1));
        return replacements.slice(0, 1);
      },
    );
    constraints.push(...copiedConstraints);
    if (change.kind === 'append')
      constraints.push(...(change.constraints ?? []));
    this.layers = [
      ...this.layers.slice(0, -1),
      preview ?? {...local, entities, constraints},
    ];
    this.render();
    return true;
  }
}
