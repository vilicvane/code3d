import {
  compareTopologyIds,
  formatTopologyId,
  TopologyIdSet,
  type ElementSnapshot,
  type ModelSnapshotObject,
  type TopologyId,
  type TopologyKind,
} from '@code3d/core/tooling';

export type ElementsPanelPreview =
  | Readonly<{kind: 'reference'; element: ElementSnapshot}>
  | Readonly<{kind: 'topology'; topologyKind: TopologyKind; id: TopologyId}>;

export type ElementsPanelOptions = Readonly<{
  onPreview: (element: ElementsPanelPreview | undefined) => void;
}>;

export class ElementsPanel {
  private hoveredElement?: ElementsPanelPreview;
  private focusedElement?: ElementsPanelPreview;
  private activeTab: ElementsPanelPreview['kind'] = 'topology';

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
    this.count.textContent = '0';

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

    const tabs = document.createElement('div');
    tabs.className = 'elements-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Element category');
    const content = document.createElement('div');
    content.className = 'elements-content';
    content.id = `${this.body.id}-tabpanel`;
    content.setAttribute('role', 'tabpanel');
    const buttons = (['topology', 'reference'] as const).map(category => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.id = `${this.body.id}-tab-${category}`;
      tab.textContent = category === 'topology' ? 'Topology' : 'References';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', content.id);
      tab.addEventListener('click', () => {
        this.activeTab = category;
        renderContent();
      });
      tabs.append(tab);
      return tab;
    });
    tabs.addEventListener('keydown', event => {
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : event.key === 'ArrowRight'
              ? (index + 1) % buttons.length
              : event.key === 'ArrowLeft'
                ? (index + buttons.length - 1) % buttons.length
                : undefined;
      if (next === undefined) return;
      event.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    });
    const renderContent = (): void => {
      this.hoveredElement = undefined;
      this.focusedElement = undefined;
      this.updatePreview();
      content.replaceChildren();
      buttons.forEach((button, index) => {
        const active = index === (this.activeTab === 'topology' ? 0 : 1);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        if (active) content.setAttribute('aria-labelledby', button.id);
      });
      const list = document.createElement('div');
      list.className = 'elements-list';
      list.setAttribute('role', 'list');
      if (this.activeTab === 'topology' && node.mesh) {
        const mesh = node.mesh;
        const groups = {
          surface: mesh.surfaceGroups.map(group => group.surfaceId),
          edge: mesh.edgeGroups.map(group => group.edgeId),
          vertex: mesh.vertexIds,
        };
        for (const kind of ['surface', 'edge', 'vertex'] as const) {
          for (const id of [...new TopologyIdSet(groups[kind])].sort(
            compareTopologyIds,
          )) {
            list.append(
              this.elementRow(formatTopologyId(kind, id), kind, {
                kind: 'topology',
                topologyKind: kind,
                id,
              }),
            );
          }
        }
      } else if (this.activeTab === 'reference') {
        node.elements.forEach(element => {
          list.append(
            this.elementRow(
              element.name,
              element.kind,
              {kind: 'reference', element},
              element.name === sourceElementName,
            ),
          );
        });
      }
      this.count.textContent = String(list.childElementCount);
      if (list.childElementCount === 0) {
        content.append(
          emptyMessage(
            this.activeTab === 'topology'
              ? 'This model has no surface, edge or vertex topology.'
              : 'This model exposes no reference elements.',
          ),
        );
        return;
      }
      const hint = document.createElement('p');
      hint.className = 'elements-hint';
      hint.textContent = 'Hover or focus an element to highlight it.';
      content.append(list, hint);
    };
    this.body.append(heading, tabs, content);
    renderContent();
  }

  private elementRow(
    label: string,
    elementKind: ElementSnapshot['kind'] | TopologyKind,
    element: ElementsPanelPreview,
    sourceActive = false,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'element-row';
    row.classList.toggle('source-active', sourceActive);
    row.tabIndex = 0;
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label', `${label}, ${elementKind}`);

    const glyph = document.createElement('span');
    glyph.className = 'element-kind-glyph';
    glyph.dataset.kind = elementKind;
    glyph.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'element-name';
    name.textContent = label;
    const kind = document.createElement('span');
    kind.className = 'element-kind-label';
    kind.textContent = elementKind.toUpperCase();
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
