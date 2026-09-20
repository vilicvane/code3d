import {reaction, type IReactionDisposer} from 'mobx';
import type {ModelInputs} from '../model/inputs';
import type {DockPanelCoordinator, DockPanelController} from './dock-panels';

type InputField = ModelInputs['fields'][number];

/** Own a field's native draft and the last numeric value accepted by the model. */
class NumericInputField {
  readonly root = document.createElement('div');
  private readonly input = document.createElement('input');
  private readonly slider = document.createElement('input');
  private acceptedValue?: number;

  constructor(name: string) {
    this.root.className = 'model-input-field';
    const label = document.createElement('label');
    label.className = 'model-input-label';
    const title = document.createElement('span');
    title.textContent = name;
    const control = document.createElement('div');
    control.className = 'model-input-control';
    this.input.type = 'number';
    this.input.required = true;
    this.input.name = name;
    this.input.setAttribute('aria-label', name);
    const hint = document.createElement('kbd');
    hint.className = 'model-input-tab-hint';
    hint.textContent = 'Tab';
    hint.setAttribute('aria-hidden', 'true');
    control.append(this.input, hint);
    label.append(title, control);
    this.slider.type = 'range';
    this.slider.name = name;
    this.slider.tabIndex = -1;
    this.slider.setAttribute('aria-label', `${name} slider`);
    this.root.append(label, this.slider);
  }

  render(field: InputField): void {
    this.input.min = this.slider.min =
      field.min === undefined ? '' : String(field.min);
    this.input.max = this.slider.max =
      field.max === undefined ? '' : String(field.max);
    this.input.step = this.slider.step = String(field.step ?? 'any');
    this.input.defaultValue = String(field.defaultValue);
    this.slider.hidden = field.min === undefined || field.max === undefined;
    if (this.acceptedValue !== field.value) this.resetDraft(field.value);
    else this.syncDraft();
  }

  accept(control: HTMLInputElement): number | undefined {
    if (control === this.slider) this.input.value = control.value;
    const value = this.syncDraft();
    // Record acceptance before publishing the model value, so a reaction does
    // not replace the user's equivalent text (e.g. "5.") while typing.
    if (value !== undefined) this.acceptedValue = value;
    return value;
  }

  resetDraft(value: number): void {
    this.acceptedValue = value;
    this.input.value = String(value);
    this.syncDraft();
  }

  highlight(active: boolean): void {
    this.input.classList.toggle('source-active', active);
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  private syncDraft(): number | undefined {
    const valid = this.input.validity.valid;
    this.input.setAttribute('aria-invalid', String(!valid));
    if (!valid) return;
    this.slider.value = this.input.value;
    return this.input.valueAsNumber;
  }
}

/** Valid input events update the model while unfinished text and DOM focus survive frames. */
export class ModelInputsPanel {
  private readonly root = document.createElement('aside');
  private readonly fields = document.createElement('div');
  private readonly count = document.createElement('span');
  private readonly rows = new Map<string, NumericInputField>();
  private readonly events = new AbortController();
  private readonly panel: DockPanelController;
  private readonly stop: IReactionDisposer[];

  constructor(
    container: HTMLElement,
    private readonly docks: DockPanelCoordinator,
    inputs: ModelInputs,
    private readonly options: {
      sourceInput(): string | undefined;
      onEdit(): void;
    },
  ) {
    this.root.className = 'dock-panel model-inputs-panel';
    this.root.setAttribute('aria-label', 'Model inputs');
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'dock-panel-handle';
    const title = document.createElement('span');
    title.textContent = 'INPUTS';
    const meta = document.createElement('span');
    meta.className = 'dock-panel-handle-meta';
    meta.append(this.count);
    handle.append(title, meta);
    const form = document.createElement('form');
    form.id = 'model-inputs';
    form.className = 'dock-panel-body model-inputs';
    this.fields.className = 'model-input-fields';
    const actions = document.createElement('div');
    actions.className = 'model-input-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset';
    reset.setAttribute('aria-label', 'Reset inputs');
    actions.append(reset);
    form.append(this.fields, actions);
    this.root.append(handle, form);
    container.prepend(this.root);
    this.panel = docks.register({root: this.root, handle, body: form});

    const {signal} = this.events;
    form.addEventListener('focusin', () => options.onEdit(), {signal});
    this.fields.addEventListener(
      'input',
      event => {
        const control = event.target as HTMLInputElement;
        const row = this.rows.get(control.name)!;
        options.onEdit();
        const value = row.accept(control);
        if (value !== undefined) inputs.set(control.name, value);
      },
      {signal},
    );
    form.addEventListener('submit', event => event.preventDefault(), {signal});
    reset.addEventListener(
      'click',
      () => {
        options.onEdit();
        inputs.reset();
        for (const field of inputs.fields)
          this.rows.get(field.name)!.resetDraft(field.value);
      },
      {signal},
    );
    this.stop = [
      reaction(
        () => inputs.fields,
        fields => this.render(fields),
        {fireImmediately: true},
      ),
      reaction(
        options.sourceInput,
        source => {
          for (const [name, row] of this.rows) row.highlight(name === source);
          const row = source === undefined ? undefined : this.rows.get(source);
          if (row) this.reveal(row);
        },
        {fireImmediately: true},
      ),
    ];
  }

  focusSourceInput(): boolean {
    const name = this.options.sourceInput();
    const row = name === undefined ? undefined : this.rows.get(name);
    if (!row) return false;
    this.reveal(row);
    row.focus();
    return true;
  }

  private render(fields: ModelInputs['fields']): void {
    this.root.hidden = fields.length === 0;
    this.count.textContent = String(fields.length);
    const names = new Set(fields.map(field => field.name));
    for (const [name, row] of this.rows) {
      if (names.has(name)) continue;
      row.root.remove();
      this.rows.delete(name);
    }
    const source = this.options.sourceInput();
    fields.forEach((field, index) => {
      let row = this.rows.get(field.name);
      const added = !row;
      if (!row) {
        row = new NumericInputField(field.name);
        this.rows.set(field.name, row);
      }
      row.render(field);
      row.highlight(field.name === source);
      if (this.fields.children[index] !== row.root)
        this.fields.insertBefore(row.root, this.fields.children[index] ?? null);
      // A declaration can arrive after the caret reaction. Applying its current
      // highlight here keeps the subscriptions independent of their order.
      if (added && field.name === source) this.reveal(row);
    });
  }

  private reveal(row: NumericInputField): void {
    this.panel.reveal();
    row.root.scrollIntoView({block: 'nearest'});
  }

  dispose(): void {
    this.stop.forEach(stop => stop());
    this.events.abort();
    this.docks.unregister(this.panel);
    this.rows.clear();
    this.root.remove();
  }
}
