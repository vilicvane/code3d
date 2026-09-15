import {
  action,
  autorun,
  makeObservable,
  observableRef,
  type IReactionDisposer,
} from 'mobx';

export type DockPanelState = 'collapsed' | 'peek' | 'pinned';

export type DockPanelConfig = Readonly<{
  root: HTMLElement;
  handle: HTMLButtonElement;
  body: HTMLElement;
}>;

export class DockPanelCoordinator {
  private readonly panels = new Set<DockPanelController>();
  private transient?: DockPanelController;

  register(config: DockPanelConfig): DockPanelController {
    const panel = new DockPanelController(this, config);
    this.panels.add(panel);
    return panel;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape' && this.transient) {
      this.transient.collapseTransient();
      return true;
    }
    return false;
  }

  dispose(): void {
    for (const panel of this.panels) panel.dispose();
    this.panels.clear();
    this.transient = undefined;
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
  private readonly stopRender: IReactionDisposer;
  private state: DockPanelState = 'collapsed';
  private closeTimer?: number;
  private hovered = false;
  private disposed = false;
  private readonly activePointers = new Set<number>();

  constructor(
    private readonly coordinator: DockPanelCoordinator,
    private readonly config: DockPanelConfig,
  ) {
    makeObservable<this, 'state' | 'setState'>(this, {
      state: observableRef,
      setState: action,
    });
    const {root, handle, body} = config;
    if (!body.id) {
      throw new Error('Dock panel body requires an id for aria-controls.');
    }
    handle.setAttribute('aria-controls', body.id);
    handle.setAttribute('aria-expanded', 'false');
    root.addEventListener('pointerenter', this.onPointerEnter);
    root.addEventListener('pointerleave', this.onPointerLeave);
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('focusin', this.cancelClose);
    root.addEventListener('focusout', this.onFocusOut);
    handle.addEventListener('click', this.togglePinned);
    window.addEventListener('pointerup', this.onPointerEnd, true);
    window.addEventListener('pointercancel', this.onPointerEnd, true);
    this.stopRender = autorun(() => this.render());
  }

  dispose(): void {
    this.disposed = true;
    this.cancelClose();
    this.stopRender();
    this.coordinator.releasePeek(this);
    const {root, handle} = this.config;
    root.removeEventListener('pointerenter', this.onPointerEnter);
    root.removeEventListener('pointerleave', this.onPointerLeave);
    root.removeEventListener('pointerdown', this.onPointerDown);
    root.removeEventListener('focusin', this.cancelClose);
    root.removeEventListener('focusout', this.onFocusOut);
    handle.removeEventListener('click', this.togglePinned);
    window.removeEventListener('pointerup', this.onPointerEnd, true);
    window.removeEventListener('pointercancel', this.onPointerEnd, true);
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
    if (this.disposed) return;
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
  }

  private render(): void {
    const expanded = this.state !== 'collapsed';
    this.config.root.dataset.panelState = this.state;
    this.config.handle.setAttribute('aria-expanded', String(expanded));
    this.config.body.hidden = !expanded;
  }
}
