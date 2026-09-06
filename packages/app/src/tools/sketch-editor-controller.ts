import type {
  SketchSnapshot,
  SketchPosition,
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
    if (change.kind === 'delete') {
      const ids = change.ids;
      const pointDeleted = (p: {layer: string; id: number}) =>
        p.layer === local.id && ids.includes(p.id);
      const constraints = local.constraints.flatMap(([kind, data], index) => {
        let deleted: boolean;
        switch (kind) {
          case 'fixed':
            deleted = pointDeleted(data);
            break;
          case 'horizontal':
          case 'vertical':
            deleted = ids.includes(data);
            break;
          case 'coincident':
          case 'midpoint':
            deleted = data.some(pointDeleted);
            break;
          case 'x':
          case 'y':
            deleted = pointDeleted(data[0]);
            break;
          case 'length':
          case 'angle':
            deleted = ids.includes(data[0]);
            break;
        }
        return deleted ? [index] : [];
      });
      change = {...change, constraints};
    }
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
    this.data =
      change.kind === 'append'
        ? [
            ...this.data,
            ...change.entries.flatMap(([kind, id, position]) =>
              kind === 'point' ? [{id, position}] : [],
            ),
          ]
        : change.kind === 'delete'
          ? this.data.filter(point => !change.ids.includes(point.id))
          : this.data.map(
              point => change.positions.find(p => p.id === point.id) ?? point,
            );
    const entities =
      change.kind === 'delete'
        ? local.entities.filter(e => !change.ids.includes(e.id))
        : change.kind === 'move'
          ? local.entities.map(e =>
              e.kind === 'point' && change.positions.some(p => p.id === e.id)
                ? {
                    ...e,
                    position: change.positions.find(p => p.id === e.id)!
                      .position,
                  }
                : e,
            )
          : [
              ...local.entities,
              ...change.entries.map(([kind, id, data]) =>
                kind === 'point'
                  ? {kind, id, position: data}
                  : {kind, id, points: data},
              ),
            ];
    const constraints =
      change.kind === 'append'
        ? [...local.constraints, ...(change.constraints ?? [])]
        : change.kind === 'delete'
          ? local.constraints.filter((_, i) => !change.constraints?.includes(i))
          : local.constraints;
    this.layers = [
      ...this.layers.slice(0, -1),
      preview ?? {...local, entities, constraints},
    ];
    this.render();
    return true;
  }
}
