import {type IconNode} from 'lucide';
import {createIcon} from './icons';

export type SketchToolAction = Readonly<{
  name: string;
  title: string;
  icon: IconNode;
  run(): void;
}>;

/** Icon-only primary tools with remembered variants and keyboard-accessible menus. */
export class SketchToolbar {
  readonly root = document.createElement('header');
  private readonly actions: {
    button: HTMLButtonElement;
    action: SketchToolAction;
  }[] = [];
  private readonly menus: {
    root: HTMLElement;
    trigger: HTMLButtonElement;
    variants: readonly SketchToolAction[];
  }[] = [];

  constructor(label = 'Sketch tools') {
    this.root.className = 'sketch-toolbar';
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
    group.className = 'sketch-tool-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    this.root.append(group);
    return group;
  }

  add(group: HTMLElement, action: SketchToolAction): HTMLButtonElement {
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
    variants: readonly SketchToolAction[],
  ): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'sketch-tool-variants';
    group.append(wrapper);
    const primary = this.add(wrapper, variants[0]);
    const entry = this.actions.at(-1)!;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'sketch-tool-caret';
    trigger.tabIndex = -1;
    trigger.title = name;
    trigger.setAttribute('aria-label', name);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.append(createIcon([['path', {d: 'm8 10 4 4 4-4'}]]));
    const menu = document.createElement('div');
    menu.className = 'sketch-tool-menu';
    menu.popover = 'auto';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', name);
    this.menus.push({root: menu, trigger, variants});
    const items = variants.map(action => {
      const item = document.createElement('button');
      item.type = 'button';
      item.tabIndex = -1;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(action === entry.action));
      item.append(
        createIcon(action.icon),
        document.createTextNode(action.name),
      );
      item.title = action.title;
      item.addEventListener('click', () => {
        entry.action = action;
        this.label(primary, action);
        menu.hidePopover();
        action.run();
      });
      menu.append(item);
      return item;
    });
    const open = () => {
      if (trigger.disabled) return;
      menu.showPopover();
      const rect = wrapper.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8))}px`;
      menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - bounds.height - 8)}px`;
      items.forEach((item, i) =>
        item.setAttribute('aria-checked', String(variants[i] === entry.action)),
      );
      items[variants.indexOf(entry.action)].focus();
    };
    trigger.addEventListener('click', () =>
      menu.matches(':popover-open') ? menu.hidePopover() : open(),
    );
    for (const button of [primary, trigger])
      button.addEventListener('keydown', event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        open();
      });
    menu.addEventListener('beforetoggle', event =>
      trigger.setAttribute('aria-expanded', String(event.newState === 'open')),
    );
    menu.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        menu.hidePopover();
        trigger.focus();
        return;
      }
      const index = items.indexOf(event.target as HTMLButtonElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : event.key === 'ArrowDown'
              ? (index + 1) % items.length
              : event.key === 'ArrowUp'
                ? (index + items.length - 1) % items.length
                : undefined;
      if (next !== undefined) {
        event.preventDefault();
        items[next].focus();
      }
    });
    wrapper.append(trigger, menu);
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
    for (const menu of this.menus) {
      menu.trigger.disabled = menu.variants.every(
        action => state(action.name).disabled,
      );
      if (menu.trigger.disabled) menu.root.hidePopover();
    }
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

  close(): void {
    for (const menu of this.menus) menu.root.hidePopover();
  }

  private primaryButtons(): HTMLButtonElement[] {
    return [
      ...this.root.querySelectorAll<HTMLButtonElement>('button:not([role])'),
    ];
  }

  private label(button: HTMLButtonElement, action: SketchToolAction): void {
    button.setAttribute('aria-label', action.name);
    button.title = action.title;
    button.replaceChildren(createIcon(action.icon));
  }
}
