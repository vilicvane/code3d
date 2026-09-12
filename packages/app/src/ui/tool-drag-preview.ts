import {autorun} from 'mobx';

export type ToolDragPreview = Readonly<{
  label: string;
  values: readonly Readonly<{
    label: string;
    value: number;
    start: number;
    unit: 'unit' | '°' | '';
  }>[];
}>;

export function formatDragValue(value: number): string {
  return String(Number(value.toPrecision(6)) || 0);
}

/** Reads the active gesture directly; the display owns no copy of its values. */
export class ToolDragPreviewView {
  readonly root = document.createElement('div');
  private readonly stop: () => void;

  constructor(
    container: HTMLElement,
    preview: () => ToolDragPreview | undefined,
  ) {
    this.root.className = 'tool-drag-preview';
    this.root.setAttribute('aria-label', 'Drag values');
    container.append(this.root);
    this.stop = autorun(() => {
      const current = preview();
      this.root.hidden = !current;
      this.root.replaceChildren();
      if (!current) return;
      const title = document.createElement('span');
      title.className = 'tool-drag-label';
      title.textContent = current.label;
      this.root.append(title);
      for (const item of current.values) {
        const row = document.createElement('div');
        row.className = 'tool-drag-value';
        const label = document.createElement('span');
        label.textContent = `${item.label || current.label}: `;
        const before = document.createElement('span');
        before.textContent = `${formatDragValue(item.start)} `;
        const delta = document.createElement('span');
        delta.className = 'tool-drag-delta';
        const change = Number((item.value - item.start).toPrecision(6));
        delta.textContent = `${change < 0 ? '−' : '+'} ${formatDragValue(Math.abs(change))}`;
        const value = document.createElement('span');
        value.textContent = ` = ${formatDragValue(item.value)}${item.unit === 'unit' ? ' ' : ''}${item.unit}`;
        row.append(label, before, delta, value);
        this.root.append(row);
      }
    });
  }

  dispose(): void {
    this.stop();
    this.root.remove();
  }
}
