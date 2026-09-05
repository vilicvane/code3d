import type {SketchSnapshot, SourceRef} from '@code3d/core/tooling';
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
  private stale = false;

  constructor(
    container: HTMLElement,
    private readonly host: {
      readSource(ref: SourceRef): string | undefined;
      commit(intent: SketchEditIntent): boolean;
    },
  ) {
    this.editor = new SketchEditor(container, change => this.commit(change));
  }

  show(
    id: string | undefined,
    sketches: ReadonlyMap<string, CompiledSketch>,
  ): void {
    this.active = id ? sketches.get(id) : undefined;
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
    this.active = undefined;
    this.editor.hide();
  }
  invalidate(): void {
    this.stale = true;
    this.editor.cancel();
    this.render();
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
      movable: parsed?.movable ?? new Set(),
      referenceable: new Set(Object.keys(this.active.references)),
      readOnlyReason: this.stale
        ? 'Waiting for the updated sketch'
        : source === undefined
          ? 'This sketch has no editable inline tuple array.'
          : parsed?.reason,
    });
  }

  private commit(change: SketchChange): boolean {
    const active = this.active;
    const expectedText =
      active?.definitionRef && this.host.readSource(active.definitionRef);
    if (!active?.definitionRef || expectedText === undefined || this.stale)
      return false;
    const committed = this.host.commit({
      kind: 'sketch.edit',
      sourceRef: active.definitionRef,
      expectedText,
      layer: active.id,
      references: active.references,
      change,
    });
    if (!committed) return false;
    const local = this.layers.at(-1)!;
    const entities =
      change.kind === 'delete'
        ? local.entities.filter(e => !change.ids.includes(e.id))
        : change.kind === 'move'
          ? local.entities.map(e =>
              e.kind === 'point' && e.id === change.id
                ? {...e, position: change.position}
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
    this.layers = [...this.layers.slice(0, -1), {...local, entities}];
    this.render();
    return true;
  }
}
