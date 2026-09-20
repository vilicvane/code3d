import {compareStructural, reaction, type IReactionDisposer} from 'mobx';
import type {ModelInputs} from '../model/inputs';
import type {DockPanelCoordinator, DockPanelController} from './dock-panels';

type InputRow = {
  root: HTMLDivElement;
  input: HTMLInputElement;
  slider: HTMLInputElement;
  value: number;
};

/** Valid input events update the model while unfinished text and DOM focus survive frames. */
export class ModelInputsPanel {
  private readonly root = document.createElement('aside');
  private readonly fields = document.createElement('div');
  private readonly count = document.createElement('span');
  private readonly rows = new Map<string, InputRow>();
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
        if (control === row.slider) row.input.value = control.value;
        const valid = row.input.validity.valid;
        row.input.setAttribute('aria-invalid', String(!valid));
        if (!valid) return;
        row.slider.value = row.input.value;
        // Preserve the typed representation (e.g. "5.") when accepting its numeric value.
        row.value = row.input.valueAsNumber;
        inputs.set(control.name, row.value);
      },
      {signal},
    );
    form.addEventListener('submit', event => event.preventDefault(), {signal});
    reset.addEventListener(
      'click',
      () => {
        options.onEdit();
        inputs.reset();
        for (const field of inputs.fields) {
          const row = this.rows.get(field.name)!;
          row.input.value = row.slider.value = String(field.value);
          row.input.setAttribute('aria-invalid', 'false');
        }
      },
      {signal},
    );
    this.stop = [
      reaction(
        () => ({fields: inputs.fields, source: options.sourceInput()}),
        ({fields, source}, previous) => {
          this.render(fields);
          for (const [name, row] of this.rows)
            row.input.classList.toggle('source-active', name === source);
          if (source !== undefined && source !== previous?.source) {
            this.panel.reveal();
            this.rows.get(source)?.root.scrollIntoView({block: 'nearest'});
          }
        },
        {fireImmediately: true, equals: compareStructural},
      ),
    ];
  }

  focusSourceInput(): boolean {
    const name = this.options.sourceInput();
    const row = name === undefined ? undefined : this.rows.get(name);
    if (!row) return false;
    this.panel.reveal();
    row.input.focus();
    row.input.select();
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
    fields.forEach((field, index) => {
      let row = this.rows.get(field.name);
      if (!row) {
        const root = document.createElement('div');
        root.className = 'model-input-field';
        const label = document.createElement('label');
        label.className = 'model-input-label';
        const name = document.createElement('span');
        name.textContent = field.name;
        const control = document.createElement('div');
        control.className = 'model-input-control';
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.required = true;
        input.name = field.name;
        input.setAttribute('aria-label', field.name);
        input.value = String(field.value);
        const hint = document.createElement('kbd');
        hint.className = 'model-input-tab-hint';
        hint.textContent = 'Tab';
        hint.setAttribute('aria-hidden', 'true');
        control.append(input, hint);
        label.append(name, control);
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.name = field.name;
        slider.tabIndex = -1;
        slider.setAttribute('aria-label', `${field.name} slider`);
        root.append(label, slider);
        row = {root, input, slider, value: field.value};
        this.rows.set(field.name, row);
      }
      row.input.min = row.slider.min =
        field.min === undefined ? '' : String(field.min);
      row.input.max = row.slider.max =
        field.max === undefined ? '' : String(field.max);
      row.input.step = row.slider.step = String(field.step ?? 'any');
      row.input.defaultValue = String(field.defaultValue);
      row.slider.hidden = field.min === undefined || field.max === undefined;
      if (row.value !== field.value) {
        row.input.value = String(field.value);
        row.value = field.value;
      }
      row.input.setAttribute('aria-invalid', String(!row.input.validity.valid));
      if (row.input.validity.valid) row.slider.value = row.input.value;
      if (this.fields.children[index] !== row.root)
        this.fields.insertBefore(row.root, this.fields.children[index] ?? null);
    });
  }

  dispose(): void {
    this.stop.forEach(stop => stop());
    this.events.abort();
    this.docks.unregister(this.panel);
    this.rows.clear();
    this.root.remove();
  }
}
