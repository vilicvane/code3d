import {action, computed, makeObservable, observableRef, reaction} from 'mobx';
import {formatDisplayNumber} from '../tools/parameter-policy';

export type ContextualToolParameterView = Readonly<{
  name: string;
  label: string;
  value?: number;
  placeholder?: string;
  step: number;
  /** XYZ distances use the viewport grid; step remains the fallback without a grid. */
  gridStep?: boolean;
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
    name: string;
    label: string;
    summary: string;
  }>;
  actions: readonly ContextualToolActionView[];
}>;

type ContextualToolPanelOptions = Readonly<{
  sourceParameter?(): string | undefined;
  gridStep?(): number | undefined;
  onParameterInput(name: string, value: number | undefined): void;
  /** Whether the commit is awaiting refreshed parameter availability. */
  onParameterCommit(name: string, value: number | undefined): boolean;
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
  private view?: ContextualToolPanelView;
  private readonly stopSourceHighlight: () => void;
  private readonly stopParameterSteps: () => void;
  private pendingNavigation?: Readonly<{
    from: HTMLInputElement;
    to: HTMLInputElement;
    cancellation: AbortController;
  }>;

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
    makeObservable<this, 'view'>(this, {
      view: observableRef,
      sourceParameter: computed,
      show: action,
      hide: action,
    });
    this.stopParameterSteps = reaction(
      () => ({view: this.view, gridStep: this.options.gridStep?.()}),
      ({view, gridStep}) => {
        for (const parameter of view?.parameters ?? []) {
          const step =
            parameter.gridStep && gridStep !== undefined
              ? gridStep
              : parameter.step;
          this.controls.get(parameter.name)!.input.step = String(step);
        }
      },
    );
    this.stopSourceHighlight = reaction(
      () => ({name: this.sourceParameter, view: this.view}),
      ({name}) => {
        for (const [parameter, {input}] of this.controls)
          input.classList.toggle('source-active', parameter === name);
        this.selectionSummary.classList.toggle(
          'source-active',
          name !== undefined && this.view?.selection?.name === name,
        );
      },
      {fireImmediately: true},
    );
  }

  show(view: ContextualToolPanelView, forceParameterValues = false): void {
    const structureChanged =
      this.view?.id !== view.id ||
      !sameNames([...this.controls.keys()], view.parameters);
    this.view = view;
    this.title.textContent = view.title;
    this.meta.textContent = view.meta ?? '';
    this.meta.hidden = !view.meta;
    if (structureChanged) {
      this.cancelPendingNavigation();
      this.rebuildParameterControls(view.parameters);
    }
    view.parameters.forEach(parameter =>
      this.updateParameterControl(parameter, forceParameterValues),
    );
    this.selectionField.hidden = !view.selection;
    if (view.selection) {
      this.selectionSummary.dataset.parameter = view.selection.name;
      this.selectionLabel.textContent = view.selection.label;
      this.selectionSummary.textContent = view.selection.summary;
    }
    this.renderActions(view.actions);
    this.root.hidden = false;
    this.completePendingNavigation();
  }

  hide(): void {
    this.cancelPendingNavigation();
    this.root.hidden = true;
    this.view = undefined;
  }

  get sourceParameter(): string | undefined {
    if (!this.view) return undefined;
    const name = this.options.sourceParameter?.();
    return this.view.selection?.name === name ||
      this.view.parameters.some(parameter => parameter.name === name)
      ? name
      : undefined;
  }

  focusSourceParameter(): boolean {
    const name = this.sourceParameter;
    return name !== undefined && this.focusParameter(name);
  }

  dispose(): void {
    this.stopSourceHighlight();
    this.stopParameterSteps();
    this.cancelPendingNavigation();
    this.root.remove();
  }

  focusParameter(name: string): boolean {
    const input = this.controls.get(name)?.input;
    if (!input || input.disabled || input.readOnly || !input.checkVisibility())
      return false;
    input.focus();
    return document.activeElement === input;
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
      const tabHint = document.createElement('kbd');
      tabHint.className = 'contextual-tool-tab-hint';
      tabHint.textContent = 'Tab';
      tabHint.setAttribute('aria-hidden', 'true');
      control.append(input, tabHint);
      field.append(label, control);
      this.parameterFields.append(field);
      this.controls.set(parameter.name, {field, label, input});

      let selectOnPointerUp = false;
      input.addEventListener('input', () => {
        this.cancelPendingNavigation();
        this.options.onParameterInput(parameter.name, finiteInputValue(input));
      });
      input.addEventListener('change', () =>
        this.options.onParameterCommit(parameter.name, finiteInputValue(input)),
      );
      input.addEventListener('keydown', event => {
        if (event.key === 'Tab' && !event.shiftKey) {
          this.advanceAfterCommit(event, parameter.name, input);
          return;
        }
        this.cancelPendingNavigation();
        if (
          (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
          this.view?.parameters.find(field => field.name === parameter.name)
            ?.gridStep &&
          !input.readOnly
        ) {
          // Like a drag, step from the authored value rather than jumping to an absolute grid multiple.
          const current =
            finiteInputValue(input) ?? (Number(input.placeholder) || 0);
          const next =
            current + (event.key === 'ArrowUp' ? 1 : -1) * Number(input.step);
          input.value = String(Number(next.toPrecision(12)));
          this.options.onParameterInput(
            parameter.name,
            finiteInputValue(input),
          );
          event.preventDefault();
          return;
        }
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

  private advanceAfterCommit(
    event: KeyboardEvent,
    name: string,
    input: HTMLInputElement,
  ): void {
    const inputs = [...this.controls.values()].map(control => control.input);
    const next = inputs[inputs.indexOf(input) + 1];
    // Enabled controls and the panel boundaries keep native Tab behavior.
    if (!next?.disabled) return;
    if (this.pendingNavigation) {
      if (event.repeat) event.preventDefault();
      else this.cancelPendingNavigation();
      return;
    }
    if (!this.options.onParameterCommit(name, finiteInputValue(input))) return;
    event.preventDefault();
    const cancellation = new AbortController();
    this.pendingNavigation = {from: input, to: next, cancellation};
    const cancel = () => this.cancelPendingNavigation();
    const options = {signal: cancellation.signal};
    input.addEventListener('blur', cancel, options);
    window.addEventListener('blur', cancel, options);
    document.addEventListener('pointerdown', cancel, {
      ...options,
      capture: true,
    });
  }

  private completePendingNavigation(): void {
    const pending = this.pendingNavigation;
    if (!pending) return;
    this.cancelPendingNavigation();
    if (
      !pending.to.disabled &&
      document.activeElement === pending.from &&
      document.hasFocus()
    ) {
      pending.to.focus();
    }
  }

  private cancelPendingNavigation(): void {
    this.pendingNavigation?.cancellation.abort();
    this.pendingNavigation = undefined;
  }

  private updateParameterControl(
    parameter: ContextualToolParameterView,
    forceValue: boolean,
  ): void {
    const control = this.controls.get(parameter.name)!;
    control.label.textContent = parameter.label.toUpperCase();
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
