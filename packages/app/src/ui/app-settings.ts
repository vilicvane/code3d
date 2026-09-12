import {
  action,
  autorun,
  makeObservable,
  observableRef,
  reaction,
  runInAction,
} from 'mobx';
import {
  type AppSettings,
  AppSettingError,
  type AppSettingsValues,
  defaultAppSettings,
} from '../app-settings';
import {AppDialog, dialogs} from './dialog';

type Field = {
  key: keyof AppSettingsValues;
  label: string;
  hint: string;
  step: string;
  min: string;
};
const groups: readonly {id: string; title: string; fields: readonly Field[]}[] =
  [
    {
      id: 'preview',
      title: 'Preview',
      fields: [
        {
          key: 'editDelayMs',
          label: 'Edit delay (ms)',
          hint: 'Wait after typing before updating the model.',
          step: '1',
          min: '0',
        },
        {
          key: 'completionDelayMs',
          label: 'Completion preview delay (ms)',
          hint: 'Wait before previewing a focused completion candidate.',
          step: '1',
          min: '0',
        },
      ],
    },
    {
      id: 'rendering',
      title: 'Rendering',
      fields: [
        {
          key: 'pixelRatioLimit',
          label: 'Resolution limit (×)',
          hint: 'Leave empty to use the full display pixel ratio.',
          step: 'any',
          min: '0',
        },
        {
          key: 'snapshotConcurrency',
          label: 'Geometry workers',
          hint: 'Maximum parallel geometry queries. More workers use more memory.',
          step: '1',
          min: '1',
        },
      ],
    },
    {
      id: 'cache',
      title: 'Cache',
      fields: [
        {
          key: 'memoryCacheGiB',
          label: 'Memory cache (GiB)',
          hint: 'Soft budget for computation caches. Active models may exceed it.',
          step: 'any',
          min: '0',
        },
        {
          key: 'diskCacheGiB',
          label: 'Disk cache (GiB)',
          hint: 'Shared across projects, including space for cache maintenance.',
          step: 'any',
          min: '0',
        },
      ],
    },
  ];

export class AppSettingsDialog {
  private readonly dialog: AppDialog;
  private readonly form = document.createElement('form');
  private readonly inputs = new Map<
    keyof AppSettingsValues,
    HTMLInputElement
  >();
  private readonly status = document.createElement('p');
  private readonly stops: (() => void)[] = [];
  private error = '';
  private activeGroup = groups[0].id;
  private readonly navigation = document.createElement('div');
  private readonly sections = new Map<
    string,
    {tab: HTMLButtonElement; panel: HTMLElement}
  >();
  private readonly compact = window.matchMedia('(max-width: 600px)');
  private readonly orientNavigation = () => {
    this.navigation.setAttribute(
      'aria-orientation',
      this.compact.matches ? 'horizontal' : 'vertical',
    );
  };

