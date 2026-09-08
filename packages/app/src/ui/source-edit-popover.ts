import {ChevronUp, X} from 'lucide';
import type {SourceRef} from '@code3d/core/tooling';
import type {SourceEditDiff, SourceDiffLine} from '../source-edit-diff';
import {createIcon} from './icons';

export class SourceEditPopover {
  private readonly root = document.createElement('section');
  private readonly toggle = document.createElement('button');
  private readonly summary = document.createElement('span');
  private readonly edits = document.createElement('div');
  private dismissTimer?: number;

  constructor(
    container: HTMLElement,
    private readonly navigateSource: (sourceRef: SourceRef) => void,
  ) {
    this.root.className = 'source-edit-popover';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Source update');

    const header = document.createElement('header');
    this.toggle.type = 'button';
    this.toggle.className = 'source-edit-popover-toggle';
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.setAttribute('aria-controls', 'source-edit-diff');
    this.toggle.title = 'Show source diff';
    this.toggle.addEventListener('click', () => {
      this.setExpanded(this.edits.hidden === true);
      this.scheduleDismiss(7000);
    });
    this.summary.className = 'source-edit-popover-summary';
    this.summary.setAttribute('role', 'status');
    this.summary.setAttribute('aria-atomic', 'true');
    this.toggle.append(this.summary, createIcon(ChevronUp));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'source-edit-popover-close';
    close.setAttribute('aria-label', 'Close source update');
    close.title = 'Close source update';
    close.append(createIcon(X));
    close.addEventListener('click', () => this.dismiss());
    header.append(this.toggle, close);

    this.edits.id = 'source-edit-diff';
    this.edits.className = 'source-edit-popover-edits';
    this.edits.hidden = true;
    // Details grow upwards; the one-line summary stays in its original position.
    this.root.append(this.edits, header);
    this.root.addEventListener('pointerenter', () => this.cancelDismiss());
    this.root.addEventListener('pointerleave', () =>
      this.scheduleDismiss(2400),
    );
    this.root.addEventListener('focusin', () => this.cancelDismiss());
    this.root.addEventListener('focusout', () => this.scheduleDismiss(2400));
    this.root.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.setExpanded(false);
      this.toggle.focus();
    });
    container.append(this.root);
  }

  show(diffs: readonly SourceEditDiff[]): void {
    const changed = diffs.filter(diff => diff.added || diff.removed);
    if (!changed.length) {
      this.dismiss();
      return;
    }
    const file = document.createElement('span');
    file.className = 'source-edit-file';
    file.textContent =
      changed.length === 1
        ? changed[0].file.split('/').at(-1)!
        : `${changed.length} files`;
    file.title = changed.map(diff => diff.file).join('\n');
    const added = changed.reduce((total, diff) => total + diff.added, 0);
    const removed = changed.reduce((total, diff) => total + diff.removed, 0);
    this.summary.replaceChildren(file, ...diffStats(added, removed));
    this.summary.setAttribute(
      'aria-label',
      `Source updated: ${file.textContent}, ${added} lines added, ${removed} lines removed`,
    );
    this.edits.replaceChildren(
      ...changed.map(diff => sourceDiffBlock(diff, this.navigateSource)),
    );
    this.setExpanded(false);
    this.root.hidden = false;
    this.scheduleDismiss(7000);
  }

  dismiss(): void {
    this.cancelDismiss();
    this.root.hidden = true;
  }

  private setExpanded(expanded: boolean): void {
    this.edits.hidden = !expanded;
    this.toggle.setAttribute('aria-expanded', String(expanded));
    this.toggle.title = expanded ? 'Hide source diff' : 'Show source diff';
  }

  private scheduleDismiss(delay: number): void {
    this.cancelDismiss();
    if (this.root.matches(':hover, :focus-within')) return;
    this.dismissTimer = window.setTimeout(() => this.dismiss(), delay);
  }

  private cancelDismiss(): void {
    window.clearTimeout(this.dismissTimer);
    this.dismissTimer = undefined;
  }
}

function diffStats(added: number, removed: number): HTMLElement[] {
  return (['added', 'removed'] as const).map(kind => {
    const stat = document.createElement('span');
    stat.className = `source-edit-${kind}`;
    stat.textContent = kind === 'added' ? `+${added}` : `−${removed}`;
    return stat;
  });
}

function sourceDiffBlock(
  diff: SourceEditDiff,
  navigateSource: (sourceRef: SourceRef) => void,
): HTMLElement {
  const block = document.createElement('section');
  block.className = 'source-edit-block';
  const label = document.createElement('div');
  label.className = 'source-edit-block-label';
  const file = document.createElement('span');
  file.className = 'source-edit-file';
  file.textContent = diff.file;
  label.append(file, ...diffStats(diff.added, diff.removed));
  block.append(label);
  for (const hunk of diff.hunks) {
    const region = document.createElement('div');
    region.className = 'source-edit-hunk';
    region.setAttribute('aria-label', `Diff near line ${hunk.newStart}`);
    region.append(
      ...hunk.lines.map(line => sourceDiffLine(line, navigateSource)),
    );
    block.append(region);
  }
  return block;
}

function sourceDiffLine(
  line: SourceDiffLine,
  navigateSource: (sourceRef: SourceRef) => void,
): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'source-edit-line';
  row.dataset.kind = line.kind;
  row.title = 'Open source';
  row.setAttribute(
    'aria-label',
    `Open ${line.sourceRef.file}, ${line.kind === '-' ? 'deleted ' : ''}line ${line.newLine ?? line.oldLine}`,
  );
  row.addEventListener('click', () => navigateSource(line.sourceRef));
  for (const value of [line.oldLine, line.newLine]) {
    const number = document.createElement('span');
    number.className = 'source-edit-line-number';
    number.textContent = value?.toString() ?? '';
    row.append(number);
  }
  const marker = document.createElement('span');
  marker.className = 'source-edit-line-marker';
  marker.textContent = line.kind;
  const code = document.createElement('code');
  code.textContent = line.text;
  row.append(marker, code);
  return row;
}
