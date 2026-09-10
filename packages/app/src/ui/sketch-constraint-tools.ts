import type {SketchChange, SketchDimensionValue} from '../tools/sketch-source';
import type {SketchConstraintAction} from '../tools/sketch-constraint-actions';
import {
  DrawingDimensions,
  type DrawingDimension,
} from '../tools/drawing-dimensions';
import {DrawingInputs} from './drawing-inputs';
import {SketchToolbar} from './sketch-toolbar';
import {sketchConstraintIcons} from './sketch-icons';
import type {SketchPointAddress} from '@code3d/core/tooling';
import {
  sketchConstraintDimensions,
  sketchConstraintNames,
} from '../tools/sketch-constraints';

/** Selection actions reuse drawing numeric entry and the same atomic source transaction. */
export class SketchConstraintTools {
  readonly root = document.createElement('div');
  private toolbar = new SketchToolbar('Selection constraints');
  private readonly inputs = new DrawingInputs(
    () => {},
    () => this.apply(),
    () => this.cancel(),
    {
      region: 'Constraint value',
      apply: 'Apply constraint',
      cancel: 'Cancel constraint',
    },
  );
  private actions: readonly SketchConstraintAction[] = [];
  private identity = '';
  private hovered?: SketchConstraintAction['kind'];
  private current?: {
    kind: SketchConstraintAction['kind'];
    field: DrawingDimension;
    value: number;
    create(value: SketchDimensionValue): SketchChange;
    dimensions: DrawingDimensions;
  };

  constructor(
    private readonly commit: (change: SketchChange) => boolean,
    private readonly focusCanvas: () => void,
    private readonly highlight: () => void,
  ) {
    this.root.className = 'sketch-constraint-tools';
    this.root.hidden = true;
    this.root.append(this.toolbar.root);
    const hover = (event: Event) => {
      const target =
        event.target instanceof Element ? event.target.closest('button') : null;
      this.hovered = this.actions.find(
        a => a.name === target?.getAttribute('aria-label'),
      )?.kind;
      this.highlight();
    };
    this.root.addEventListener('pointerover', hover);
    this.root.addEventListener('focusin', hover);
    for (const name of ['pointerleave', 'focusout'])
      this.root.addEventListener(name, () => {
        this.hovered = undefined;
        this.highlight();
      });
    this.inputs.root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.cancel();
      }
    });
  }

  related(layer: string, id: number): boolean {
    return (
      this.actions
        .find(a => a.kind === this.hovered)
        ?.related.some(
          (p: SketchPointAddress) => p.layer === layer && p.id === id,
        ) ?? false
    );
  }

  show(identity: string, actions: readonly SketchConstraintAction[]): void {
    const keys = actions.map(a => a.kind).join(',');
    if (
      identity !== this.identity ||
      keys !== this.actions.map(a => a.kind).join(',')
    ) {
      this.cancel();
      this.identity = identity;
      const toolbar = new SketchToolbar('Selection constraints');
      const group = toolbar.group('Constrain');
      for (const action of actions)
        toolbar.add(group, {
          name: action.name,
          title: action.title,
          icon: sketchConstraintIcons[action.kind],
          run: () => this.activate(action.kind),
        });
      this.toolbar.root.replaceWith(toolbar.root);
      this.toolbar = toolbar;
    }
    this.actions = actions;
    this.root.hidden = !actions.length;
    this.update();
  }

  private update(): void {
    this.toolbar.update(name => ({
      pressed:
        this.current?.kind === this.actions.find(a => a.name === name)!.kind ||
        this.actions.find(a => a.name === name)!.active,
      disabled: this.actions.find(a => a.name === name)!.disabled,
      title: this.actions.find(a => a.name === name)!.title,
    }));
  }

  cancel(): void {
    const focused = this.root.contains(document.activeElement);
    this.current = undefined;
    // Transfer focus while the form is still attached. Removing a focused
    // input fires blur with no related target, reentering sketch cancellation.
    if (focused) this.focusCanvas();
    this.inputs.hide();
    this.inputs.root.remove();
    this.update();
  }

  private activate(kind: SketchConstraintAction['kind']): void {
    const action = this.actions.find(a => a.kind === kind)!;
    if (!action.dimension || action.active) {
      this.cancel();
      this.commit(action.create());
      this.focusCanvas();
      return;
    }
    this.openValue(kind, action.value!, value => action.create(value));
  }

  edit(
    index: number,
    kind: SketchConstraintAction['kind'],
    source: string,
    value: number,
  ): void {
    // A local relation may target only read-only upstream points, in which
    // case the selection has no editable dimension tool to focus.
    if (!this.actions.find(action => action.kind === kind)?.dimension) return;
    this.openValue(
      kind,
      value,
      value => ({kind: 'dimension', index, value}),
      source,
    );
  }

  private openValue(
    kind: SketchConstraintAction['kind'],
    value: number,
    create: (value: SketchDimensionValue) => SketchChange,
    source?: string,
  ): void {
    const field = sketchConstraintDimensions[kind]!;
    const dimensions = new DrawingDimensions([field], undefined, true);
    // Edit the complete author expression, never its shortened evaluated label.
    // Adding still accepts an empty displayed default.
    if (source !== undefined) dimensions.set(field.id, source);
    this.current = {kind, field, value, create, dimensions};
    this.root.append(this.inputs.root);
    this.inputs.show(sketchConstraintNames[kind], dimensions, {
      [field.id]: value,
    });
    this.inputs.focusField();
    this.update();
  }

  private apply(): void {
    if (!this.current) return;
    const {field, value, create, dimensions} = this.current;
    const id = field.id;
    const error = dimensions.error(id);
    if (error) {
      this.inputs.report(error);
      return;
    }
    const text = dimensions.text(id).trim();
    if (this.commit(create(text ? (dimensions.value(id) ?? text) : value))) {
      this.cancel();
      this.focusCanvas();
    } else this.inputs.report('The sketch changed; select the geometry again.');
  }
}
