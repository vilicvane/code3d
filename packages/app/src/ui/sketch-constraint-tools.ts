import type {SketchChange} from '../tools/sketch-source';
import type {SketchConstraintAction} from '../tools/sketch-constraint-actions';
import {DrawingDimensions} from '../tools/drawing-dimensions';
import {DrawingInputs} from './drawing-inputs';
import {SketchToolbar} from './sketch-toolbar';
import {sketchConstraintIcons} from './sketch-constraints';

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
    action: SketchConstraintAction;
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
      this.inputs.hide();
      this.inputs.root.remove();
      this.current = undefined;
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
        this.current?.action.name === name ||
        this.actions.find(a => a.name === name)!.active,
      disabled: this.actions.find(a => a.name === name)!.disabled,
      title: this.actions.find(a => a.name === name)!.title,
    }));
  }

  cancel(): void {
    const focused = this.root.contains(document.activeElement);
    this.current = undefined;
    this.inputs.hide();
    if (focused) this.focusCanvas();
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
    const dimensions = new DrawingDimensions([action.dimension]);
    // Empty entry accepts the displayed value; native typing/undo stays intact.
    this.current = {action, dimensions};
    this.root.append(this.inputs.root);
    this.inputs.show(action.name, dimensions, {
      [action.dimension.id]: action.value!,
    });
    this.inputs.focusField();
    this.update();
  }

  private apply(): void {
    if (!this.current) return;
    const {action, dimensions} = this.current;
    const id = action.dimension!.id;
    const error = dimensions.error(id);
    if (error) {
      this.inputs.report(error);
      return;
    }
    if (this.commit(action.create(dimensions.value(id)))) {
      this.cancel();
      this.focusCanvas();
    } else this.inputs.report('The sketch changed; select the geometry again.');
  }
}
