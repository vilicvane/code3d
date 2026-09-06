import {Check, X} from 'lucide';
import type {DrawingDimensions} from '../tools/drawing-dimensions';
import {createIcon} from './icon';

/** Reusable numeric entry for an active drawing command, not a second model. */
export class DrawingInputs {
  readonly root = document.createElement('form');
  private readonly title = document.createElement('span');
  private readonly titleText = document.createTextNode('');
  private readonly fields = document.createElement('div');
  private readonly error = document.createElement('span');
  private readonly errorText = document.createTextNode('');
  private dimensions?: DrawingDimensions;
  private inputs: HTMLInputElement[] = [];

  constructor(
    private readonly changed: () => void,
    apply: () => void,
    cancel: () => void,
  ) {
    this.root.className = 'drawing-inputs';
    this.root.setAttribute('aria-label', 'Drawing dimensions');
    this.root.hidden = true;
    this.title.className = 'drawing-input-title';
    this.title.append(this.titleText);
    this.fields.className = 'drawing-input-fields';
    this.error.className = 'drawing-input-error';
    this.error.setAttribute('role', 'alert');
    this.error.append(this.errorText);
    this.root.append(this.title, this.fields);
    for (const [label, icon, action] of [
      ['Apply drawing step', Check, apply],
      ['Cancel drawing', X, cancel],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.title = label;
      button.append(createIcon(icon));
      button.addEventListener('click', action);
      this.root.append(button);
    }
    this.root.append(this.error);
    this.root.addEventListener('submit', event => {
      event.preventDefault();
      apply();
    });
  }

  show(
    title: string,
    dimensions: DrawingDimensions,
    measurements: Readonly<Record<string, number>>,
  ): void {
    this.root.hidden = false;
    if (this.titleText.data !== title) this.titleText.data = title;
    if (this.dimensions !== dimensions) {
      this.dimensions = dimensions;
      this.errorText.data = '';
      this.fields.replaceChildren();
      this.inputs = dimensions.definitions.map(field => {
        const label = document.createElement('label');
        const name = document.createElement('span');
        name.textContent = field.label;
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('aria-label', field.label);
        input.dataset.dimension = field.id;
        input.addEventListener('keydown', event => {
          // Keep native text history; the App's global shortcut otherwise
          // interprets input undo as a source-model undo.
          if (
            (event.ctrlKey || event.metaKey) &&
            (event.code === 'KeyZ' || event.code === 'KeyY')
          )
            event.stopPropagation();
        });
        input.addEventListener('input', () => {
          dimensions.set(field.id, input.value);
          this.clearError();
          this.changed();
        });
        label.append(name, input);
        if (field.unit) label.append(field.unit);
        this.fields.append(label);
        return input;
      });
    }
    for (const input of this.inputs) {
      const id = input.dataset.dimension!;
      const placeholder = String(Number(measurements[id].toPrecision(8)));
      // Reassigning an unchanged, visible placeholder recreates Chrome's
      // internal text node and splits typing history in the sibling input.
      if (!input.value && input.placeholder !== placeholder)
        input.placeholder = placeholder;
      // Native input already matches the draft. Only a command changing the
      // model (e.g. an axis lock clearing Angle) may replace an active field.
      if (input.value !== dimensions.text(id))
        input.value = dimensions.text(id);
      input.dataset.entered = String(dimensions.text(id).trim() !== '');
    }
  }

  hide(): void {
    this.root.hidden = true;
    this.dimensions = undefined;
  }

  focusField(reverse = false): void {
    const current = this.inputs.indexOf(
      document.activeElement as HTMLInputElement,
    );
    const index =
      current < 0
        ? reverse
          ? this.inputs.length - 1
          : 0
        : (current + (reverse ? -1 : 1) + this.inputs.length) %
          this.inputs.length;
    this.inputs[index].focus({preventScroll: true});
    this.inputs[index].select();
  }

  report(message: string): void {
    this.errorText.data = message;
    for (const input of this.inputs)
      input.setAttribute(
        'aria-invalid',
        String(!!this.dimensions?.error(input.dataset.dimension!)),
      );
    this.inputs
      .find(input => input.getAttribute('aria-invalid') === 'true')
      ?.focus({preventScroll: true});
  }

  clearError(): void {
    this.errorText.data = '';
    for (const input of this.inputs) input.removeAttribute('aria-invalid');
  }
}
