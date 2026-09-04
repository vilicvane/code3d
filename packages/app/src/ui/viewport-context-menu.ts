type ContextMenuGesture = {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  released: boolean;
  requested: boolean;
};

export class ViewportContextMenu {
  private readonly menu = document.createElement('div');
  private readonly exportItem = document.createElement('button');
  private gesture?: ContextMenuGesture;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    onExportImage: () => void,
  ) {
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Model viewport');
    this.menu.className = 'viewport-context-menu';
    this.menu.popover = 'auto';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'Viewport');
    this.exportItem.type = 'button';
    this.exportItem.setAttribute('role', 'menuitem');
    this.exportItem.textContent = 'Export image…';
    this.exportItem.addEventListener('click', () => {
      this.close();
      onExportImage();
    });
    this.menu.append(this.exportItem);
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
        this.exportItem.focus();
      }
    });
  }

  private open(x: number, y: number): void {
    this.menu.showPopover();
    const bounds = this.menu.getBoundingClientRect();
    this.menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    this.exportItem.focus();
  }

  private close(): void {
    this.menu.hidePopover();
    this.canvas.focus({preventScroll: true});
  }
}
