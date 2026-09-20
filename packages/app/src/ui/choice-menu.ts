import {reaction} from 'mobx';
import type {IconNode} from 'lucide';
import {createIcon} from './icons';

export type MenuChoice<T extends string> = Readonly<{
  value: T;
  label: string;
  title?: string;
  icon?: IconNode;
}>;

/** Shared single-choice popover; callers own selection and trigger presentation. */
export class ChoiceMenu<T extends string> {
  readonly root = document.createElement('div');
  private readonly items: {choice: MenuChoice<T>; button: HTMLButtonElement}[];
  private readonly abort = new AbortController();
  private readonly stop: () => void;

  constructor(
    private readonly trigger: HTMLButtonElement,
    private readonly options: {
      label: string;
      choices: readonly MenuChoice<T>[];
      value(): T;
      select(value: T): void;
      anchor?: HTMLElement;
      align?: 'start' | 'end';
      keyboardTriggers?: readonly HTMLElement[];
    },
  ) {
    const {signal} = this.abort;
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    this.root.className = 'choice-menu';
    this.root.popover = 'auto';
    this.root.setAttribute('role', 'menu');
    this.root.setAttribute('aria-label', options.label);
    this.items = options.choices.map(choice => {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-label', choice.label);
      if (choice.icon) button.append(createIcon(choice.icon));
      button.append(document.createTextNode(choice.label));
      if (choice.title) button.title = choice.title;
      button.addEventListener(
        'click',
        () => {
          this.close(true);
          options.select(choice.value);
        },
        {signal},
      );
      this.root.append(button);
      return {choice, button};
    });
    trigger.after(this.root);
    this.stop = reaction(
      options.value,
      value => {
        for (const {choice, button} of this.items)
          button.setAttribute('aria-checked', String(choice.value === value));
      },
      {fireImmediately: true},
    );
    trigger.addEventListener(
      'click',
      () => {
        if (this.root.matches(':popover-open')) this.close();
        else this.open();
      },
      {signal},
    );
    for (const button of [trigger, ...(options.keyboardTriggers ?? [])])
      button.addEventListener(
        'keydown',
        event => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          this.open(event.key === 'ArrowUp' ? 'last' : 'selected');
        },
        {signal},
      );
    this.root.addEventListener(
      'beforetoggle',
      event => {
        const open = event.newState === 'open';
        trigger.setAttribute('aria-expanded', String(open));
        if (open) window.addEventListener('resize', this.position);
        else window.removeEventListener('resize', this.position);
      },
      {signal},
    );
    this.root.addEventListener(
      'keydown',
      event => {
        event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') event.preventDefault();
          this.close(true);
          return;
        }
        const enabled = this.items
          .map(item => item.button)
          .filter(button => !button.disabled);
        const index = enabled.indexOf(event.target as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? enabled.length - 1
              : event.key === 'ArrowDown'
                ? (index + 1) % enabled.length
                : event.key === 'ArrowUp'
                  ? (index + enabled.length - 1) % enabled.length
                  : undefined;
        if (next !== undefined) {
          event.preventDefault();
          enabled[next]?.focus();
        }
      },
      {signal},
    );
  }

  setDisabled(disabled: (value: T) => boolean): void {
    for (const {choice, button} of this.items)
      button.disabled = disabled(choice.value);
    this.trigger.disabled = this.items.every(item => item.button.disabled);
    if (this.trigger.disabled) this.close();
  }

  open(focus: 'selected' | 'last' = 'selected'): void {
    if (this.trigger.disabled) return;
    this.root.showPopover();
    this.position();
    const enabled = this.items.filter(item => !item.button.disabled);
    const item =
      focus === 'last'
        ? enabled.at(-1)
        : (enabled.find(item => item.choice.value === this.options.value()) ??
          enabled[0]);
    item?.button.focus();
  }

  close(restoreFocus = false): void {
    this.root.hidePopover();
    if (restoreFocus) this.trigger.focus({preventScroll: true});
  }

  dispose(): void {
    this.close();
    this.stop();
    this.abort.abort();
    window.removeEventListener('resize', this.position);
    this.root.remove();
  }

  private position = (): void => {
    const rect = (this.options.anchor ?? this.trigger).getBoundingClientRect();
    const bounds = this.root.getBoundingClientRect();
    const left =
      this.options.align === 'end' ? rect.right - bounds.width : rect.left;
    const top =
      rect.bottom + 6 + bounds.height <= window.innerHeight - 8
        ? rect.bottom + 6
        : rect.top - bounds.height - 6;
    this.root.style.left = `${Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8))}px`;
    this.root.style.top = `${Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8))}px`;
  };
}
