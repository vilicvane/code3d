export type ContextualToolParameterView = Readonly<{
  name: string;
  label: string;
  value?: number;
  placeholder?: string;
  step: number;
  min?: number;
  max?: number;
  invalid?: boolean;
  disabled?: boolean;
}>;

export type ContextualToolActionView = Readonly<{
  id: string;
  label: string;
  disabled?: boolean;
}>;

export type ContextualToolPanelView = Readonly<{
  id: string;
  title: string;
  meta?: string;
  parameters: readonly ContextualToolParameterView[];
  selection?: Readonly<{
    label: string;
    summary: string;
  }>;
  actions: readonly ContextualToolActionView[];
}>;

type ContextualToolPanelOptions = Readonly<{
  onParameterInput(name: string, value: number | undefined): void;
  onParameterCommit(name: string, value: number | undefined): void;
  onAction(id: string): void;
}>;

type ParameterControl = Readonly<{
  field: HTMLLabelElement;
  label: HTMLSpanElement;
  input: HTMLInputElement;
}>;

export class ContextualToolPanel {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly parameterFields: HTMLElement;
  private readonly selectionField: HTMLElement;
  private readonly selectionLabel: HTMLElement;
  private readonly selectionSummary: HTMLOutputElement;
  private readonly actions: HTMLElement;
  private readonly controls = new Map<string, ParameterControl>();
  private activeViewId?: string;

  constructor(
    container: HTMLElement,
    private readonly options: ContextualToolPanelOptions,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'contextual-tool-panel';
    this.root.setAttribute('aria-label', 'Contextual tool');
    this.root.hidden = true;

    const header = document.createElement('header');
    header.className = 'contextual-tool-header';
    this.title = document.createElement('strong');
    this.meta = document.createElement('span');
    header.append(this.title, this.meta);

    this.parameterFields = document.createElement('div');
    this.parameterFields.className = 'contextual-tool-parameters';

    this.selectionField = document.createElement('div');
    this.selectionField.className = 'contextual-tool-field';
    this.selectionLabel = document.createElement('span');
    this.selectionSummary = document.createElement('output');
    this.selectionField.append(this.selectionLabel, this.selectionSummary);

    this.actions = document.createElement('div');
    this.actions.className = 'contextual-tool-actions';
    this.root.append(
      header,
      this.parameterFields,
      this.selectionField,
      this.actions,
    );
    container.append(this.root);
  }

  show(view: ContextualToolPanelView, forceParameterValues = false): void {
    const structureChanged =
      this.activeViewId !== view.id ||
      !sameNames([...this.controls.keys()], view.parameters);
    this.activeViewId = view.id;
    this.title.textContent = view.title;
    this.meta.textContent = view.meta ?? '';
    this.meta.hidden = !view.meta;
    if (structureChanged) this.rebuildParameterControls(view.parameters);
    view.parameters.forEach(parameter =>
      this.updateParameterControl(parameter, forceParameterValues),
    );
    this.selectionField.hidden = !view.selection;
    if (view.selection) {
      this.selectionLabel.textContent = view.selection.label;
      this.selectionSummary.textContent = view.selection.summary;
    }
    this.renderActions(view.actions);
    this.root.hidden = false;
  }

  hide(): boolean {
    if (this.root.hidden) return false;
    this.root.hidden = true;
    this.activeViewId = undefined;
    return true;
  }

  setInvalid(name: string, invalid: boolean): void {
    this.controls
      .get(name)
      ?.input.setAttribute('aria-invalid', String(invalid));
  }

  private rebuildParameterControls(
    parameters: readonly ContextualToolParameterView[],
  ): void {
    this.controls.clear();
    this.parameterFields.replaceChildren();
    parameters.forEach(parameter => {
      const field = document.createElement('label');
      field.className = 'contextual-tool-field contextual-tool-parameter';
      const label = document.createElement('span');
      const control = document.createElement('div');
      control.className = 'contextual-tool-parameter-control';
      const input = document.createElement('input');
      input.type = 'number';
      input.inputMode = 'decimal';
      input.dataset.parameter = parameter.name;
      control.append(input);
      field.append(label, control);
      this.parameterFields.append(field);
      this.controls.set(parameter.name, {field, label, input});

      let selectOnPointerUp = false;
      input.addEventListener('input', () =>
        this.options.onParameterInput(parameter.name, finiteInputValue(input)),
      );
      input.addEventListener('change', () =>
        this.options.onParameterCommit(parameter.name, finiteInputValue(input)),
      );
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        this.options.onParameterCommit(parameter.name, finiteInputValue(input));
        event.preventDefault();
      });
      input.addEventListener('pointerdown', () => {
        selectOnPointerUp = document.activeElement !== input;
      });
      input.addEventListener('pointerup', event => {
        if (!selectOnPointerUp) return;
        selectOnPointerUp = false;
        event.preventDefault();
        input.select();
      });
      input.addEventListener('focus', () => input.select());
      input.addEventListener('blur', () => {
        selectOnPointerUp = false;
      });
    });
  }

  private updateParameterControl(
    parameter: ContextualToolParameterView,
    forceValue: boolean,
  ): void {
    const control = this.controls.get(parameter.name)!;
    control.label.textContent = parameter.label.toUpperCase();
    control.input.step = String(parameter.step);
    setOptionalNumberAttribute(control.input, 'min', parameter.min);
    setOptionalNumberAttribute(control.input, 'max', parameter.max);
    control.input.disabled = parameter.disabled ?? false;
    control.input.placeholder = parameter.placeholder ?? '';
    control.input.setAttribute(
      'aria-invalid',
      String(parameter.invalid ?? false),
    );
    if (forceValue || document.activeElement !== control.input) {
      control.input.value =
        parameter.value === undefined
          ? ''
          : formatDisplayNumber(parameter.value);
    }
  }

  private renderActions(actions: readonly ContextualToolActionView[]): void {
    this.actions.replaceChildren(
      ...actions.map(action => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        button.disabled = action.disabled ?? false;
        button.addEventListener('click', () =>
          this.options.onAction(action.id),
        );
        return button;
      }),
    );
    this.actions.hidden = actions.length === 0;
  }
}

function finiteInputValue(input: HTMLInputElement): number | undefined {
  return Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : undefined;
}

function setOptionalNumberAttribute(
  input: HTMLInputElement,
  name: 'min' | 'max',
  value: number | undefined,
): void {
  if (value === undefined) {
    input.removeAttribute(name);
  } else {
    input.setAttribute(name, String(value));
  }
}

function sameNames(
  current: readonly string[],
  parameters: readonly ContextualToolParameterView[],
): boolean {
  return (
    current.length === parameters.length &&
    current.every((name, index) => name === parameters[index].name)
  );
}

function formatDisplayNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}
