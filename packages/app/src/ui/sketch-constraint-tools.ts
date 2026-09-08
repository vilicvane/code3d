import type {SketchChange} from '../tools/sketch-source';
import type {SketchConstraintAction} from '../tools/sketch-constraint-actions';
import {
  DrawingDimensions,
  type DrawingDimension,
} from '../tools/drawing-dimensions';
import {DrawingInputs} from './drawing-inputs';
import {SketchToolbar} from './sketch-toolbar';
import {sketchConstraintIcons} from './sketch-icons';
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
  private current?: {
    kind: SketchConstraintAction['kind'];
    field: DrawingDimension;
    value: number;
    create(value: number): SketchChange;
    dimensions: DrawingDimensions;
  };

  constructor(
    private readonly commit: (change: SketchChange) => boolean,
    private readonly focusCanvas: () => void,
  ) {
    this.root.className = 'sketch-constraint-tools';
    this.root.hidden = true;
    this.root.append(this.toolbar.root);
    this.inputs.root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.cancel();
      }
    });
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
    if (!action.dimension || action.active === true) {
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
    value: number,
  ): void {
    // A local relation may target only read-only upstream points, in which
    // case the selection has no editable dimension tool to focus.
    if (!this.actions.find(action => action.kind === kind)?.dimension) return;
    this.openValue(
      kind,
      value,
      value => ({kind: 'dimension', index, value}),
      true,
    );
  }

  private openValue(
    kind: SketchConstraintAction['kind'],
    value: number,
    create: (value: number) => SketchChange,
    editing = false,
  ): void {
    const field = sketchConstraintDimensions[kind]!;
    const dimensions = new DrawingDimensions([field]);
    // Editing starts with the complete authored number selected, never the
    // shortened display label. Adding still accepts an empty displayed default.
    if (editing) dimensions.set(field.id, String(value));
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
    if (this.commit(create(dimensions.value(id) ?? value))) {
      this.cancel();
      this.focusCanvas();
    } else this.inputs.report('The sketch changed; select the geometry again.');
  }
}
