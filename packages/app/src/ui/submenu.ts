/** Native nested popover behavior; callers own menu items and commands. */
export class Submenu {
  private readonly abort = new AbortController();
  private openTimer?: number;
  private closeTimer?: number;
  private anchor?: {left: number; top: number};

  constructor(
    private readonly trigger: HTMLButtonElement,
    readonly root: HTMLElement,
    private readonly item: HTMLButtonElement,
  ) {
    const {signal} = this.abort;
    const parent = trigger.closest<HTMLElement>('[popover]')!;
    const row = item.parentElement!;
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    root.setAttribute('role', 'menu');
    if (root.id) trigger.setAttribute('aria-controls', root.id);

    row.addEventListener(
      'pointerenter',
      event => {
        this.clearTimers();
        if (event.pointerType !== 'touch')
          this.openTimer = window.setTimeout(() => this.open(), 100);
      },
      {signal},
    );
    row.addEventListener('pointerleave', this.scheduleClose, {signal});
    root.addEventListener('pointerenter', () => this.clearTimers(), {signal});
    root.addEventListener('pointerleave', this.scheduleClose, {signal});
    parent.addEventListener(
      'pointerover',
      event => {
        const button = (event.target as HTMLElement).closest('button');
        if (
          button &&
          button !== trigger &&
          button !== item &&
          !root.contains(button)
        )
          this.close();
      },
      {signal},
    );
    parent.addEventListener(
      'beforetoggle',
      event => {
        if (event.newState === 'closed') this.clearTimers();
      },
      {signal},
    );
    parent.addEventListener(
      'focusin',
      event => {
        if (
          event.target !== trigger &&
          event.target !== item &&
          !root.contains(event.target as Node)
        )
          this.close();
      },
      {signal},
    );
    parent.addEventListener(
      'scroll',
      event => {
        if (root.contains(event.target as Node)) return;
        const bounds = item.getBoundingClientRect();
        // A scroll that revealed this item can be delivered after its click.
        // Close only when the item has moved since the submenu was positioned.
        if (
          root.matches(':popover-open') &&
          this.anchor?.left === bounds.left &&
          this.anchor.top === bounds.top
        )
          return;
        this.close();
      },
      {signal, capture: true},
    );
    trigger.addEventListener('click', () => this.open(true), {signal});
    trigger.addEventListener(
      'keydown',
      event => {
        if (['ArrowRight', 'Enter', ' '].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          this.open(true);
        } else if (event.key === 'Escape' && root.matches(':popover-open')) {
          event.preventDefault();
          event.stopPropagation();
          this.close(true);
        }
      },
      {signal},
    );
    item.addEventListener(
      'keydown',
      event => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          this.open(true);
        } else if (event.key === 'Escape' && root.matches(':popover-open')) {
          event.preventDefault();
          event.stopPropagation();
          this.close(true);
        }
      },
      {signal},
    );
    root.addEventListener(
      'beforetoggle',
      event => {
        trigger.setAttribute(
          'aria-expanded',
          String(event.newState === 'open'),
        );
        if (event.newState === 'closed') this.clearTimers();
      },
      {signal},
    );
    root.addEventListener(
      'keydown',
      event => {
        if (event.key === 'ArrowLeft' || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.close(true);
          return;
        }
        const items = this.items();
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
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
          event.stopPropagation();
          items[next]?.focus();
        }
      },
      {signal},
    );
    window.addEventListener('resize', () => this.close(), {signal});
  }

  open(focus = false): void {
    this.clearTimers();
    if (this.trigger.disabled || !this.trigger.checkVisibility()) return;
    this.root.showPopover();
    const item = this.item.getBoundingClientRect();
    this.anchor = {left: item.left, top: item.top};
    const parent = this.trigger
      .closest<HTMLElement>('[popover]')!
      .getBoundingClientRect();
    const bounds = this.root.getBoundingClientRect();
    const left =
      parent.right + 2 + bounds.width <= window.innerWidth - 8
        ? parent.right + 2
        : parent.left - bounds.width - 2;
    this.root.style.left = `${Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8))}px`;
    this.root.style.top = `${Math.max(8, Math.min(item.top, window.innerHeight - bounds.height - 8))}px`;
    if (focus) this.items()[0]?.focus();
  }

  close(restoreFocus = this.root.contains(document.activeElement)): void {
    this.clearTimers();
    this.root.hidePopover();
    this.anchor = undefined;
    if (restoreFocus) this.item.focus({preventScroll: true});
  }

  dispose(): void {
    this.close();
    this.abort.abort();
  }

  private items(): HTMLButtonElement[] {
    return [...this.root.querySelectorAll<HTMLButtonElement>('button')].filter(
      button => !button.disabled && button.checkVisibility(),
    );
  }

  private scheduleClose = (): void => {
    this.clearTimers();
    this.closeTimer = window.setTimeout(() => this.close(), 180);
  };

  private clearTimers(): void {
    window.clearTimeout(this.openTimer);
    window.clearTimeout(this.closeTimer);
    this.openTimer = undefined;
    this.closeTimer = undefined;
  }
}
