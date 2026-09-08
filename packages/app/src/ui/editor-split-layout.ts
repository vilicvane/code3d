const minimumCodeWidth = 280;
const minimumPreviewWidth = 460;
const minimumExplorerWidth = 140;
const maximumExplorerWidth = 420;

type ResizablePane = {
  separator: HTMLElement;
  storageKey: string;
  preferredWidth: number;
  width: number;
  minimumWidth: number;
  maximumWidth: number;
};

type ResizeGesture = {
  pane: ResizablePane;
  pointerId: number;
  startX: number;
  startWidth: number;
  preferredWidth: number;
  moved: boolean;
};

export class EditorSplitLayout {
  private readonly panes: readonly [ResizablePane, ResizablePane];
  private frameWidth = 0;
  private gesture?: ResizeGesture;

  constructor(
    private readonly workspace: HTMLElement,
    private readonly explorer: HTMLElement,
    separator: HTMLElement,
    explorerSeparator: HTMLElement,
  ) {
    this.panes = [
      resizablePane(separator, 'code3d:editor-width', 520),
      resizablePane(explorerSeparator, 'code3d:project-explorer-width', 184),
    ];
    for (const pane of this.panes) {
      pane.separator.addEventListener('pointerdown', this.onPointerDown);
      pane.separator.addEventListener('pointermove', this.onPointerMove);
      pane.separator.addEventListener('pointerup', this.onPointerUp);
      pane.separator.addEventListener('pointercancel', this.onPointerCancel);
      pane.separator.addEventListener(
        'lostpointercapture',
        this.onPointerCancel,
      );
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', this.cancelResize);
    const observer = new ResizeObserver(this.render);
    observer.observe(workspace);
    observer.observe(explorer);
    this.render();
  }

  private readonly render = (): void => {
    if (this.gesture && !separatorVisible(this.gesture.pane)) {
      this.cancelResize();
      return;
    }
    const [code, files] = this.panes;
    const stacked = !separatorVisible(code);
    const borderWidth = Number.parseFloat(
      getComputedStyle(code.separator.parentElement!).borderRightWidth,
    );
    const availableWidth = Math.max(
      0,
      this.workspace.clientWidth -
        (stacked ? 0 : minimumPreviewWidth) -
        borderWidth,
    );
    files.maximumWidth = Math.min(
      maximumExplorerWidth,
      Math.max(0, availableWidth - minimumCodeWidth),
    );
    files.minimumWidth = Math.min(minimumExplorerWidth, files.maximumWidth);
    files.width = clampWidth(files, files.preferredWidth);
    this.workspace.style.setProperty(
      '--project-explorer-width',
      `${files.width}px`,
    );

    if (!stacked) {
      const explorerWidth = this.explorer.hidden ? 0 : files.width;
      this.frameWidth = explorerWidth + borderWidth;
      code.maximumWidth = Math.max(0, availableWidth - explorerWidth);
      code.minimumWidth = Math.min(minimumCodeWidth, code.maximumWidth);
    }
    // Keep the last side-by-side code metrics while stacked, but always apply
    // a cancelled width even before ResizeObserver reports the layout change.
    code.width = clampWidth(code, code.preferredWidth);
    this.workspace.style.setProperty(
      '--editor-pane-width',
      `${code.width + this.frameWidth}px`,
    );
    for (const pane of this.panes) {
      pane.separator.setAttribute('aria-valuemin', String(pane.minimumWidth));
      pane.separator.setAttribute('aria-valuemax', String(pane.maximumWidth));
      pane.separator.setAttribute('aria-valuenow', String(pane.width));
      pane.separator.setAttribute('aria-valuetext', `${pane.width} pixels`);
    }
  };

  private setWidth(pane: ResizablePane, width: number): void {
    pane.preferredWidth = clampWidth(pane, Math.round(width));
    this.render();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.gesture) return;
    const pane = this.panes.find(
      pane => pane.separator === event.currentTarget,
    )!;
    event.preventDefault();
    pane.separator.focus();
    pane.separator.setPointerCapture(event.pointerId);
    this.gesture = {
      pane,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: pane.width,
      preferredWidth: pane.preferredWidth,
      moved: false,
    };
    pane.separator.dataset.resizing = '';
    this.workspace.dataset.resizing = '';
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.clientX === gesture.startX && !gesture.moved) return;
    gesture.moved = true;
    this.setWidth(
      gesture.pane,
      gesture.startWidth + event.clientX - gesture.startX,
    );
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.gesture?.pointerId === event.pointerId) {
      this.finishResize(separatorVisible(this.gesture.pane));
    }
  };

  private readonly cancelResize = (): void => this.finishResize(false);

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (
      this.gesture?.pointerId === event.pointerId &&
      this.gesture.pane.separator === event.currentTarget
    ) {
      this.cancelResize();
    }
  };

  private finishResize(commit: boolean): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = undefined;
    const {pane} = gesture;
    delete pane.separator.dataset.resizing;
    delete this.workspace.dataset.resizing;
    if (pane.separator.hasPointerCapture(gesture.pointerId)) {
      pane.separator.releasePointerCapture(gesture.pointerId);
    }
    if (!commit) {
      pane.preferredWidth = gesture.preferredWidth;
    } else if (gesture.moved) {
      saveWidth(pane);
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
    const pane = this.panes.find(
      pane => pane.separator === document.activeElement,
    );
    if (!pane || this.gesture || event.altKey || event.ctrlKey || event.metaKey)
      return;
    const step = event.shiftKey ? 64 : 16;
    let width: number;
    switch (event.key) {
      case 'ArrowLeft':
        width = pane.width - step;
        break;
      case 'ArrowRight':
        width = pane.width + step;
        break;
      case 'Home':
        width = pane.minimumWidth;
        break;
      case 'End':
        width = pane.maximumWidth;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.setWidth(pane, width);
    saveWidth(pane);
  };
}

function resizablePane(
  separator: HTMLElement,
  storageKey: string,
  defaultWidth: number,
): ResizablePane {
  const storedValue = localStorage.getItem(storageKey);
  const storedWidth = Number(storedValue);
  return {
    separator,
    storageKey,
    preferredWidth:
      storedValue !== null && Number.isFinite(storedWidth) && storedWidth >= 0
        ? storedWidth
        : defaultWidth,
    width: 0,
    minimumWidth: 0,
    maximumWidth: 0,
  };
}

function clampWidth(pane: ResizablePane, width: number): number {
  return Math.max(pane.minimumWidth, Math.min(width, pane.maximumWidth));
}

function separatorVisible(pane: ResizablePane): boolean {
  return getComputedStyle(pane.separator).display !== 'none';
}

function saveWidth(pane: ResizablePane): void {
  localStorage.setItem(pane.storageKey, String(pane.preferredWidth));
}
