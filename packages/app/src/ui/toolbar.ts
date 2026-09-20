import {action, makeObservable, observableRef, reaction} from 'mobx';
import {ChoiceMenu} from './choice-menu';
import {type IconNode} from 'lucide';
import {createIcon} from './icons';

export type ToolbarAction = Readonly<{
  name: string;
  title: string;
  icon: IconNode;
  run(): void;
}>;

/** Icon-only primary tools with remembered variants and keyboard-accessible menus. */
export class Toolbar {
  readonly root = document.createElement('header');
  private readonly actions: {
    button: HTMLButtonElement;
    action: ToolbarAction;
  }[] = [];
  private readonly menus: {
    menu: ChoiceMenu<string>;
    select(name: string): void;
  }[] = [];
  private readonly stops: (() => void)[] = [];

  constructor(label: string) {
    makeObservable(this, {selectVariant: action});
    this.root.className = 'tool-toolbar';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', label);
    this.root.addEventListener('focusin', event => {
      const buttons = this.primaryButtons();
      if (!buttons.includes(event.target as HTMLButtonElement)) return;
      for (const button of buttons)
        button.tabIndex = button === event.target ? 0 : -1;
    });
    this.root.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing)
        return;
      const buttons = this.primaryButtons().filter(button => !button.disabled);
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : event.key === 'ArrowLeft'
              ? (index + buttons.length - 1) % buttons.length
              : event.key === 'ArrowRight'
                ? (index + 1) % buttons.length
                : undefined;
      if (next !== undefined) {
        event.preventDefault();
        buttons[next].focus();
      }
    });
  }

  group(label: string): HTMLElement {
    const group = document.createElement('div');
    group.className = 'tool-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    this.root.append(group);
    return group;
  }

  add(group: HTMLElement, action: ToolbarAction): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = this.actions.length ? -1 : 0;
    const entry = {button, action};
    this.actions.push(entry);
    this.label(button, action);
    button.addEventListener('click', () => entry.action.run());
    group.append(button);
    return button;
  }

  variants(
    group: HTMLElement,
    name: string,
    variants: readonly ToolbarAction[],
  ): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'tool-variants';
    group.append(wrapper);
    const primary = this.add(wrapper, variants[0]);
    const entry = this.actions.at(-1)!;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'tool-caret';
    trigger.tabIndex = -1;
    trigger.title = name;
    trigger.setAttribute('aria-label', name);
    trigger.append(createIcon([['path', {d: 'm8 10 4 4 4-4'}]]));
    wrapper.append(trigger);
    makeObservable(entry, {action: observableRef});
    this.stops.push(
      reaction(
        () => entry.action,
        value => this.label(primary, value),
      ),
    );
    const select = action((name: string) => {
      const value = variants.find(variant => variant.name === name);
      if (value) entry.action = value;
    });
    const menu = new ChoiceMenu(trigger, {
      label: name,
      choices: variants.map(variant => ({
        value: variant.name,
        label: variant.name,
        title: variant.title,
        icon: variant.icon,
      })),
      value: () => entry.action.name,
      select: name => {
        select(name);
        entry.action.run();
      },
      anchor: wrapper,
      keyboardTriggers: [primary],
    });
    this.menus.push({menu, select});
  }

  update(
    state: (name: string) => {
      pressed: boolean | 'mixed';
      disabled: boolean;
      title?: string;
    },
  ): void {
    for (const {button, action} of this.actions) {
      const {pressed, disabled, title} = state(action.name);
      button.setAttribute('aria-pressed', String(pressed));
      button.disabled = disabled;
      if (title !== undefined) button.title = title;
    }
    for (const {menu} of this.menus)
      menu.setDisabled(name => state(name).disabled);
    const buttons = this.primaryButtons();
    if (!buttons.some(button => !button.disabled && button.tabIndex === 0)) {
      const active =
        buttons.find(
          button =>
            !button.disabled && button.getAttribute('aria-pressed') === 'true',
        ) ?? buttons.find(button => !button.disabled);
      for (const button of buttons)
        button.tabIndex = button === active ? 0 : -1;
    }
  }

  selectVariant(name: string): void {
    for (const menu of this.menus) menu.select(name);
  }

  close(): void {
    for (const {menu} of this.menus) menu.close();
  }

  dispose(): void {
    for (const stop of this.stops) stop();
    for (const {menu} of this.menus) menu.dispose();
    this.root.remove();
  }

  private primaryButtons(): HTMLButtonElement[] {
    return [
      ...this.root.querySelectorAll<HTMLButtonElement>('button:not([role])'),
    ];
  }

  private label(button: HTMLButtonElement, action: ToolbarAction): void {
    button.setAttribute('aria-label', action.name);
    button.title = action.title;
    button.replaceChildren(createIcon(action.icon));
  }
}
