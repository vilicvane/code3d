import type {ElementSnapshot, ModelSnapshotObject} from '../model/runtime';

export type ElementsPanelOptions = Readonly<{
  onPreview: (element: ElementSnapshot | undefined) => void;
}>;

export class ElementsPanel {
  private hoveredElement?: ElementSnapshot;
  private focusedElement?: ElementSnapshot;

  constructor(
    private readonly body: HTMLElement,
    private readonly count: HTMLElement,
    private readonly options: ElementsPanelOptions,
  ) {}

  render(node?: ModelSnapshotObject, sourceElementName?: string): void {
    this.hoveredElement = undefined;
    this.focusedElement = undefined;
    this.options.onPreview(undefined);
    this.body.replaceChildren();
    this.count.textContent = String(node?.elements.length ?? 0);

    if (!node) {
      this.body.append(
        emptyMessage('Select a model expression to inspect its elements.'),
      );
      return;
    }

    const heading = document.createElement('div');
    heading.className = 'elements-heading';
    const eyebrow = document.createElement('span');
    eyebrow.textContent = 'CURRENT MODEL';
    const title = document.createElement('strong');
    title.textContent = node.name;
    heading.append(eyebrow, title);

    if (node.elements.length === 0) {
      this.body.append(
        heading,
        emptyMessage('This model exposes no elements.'),
      );
      return;
    }

    const list = document.createElement('div');
    list.className = 'elements-list';
    list.setAttribute('role', 'list');
    node.elements.forEach(element => {
      list.append(this.elementRow(element, element.name === sourceElementName));
    });

    const hint = document.createElement('p');
    hint.className = 'elements-hint';
    hint.textContent = 'Hover or focus an element to highlight it.';
    this.body.append(heading, list, hint);
  }

  private elementRow(
    element: ElementSnapshot,
    sourceActive: boolean,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'element-row';
    row.classList.toggle('source-active', sourceActive);
    row.tabIndex = 0;
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label', `${element.name}, ${element.kind}`);

    const glyph = document.createElement('span');
    glyph.className = 'element-kind-glyph';
    glyph.dataset.kind = element.kind;
    glyph.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'element-name';
    name.textContent = element.name;
    const kind = document.createElement('span');
    kind.className = 'element-kind-label';
    kind.textContent = element.kind.toUpperCase();
    row.append(glyph, name, kind);

    row.addEventListener('pointerenter', () => {
      this.hoveredElement = element;
      this.updatePreview();
    });
    row.addEventListener('pointerleave', () => {
      if (this.hoveredElement === element) this.hoveredElement = undefined;
      this.updatePreview();
    });
    row.addEventListener('focus', () => {
      this.focusedElement = element;
      this.updatePreview();
    });
    row.addEventListener('blur', () => {
      if (this.focusedElement === element) this.focusedElement = undefined;
      this.updatePreview();
    });
    return row;
  }

  private updatePreview(): void {
    this.options.onPreview(this.hoveredElement ?? this.focusedElement);
  }
}

function emptyMessage(message: string): HTMLParagraphElement {
  const empty = document.createElement('p');
  empty.className = 'elements-empty';
  empty.textContent = message;
  return empty;
}
