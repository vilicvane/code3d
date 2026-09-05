type ContextMenuGesture = {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  released: boolean;
  requested: boolean;
};

type ViewportMenuAction = Readonly<{label: string; run(): void}>;

export class ViewportContextMenu {
  private readonly menu = document.createElement('div');
  private readonly items: HTMLButtonElement[] = [];
  private gesture?: ContextMenuGesture;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    actions: readonly ViewportMenuAction[],
  ) {
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Model viewport');
    this.menu.className = 'viewport-context-menu';
    this.menu.popover = 'auto';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'Viewport');
    for (const action of actions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = action.label;
      item.addEventListener('click', () => {
        this.close();
        action.run();
      });
      this.items.push(item);
      this.menu.append(item);
    }
    document.body.append(this.menu);

    canvas.addEventListener('pointerdown', event => {
      this.gesture =
        event.button === 2
          ? {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              moved: false,
              released: false,
              requested: false,
            }
          : undefined;
    });
    canvas.addEventListener('pointermove', event => {
      const gesture = this.gesture;
      if (
        gesture &&
        !gesture.released &&
        gesture.pointerId === event.pointerId
      ) {
        gesture.moved ||=
          Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4;
      }
    });
    canvas.addEventListener('pointerup', event => {
      const gesture = this.gesture;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gesture.released = true;
      if (gesture.requested && !gesture.moved) {
        this.open(event.clientX, event.clientY);
      }
    });
    canvas.addEventListener('pointercancel', () => {
      this.gesture = undefined;
    });
    canvas.addEventListener('contextmenu', event => {
      event.preventDefault();
      const gesture = this.gesture;
      // Browsers dispatch contextmenu on either press or release. Wait until a
      // right-button gesture finishes so panning does not open the menu.
      if (event.button === 2 && gesture) {
        gesture.requested = true;
        if (!gesture.released || gesture.moved) return;
      }
      this.open(event.clientX, event.clientY);
    });
    canvas.addEventListener('keydown', event => {
      if (
        event.key !== 'ContextMenu' &&
        !(event.shiftKey && event.key === 'F10')
      )
        return;
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      this.open(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    });
    this.menu.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        this.close();
      } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const current = this.items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const index =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? this.items.length - 1
              : (current +
                  (event.key === 'ArrowUp' ? -1 : 1) +
                  this.items.length) %
                this.items.length;
        this.items[index]?.focus();
      }
    });
  }

  private open(x: number, y: number): void {
    this.menu.showPopover();
    const bounds = this.menu.getBoundingClientRect();
    this.menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    this.items[0]?.focus();
  }

  private close(): void {
    this.menu.hidePopover();
    this.canvas.focus({preventScroll: true});
  }
}
