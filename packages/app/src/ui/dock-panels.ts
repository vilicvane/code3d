export type DockPanelState = 'collapsed' | 'peek' | 'pinned';

export type DockPanelShortcut = Readonly<{
  code: string;
  label: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}>;

export type DockPanelConfig = Readonly<{
  root: HTMLElement;
  handle: HTMLButtonElement;
  body: HTMLElement;
  shortcut: DockPanelShortcut;
}>;

export class DockPanelCoordinator {
  private readonly panels = new Map<string, DockPanelController>();
  private transient?: DockPanelController;

  register(config: DockPanelConfig): DockPanelController {
    const shortcutKey = shortcutIdentity(config.shortcut);
    if (this.panels.has(shortcutKey)) {
      throw new Error(`Dock panel shortcut conflict: ${config.shortcut.label}`);
    }
    const panel = new DockPanelController(this, config);
    this.panels.set(shortcutKey, panel);
    return panel;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape' && this.transient) {
      this.transient.collapseTransient();
      return true;
    }
    const panel = this.panels.get(shortcutIdentity(event));
    if (!panel || event.repeat) {
      return false;
    }
    panel.togglePinned();
    return true;
  }

  requestPeek(panel: DockPanelController): void {
    if (this.transient === panel) {
      return;
    }
    this.transient?.collapseTransient();
    this.transient = panel;
  }

  releasePeek(panel: DockPanelController): void {
    if (this.transient === panel) {
      this.transient = undefined;
    }
  }
}

export class DockPanelController {
  private state: DockPanelState = 'collapsed';
  private closeTimer?: number;
  private hovered = false;
  private readonly activePointers = new Set<number>();

  constructor(
    private readonly coordinator: DockPanelCoordinator,
    private readonly config: DockPanelConfig,
  ) {
    const {root, handle, body, shortcut} = config;
    if (!body.id) {
      throw new Error('Dock panel body requires an id for aria-controls.');
    }
    handle.setAttribute('aria-controls', body.id);
    handle.setAttribute('aria-expanded', 'false');
    handle.title = `${handle.textContent?.trim() ?? 'Panel'} · ${shortcut.label}`;
    const shortcutLabel = root.querySelector<HTMLElement>(
      '[data-dock-shortcut]',
    );
    if (shortcutLabel) {
      shortcutLabel.textContent = shortcut.label;
    }

    root.addEventListener('pointerenter', this.onPointerEnter);
    root.addEventListener('pointerleave', this.onPointerLeave);
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('focusin', this.cancelClose);
    root.addEventListener('focusout', this.onFocusOut);
    handle.addEventListener('click', this.togglePinned);
    window.addEventListener('pointerup', this.onPointerEnd, true);
    window.addEventListener('pointercancel', this.onPointerEnd, true);
    this.render();
  }

  togglePinned = (): void => {
    this.setState(this.state === 'pinned' ? 'collapsed' : 'pinned');
  };

  collapseTransient(): void {
    if (this.state === 'peek') {
      this.setState('collapsed');
    }
  }

  private readonly onPointerEnter = (): void => {
    this.hovered = true;
    this.cancelClose();
    if (this.state === 'collapsed') {
      this.setState('peek');
    }
  };

  private readonly onPointerLeave = (): void => {
    this.hovered = false;
    this.scheduleClose();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.activePointers.add(event.pointerId);
    this.cancelClose();
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (!this.activePointers.delete(event.pointerId)) {
      return;
    }
    this.scheduleClose();
  };

  private readonly onFocusOut = (): void => {
    queueMicrotask(() => this.scheduleClose());
  };

  private readonly cancelClose = (): void => {
    window.clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
  };

  private scheduleClose(): void {
    this.cancelClose();
    if (
      this.state !== 'peek' ||
      this.hovered ||
      this.activePointers.size > 0 ||
      this.config.root.contains(document.activeElement)
    ) {
      return;
    }
    this.closeTimer = window.setTimeout(() => {
      if (
        !this.hovered &&
        this.activePointers.size === 0 &&
        !this.config.root.contains(document.activeElement)
      ) {
        this.collapseTransient();
      }
    }, 140);
  }

  private setState(state: DockPanelState): void {
    this.cancelClose();
    if (this.state === 'peek' && state !== 'peek') {
      this.coordinator.releasePeek(this);
    }
    if (state === 'peek') {
      this.coordinator.requestPeek(this);
    }
    this.state = state;
    this.render();
  }

  private render(): void {
    const expanded = this.state !== 'collapsed';
    this.config.root.dataset.panelState = this.state;
    this.config.handle.setAttribute('aria-expanded', String(expanded));
    this.config.body.hidden = !expanded;
  }
}

function shortcutIdentity(shortcut: DockPanelShortcut | KeyboardEvent): string {
  return [
    shortcut.altKey ? 'alt' : '',
    shortcut.ctrlKey ? 'ctrl' : '',
    shortcut.metaKey ? 'meta' : '',
    shortcut.shiftKey ? 'shift' : '',
    shortcut.code,
  ].join('+');
}
