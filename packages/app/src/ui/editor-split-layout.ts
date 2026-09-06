const storageKey = 'code3d:editor-width';
const defaultWidth = 520;
const minimumCodeWidth = 280;
const minimumPreviewWidth = 460;

type ResizeGesture = {
  pointerId: number;
  startX: number;
  startWidth: number;
  preferredWidth: number;
  moved: boolean;
};

export class EditorSplitLayout {
  private preferredWidth: number;
  private width = 0;
  private minimumWidth = 0;
  private maximumWidth = 0;
  private frameWidth = 0;
  private gesture?: ResizeGesture;

  constructor(
    private readonly workspace: HTMLElement,
    private readonly explorer: HTMLElement,
    private readonly separator: HTMLElement,
  ) {
    const storedWidth = Number(localStorage.getItem(storageKey));
    this.preferredWidth =
      Number.isFinite(storedWidth) && storedWidth > 0
        ? storedWidth
        : defaultWidth;

    separator.addEventListener('pointerdown', this.onPointerDown);
    separator.addEventListener('pointermove', this.onPointerMove);
    separator.addEventListener('pointerup', this.onPointerUp);
    separator.addEventListener('pointercancel', this.cancelResize);
    separator.addEventListener('lostpointercapture', this.cancelResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', this.cancelResize);
    const observer = new ResizeObserver(this.render);
    observer.observe(workspace);
    observer.observe(explorer);
    this.render();
  }

  private readonly render = (): void => {
    const stacked = getComputedStyle(this.separator).display === 'none';
    if (stacked && this.gesture) {
      this.cancelResize();
      return;
    }
    if (!stacked) {
      this.frameWidth =
        this.explorer.getBoundingClientRect().width +
        Number.parseFloat(
          getComputedStyle(this.separator.parentElement!).borderRightWidth,
        );
      this.maximumWidth = Math.max(
        0,
        Math.floor(
          this.workspace.clientWidth - minimumPreviewWidth - this.frameWidth,
        ),
      );
      this.minimumWidth = Math.min(minimumCodeWidth, this.maximumWidth);
    }
    // Keep the last side-by-side metrics while stacked, but always apply a
    // cancelled width. A quick round trip may coalesce resize notifications.
    this.width = this.clampWidth(this.preferredWidth);
    this.workspace.style.setProperty(
      '--editor-pane-width',
      `${this.width + this.frameWidth}px`,
    );
    this.separator.setAttribute('aria-valuemin', String(this.minimumWidth));
    this.separator.setAttribute('aria-valuemax', String(this.maximumWidth));
    this.separator.setAttribute('aria-valuenow', String(this.width));
    this.separator.setAttribute('aria-valuetext', `${this.width} pixels`);
  };

  private clampWidth(width: number): number {
    return Math.max(this.minimumWidth, Math.min(width, this.maximumWidth));
  }

  private setWidth(width: number): void {
    this.preferredWidth = this.clampWidth(Math.round(width));
    this.render();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.gesture) return;
    event.preventDefault();
    this.separator.focus();
    this.separator.setPointerCapture(event.pointerId);
    this.gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: this.width,
      preferredWidth: this.preferredWidth,
      moved: false,
    };
    this.workspace.dataset.resizing = '';
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.clientX === gesture.startX && !gesture.moved) return;
    gesture.moved = true;
    this.setWidth(gesture.startWidth + event.clientX - gesture.startX);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.gesture?.pointerId === event.pointerId) {
      this.finishResize(getComputedStyle(this.separator).display !== 'none');
    }
  };

  private readonly cancelResize = (): void => this.finishResize(false);

  private finishResize(commit: boolean): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = undefined;
    delete this.workspace.dataset.resizing;
    if (this.separator.hasPointerCapture(gesture.pointerId)) {
      this.separator.releasePointerCapture(gesture.pointerId);
    }
    if (!commit) {
      this.preferredWidth = gesture.preferredWidth;
    } else if (gesture.moved) {
      this.saveWidth();
    }
    this.render();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.gesture) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.cancelResize();
      return;
    }
    if (document.activeElement !== this.separator || this.gesture) return;
    const step = event.shiftKey ? 64 : 16;
    let width: number;
    switch (event.key) {
      case 'ArrowLeft':
        width = this.width - step;
        break;
      case 'ArrowRight':
        width = this.width + step;
        break;
      case 'Home':
        width = this.minimumWidth;
        break;
      case 'End':
        width = this.maximumWidth;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.setWidth(width);
    this.saveWidth();
  };

  private saveWidth(): void {
    localStorage.setItem(storageKey, String(this.preferredWidth));
  }
}