  constructor(
    private readonly settings: AppSettings,
    host = document.body,
  ) {
    makeObservable<this, 'error' | 'activeGroup' | 'selectGroup'>(this, {
      error: observableRef,
      open: action,
      activeGroup: observableRef,
      selectGroup: action,
    });
    this.dialog = new AppDialog(
      {title: 'App settings', className: 'settings-dialog'},
      host,
    );
    this.form.className = 'app-dialog-content';
    this.form.noValidate = true;
    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = 'App settings';
    const description = document.createElement('p');
    description.textContent = 'Preferences for all projects in this browser.';
    header.append(title, description);
    const layout = document.createElement('div');
    layout.className = 'settings-layout';
    this.navigation.className = 'settings-navigation';
    this.navigation.setAttribute('role', 'tablist');
    this.navigation.setAttribute('aria-label', 'Settings categories');
    this.orientNavigation();
    this.compact.addEventListener('change', this.orientNavigation);
    const panels = document.createElement('div');
    panels.className = 'settings-panels';
    layout.append(this.navigation, panels);
    this.form.append(header, layout);
    for (const group of groups) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.id = `settings-tab-${group.id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `settings-panel-${group.id}`);
      tab.textContent = group.title;
      tab.addEventListener('click', () => this.selectGroup(group.id));
      tab.addEventListener('keydown', event => {
        const nextKey = this.compact.matches ? 'ArrowRight' : 'ArrowDown';
        const previousKey = this.compact.matches ? 'ArrowLeft' : 'ArrowUp';
        if (![nextKey, previousKey, 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = groups.indexOf(group);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? groups.length - 1
              : (current + (event.key === nextKey ? 1 : -1) + groups.length) %
                groups.length;
        this.selectGroup(groups[next].id);
        this.sections.get(groups[next].id)!.tab.focus();
      });
      const panel = document.createElement('section');
      panel.className = 'settings-panel';
      panel.id = `settings-panel-${group.id}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      const heading = document.createElement('h3');
      heading.textContent = group.title;
      const fields = document.createElement('div');
      fields.className = 'settings-fields';
      panel.append(heading, fields);
      this.sections.set(group.id, {tab, panel});
      this.navigation.append(tab);
      panels.append(panel);
      for (const field of group.fields) {
        const label = document.createElement('label');
        const caption = document.createElement('span');
        caption.textContent = field.label;
        const input = document.createElement('input');
        input.type = 'number';
        input.name = field.key;
        input.min = field.min;
        input.step = field.step;
        input.required = field.key !== 'pixelRatioLimit';
        if (!input.required) input.placeholder = 'Unlimited';
        const hint = document.createElement('small');
        hint.id = `setting-${field.key}-hint`;
        hint.textContent = field.hint;
        input.setAttribute('aria-describedby', hint.id);
        label.append(caption, input, hint);
        fields.append(label);
        this.inputs.set(field.key, input);
        this.stops.push(
          reaction(
            () => settings.value[field.key],
            value => {
              input.value = value === null ? '' : String(value);
            },
            {fireImmediately: true},
          ),
        );
      }
    }
    this.status.setAttribute('role', 'alert');
    const footer = document.createElement('footer');
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'dialog-button settings-reset';
    reset.textContent = 'Reset defaults';
    reset.addEventListener('click', () => void this.resetDefaults());
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'dialog-button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.dialog.dismiss());
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'dialog-button button-primary';
    save.textContent = 'Save';
    footer.append(reset, cancel, save);
    const actions = document.createElement('div');
    actions.className = 'settings-actions';
    actions.append(this.status, footer);
    this.form.append(actions);
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      this.save();
    });
    this.dialog.element.append(this.form);
    this.stops.push(
      autorun(() => {
        for (const [id, {tab, panel}] of this.sections) {
          const active = this.activeGroup === id;
          tab.setAttribute('aria-selected', String(active));
          tab.tabIndex = active ? 0 : -1;
          panel.hidden = !active;
        }
      }),
      autorun(() => {
        this.status.textContent = this.error;
        this.status.hidden = !this.error;
      }),
    );
  }

  open(): void {
    this.error = '';
    this.fill(this.settings.value);
    const group = groups.find(group => group.id === this.activeGroup)!;
    this.dialog.open(this.inputs.get(group.fields[0].key));
  }

  dispose(): void {
    this.compact.removeEventListener('change', this.orientNavigation);
    this.stops.forEach(stop => stop());
    this.dialog.dispose();
  }

  private selectGroup(id: string): void {
    this.activeGroup = id;
  }

  private revealField(key: keyof AppSettingsValues): HTMLInputElement {
    const group = groups.find(group =>
      group.fields.some(field => field.key === key),
    )!;
    this.selectGroup(group.id);
    return this.inputs.get(key)!;
  }

  private fill(value: AppSettingsValues): void {
    for (const [key, input] of this.inputs)
      input.value = value[key] === null ? '' : String(value[key]);
  }

  private async resetDefaults(): Promise<void> {
    const confirmed = await dialogs.confirm({
      title: 'Reset defaults?',
      message:
        'This replaces your edits in every category with the default values. Choose Save to apply them.',
      submit: 'Reset defaults',
    });
    if (!confirmed || !this.dialog.isOpen) return;
    this.fill(defaultAppSettings());
    runInAction(() => {
      this.error = '';
    });
  }

  private save(): void {
    for (const [key, input] of this.inputs) {
      if (input.validity.valid) continue;
      this.revealField(key).reportValidity();
      return;
    }
    const value = Object.fromEntries(
      [...this.inputs].map(([key, input]) => [
        key,
        key === 'pixelRatioLimit' && !input.value ? null : input.valueAsNumber,
      ]),
    ) as AppSettingsValues;
    try {
      this.settings.save(value);
      this.dialog.close();
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      if (error instanceof AppSettingError) this.revealField(error.key).focus();
    }
  }
}
