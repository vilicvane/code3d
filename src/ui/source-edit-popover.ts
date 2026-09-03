import * as monaco from 'monaco-editor/editor';
import type {SourceRef} from '../model/runtime';

export type SourceEditExcerpt = Readonly<{
  file: string;
  lineNumber: number;
  source: string;
  changedStart: number;
  changedEnd: number;
  sourceRef: SourceRef;
}>;

export class SourceEditPopover {
  private readonly root = document.createElement('section');
  private readonly summary = document.createElement('p');
  private readonly edits = document.createElement('div');
  private dismissTimer?: number;

  constructor(
    container: HTMLElement,
    private readonly navigateSource: (sourceRef: SourceRef) => void,
  ) {
    this.root.className = 'source-edit-popover';
    this.root.hidden = true;
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-atomic', 'true');

    const header = document.createElement('header');
    const eyebrow = document.createElement('span');
    eyebrow.className = 'source-edit-popover-eyebrow';
    eyebrow.textContent = 'SOURCE UPDATED';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'source-edit-popover-close';
    close.setAttribute('aria-label', 'Close source update');
    close.textContent = '×';
    close.addEventListener('click', () => this.dismiss());
    header.append(eyebrow, close);

    this.summary.className = 'source-edit-popover-summary';
    this.edits.className = 'source-edit-popover-edits';
    this.root.append(header, this.summary, this.edits);
    this.root.addEventListener('pointerenter', () => this.cancelDismiss());
    this.root.addEventListener('pointerleave', () =>
      this.scheduleDismiss(2400),
    );
    container.append(this.root);
  }

  show(summary: string, excerpts: readonly SourceEditExcerpt[]): void {
    this.summary.textContent = summary;
    this.edits.replaceChildren(
      ...excerpts.map((excerpt, index) =>
        sourceEditBlock(excerpt, index, excerpts.length, this.navigateSource),
      ),
    );
    this.root.hidden = false;
    this.scheduleDismiss(7000);
  }

  private dismiss(): void {
    this.cancelDismiss();
    this.root.hidden = true;
  }

  private scheduleDismiss(delay: number): void {
    this.cancelDismiss();
    this.dismissTimer = window.setTimeout(() => this.dismiss(), delay);
  }

  private cancelDismiss(): void {
    window.clearTimeout(this.dismissTimer);
    this.dismissTimer = undefined;
  }
}

function sourceEditBlock(
  excerpt: SourceEditExcerpt,
  index: number,
  editCount: number,
  navigateSource: (sourceRef: SourceRef) => void,
): HTMLElement {
  const block = document.createElement('section');
  block.className = 'source-edit-block';
  const label = document.createElement('span');
  label.className = 'source-edit-block-label';
  label.textContent =
    editCount > 1
      ? `${excerpt.file} · EDIT ${String(index + 1).padStart(2, '0')}`
      : excerpt.file;
  block.append(label);

  const source = document.createElement('button');
  source.type = 'button';
  source.className = 'source-edit-code';
  source.title = `Open ${excerpt.file}:${excerpt.lineNumber}`;
  source.setAttribute(
    'aria-label',
    `Open changed source at ${excerpt.file}, line ${excerpt.lineNumber}`,
  );
  source.addEventListener('click', () => navigateSource(excerpt.sourceRef));
  const lineNumber = document.createElement('span');
  lineNumber.className = 'source-edit-line-number';
  lineNumber.textContent = String(excerpt.lineNumber);
  const code = document.createElement('code');
  appendHighlightedSource(code, excerpt);
  source.append(lineNumber, code);
  block.append(source);
  return block;
}

function appendHighlightedSource(
  code: HTMLElement,
  excerpt: SourceEditExcerpt,
): void {
  const lines = excerpt.source.split('\n');
  const tokenLines = monaco.editor.tokenize(excerpt.source, 'typescript');
  let lineOffset = 0;

  lines.forEach((line, lineIndex) => {
    const tokens = tokenLines[lineIndex] ?? [];
    tokens.forEach((token, tokenIndex) => {
      const tokenEnd = tokens[tokenIndex + 1]?.offset ?? line.length;
      appendToken(
        code,
        line.slice(token.offset, tokenEnd),
        token.type,
        lineOffset + token.offset,
        excerpt,
      );
    });
    if (lineIndex < lines.length - 1) {
      code.append('\n');
      lineOffset += line.length + 1;
    }
  });
}

function appendToken(
  code: HTMLElement,
  text: string,
  tokenType: string,
  offset: number,
  excerpt: SourceEditExcerpt,
): void {
  const boundaries = [0, text.length];
  for (const changedBoundary of [
    excerpt.changedStart - offset,
    excerpt.changedEnd - offset,
  ]) {
    if (changedBoundary > 0 && changedBoundary < text.length) {
      boundaries.push(changedBoundary);
    }
  }
  boundaries.sort((left, right) => left - right);

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const span = document.createElement('span');
    const tokenClass = sourceTokenClass(tokenType);
    if (tokenClass) span.classList.add(tokenClass);
    if (
      offset + start < excerpt.changedEnd &&
      offset + end > excerpt.changedStart
    ) {
      span.classList.add('source-edit-change');
    }
    span.textContent = text.slice(start, end);
    code.append(span);
  }
}

function sourceTokenClass(tokenType: string): string | undefined {
  if (tokenType.includes('comment')) return 'source-token-comment';
  if (tokenType.includes('keyword')) return 'source-token-keyword';
  if (tokenType.includes('string')) return 'source-token-string';
  if (tokenType.includes('number')) return 'source-token-number';
  if (tokenType.includes('type.identifier')) return 'source-token-type';
  return undefined;
}
