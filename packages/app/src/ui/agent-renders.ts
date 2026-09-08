import {decodeBase64} from '@code3d/agent';
import {ChevronLeft, ChevronRight, Expand, X} from 'lucide';
import type {AgentRenderHistory, AgentRender} from '../agent/render-history';
import {createIcon} from './icons';

/** Images only: selecting history never selects source or drives the live camera. */
export class AgentRenderView {
  readonly root = document.createElement('section');
  private readonly preview = document.createElement('button');
  private readonly previewImage = document.createElement('img');
  private readonly previewName = document.createElement('span');
  private readonly previewTime = document.createElement('time');
  private readonly viewer = document.createElement('section');
  private readonly image = document.createElement('img');
  private readonly name = document.createElement('span');
  private readonly time = document.createElement('time');
  private readonly count = document.createElement('span');
  private readonly filter = document.createElement('select');
  private readonly timeline = document.createElement('div');
  private readonly closeButton = control('Back to live view', X, () =>
    this.close(),
  );
  private readonly dismissButton = control(
    'Dismiss snapshot preview',
    X,
    () => {
      this.dismissedFrames = new Set(this.history.items.map(item => item.id));
      this.refreshPreviewVisibility();
    },
  );
  private readonly previous = control('Previous snapshot', ChevronLeft, () =>
    this.move(-1),
  );
  private readonly next = control('Next snapshot', ChevronRight, () =>
    this.move(1),
  );
  private readonly latest = document.createElement('button');
  private readonly urls = new Map<string, string>();
  private readonly thumbnails = new Map<string, HTMLButtonElement>();
  private readonly inactive = new Map<HTMLElement, boolean>();
  private readonly unsubscribe: () => void;
  private selected?: string;
  private dismissedFrames?: ReadonlySet<string>;
  private following = true;
  private agent = '';
  private activeAgents: ReadonlySet<string> = new Set();

  constructor(
    private readonly host: HTMLElement,
    private readonly history: AgentRenderHistory,
  ) {
    this.root.className = 'agent-renders';
    this.root.setAttribute('aria-label', 'Agent snapshots');
    this.root.hidden = true;
    this.preview.type = 'button';
    this.preview.className = 'agent-render-preview';
    this.preview.setAttribute('aria-expanded', 'false');
    this.preview.setAttribute('aria-controls', 'agent-render-viewer');
    this.previewImage.alt = '';
    const previewCaption = document.createElement('span');
    previewCaption.className = 'agent-render-preview-caption';
    this.previewName.className = 'agent-render-agent';
    previewCaption.append(
      this.previewName,
      this.previewTime,
      createIcon(Expand),
    );
    this.preview.append(this.previewImage, previewCaption);
    this.preview.addEventListener('click', () => this.open());

    this.viewer.id = 'agent-render-viewer';
    this.viewer.className = 'agent-render-viewer';
    this.viewer.setAttribute('aria-label', 'Agent render history');
    this.viewer.hidden = true;
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = 'Agent snapshots';
    this.filter.setAttribute('aria-label', 'Filter snapshots by agent');
    this.filter.addEventListener('change', () => {
      this.agent = this.filter.value;
      this.following = true;
      this.refresh(true);
    });
    header.append(title, this.filter, this.closeButton);
    const figure = document.createElement('figure');
    const imageHost = document.createElement('div');
    imageHost.className = 'agent-render-image';
    imageHost.append(this.image);
    const caption = document.createElement('figcaption');
    this.name.className = 'agent-render-agent';
    this.count.className = 'agent-render-count';
    caption.append(this.name, this.time, this.count);
    figure.append(imageHost, caption);
    const footer = document.createElement('footer');
    const navigation = document.createElement('nav');
    navigation.setAttribute('aria-label', 'Snapshot navigation');
    this.latest.type = 'button';
    this.latest.className = 'quiet-button';
    this.latest.textContent = 'Latest';
    this.latest.setAttribute('aria-label', 'Show latest snapshot');
    this.latest.addEventListener('click', () => {
      this.following = true;
      this.refresh(true);
    });
    navigation.append(this.previous, this.latest, this.next);
    this.timeline.className = 'agent-render-timeline';
    this.timeline.setAttribute('role', 'listbox');
    this.timeline.setAttribute('aria-label', 'Render timeline');
    this.timeline.setAttribute('aria-orientation', 'horizontal');
    this.timeline.addEventListener('keydown', event => {
      const items = this.items();
      const index = items.findIndex(item => item.id === this.selected);
      const target =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : event.key === 'ArrowLeft'
              ? index - 1
              : event.key === 'ArrowRight'
                ? index + 1
                : undefined;
      if (target === undefined) return;
      event.preventDefault();
      this.select(items[Math.max(0, Math.min(items.length - 1, target))].id);
      this.thumbnails.get(this.selected!)!.focus({preventScroll: true});
    });
    footer.append(navigation, this.timeline);
    this.viewer.append(header, figure, footer);
    this.dismissButton.classList.add('agent-render-dismiss');
    this.root.append(this.preview, this.dismissButton, this.viewer);
    this.host.append(this.root);
    this.root.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !this.viewer.hidden) {
        event.preventDefault();
        this.close();
      }
    });
    // Viewport-level camera gestures must not see clicks or wheel events on history.
    for (const event of [
      'click',
      'pointerdown',
      'pointerup',
      'wheel',
      'dblclick',
      'contextmenu',
    ])
      this.root.addEventListener(event, event => event.stopPropagation());
    this.unsubscribe = history.subscribe(() => this.refresh());
    window.addEventListener('pagehide', () => this.dispose(), {once: true});
    this.refresh();
  }

  setActiveAgents(agents: ReadonlySet<string>): void {
    this.activeAgents = agents;
    // Presence updates must not move the selected frame or the timeline scroll.
    for (const label of [this.previewName, this.name])
      label.dataset.active = String(agents.has(label.dataset.agentId ?? ''));
  }

  private refreshPreviewVisibility(): void {
    const dismissed = this.dismissedFrames;
    if (dismissed && this.history.items.some(item => !dismissed.has(item.id)))
      this.dismissedFrames = undefined;
    const hidden = !this.viewer.hidden || !!this.dismissedFrames;
    this.preview.hidden = this.dismissButton.hidden = hidden;
  }

  private open(): void {
    this.agent = '';
    this.following = true;
    this.viewer.hidden = false;
    this.refreshPreviewVisibility();
    this.preview.setAttribute('aria-expanded', 'true');
    for (const child of this.host.children) {
      if (!(child instanceof HTMLElement) || child === this.root) continue;
      this.inactive.set(child, child.inert);
      child.inert = true;
    }
    this.refresh(true);
    this.closeButton.focus({preventScroll: true});
  }

  private close(): void {
    this.viewer.hidden = true;
    this.refreshPreviewVisibility();
    this.preview.setAttribute('aria-expanded', 'false');
    for (const [child, inert] of this.inactive) child.inert = inert;
    this.inactive.clear();
    if (!this.root.hidden && !this.preview.hidden)
      this.preview.focus({preventScroll: true});
  }

  private items(): readonly AgentRender[] {
    return this.history.items.filter(
      item => !this.agent || item.agent.id === this.agent,
    );
  }

  private select(id: string): void {
    this.selected = id;
    this.following = id === this.items().at(-1)?.id;
    this.refresh(true);
  }

  private move(delta: number): void {
    const items = this.items();
    const item =
      items[items.findIndex(item => item.id === this.selected) + delta];
    if (item) this.select(item.id);
  }

  private refresh(reveal = false): void {
    const all = this.history.items;
    const present = new Set(all.map(item => item.id));
    for (const [id, url] of this.urls) {
      if (present.has(id)) continue;
      URL.revokeObjectURL(url);
      this.urls.delete(id);
    }
    for (const [id, button] of this.thumbnails) {
      if (present.has(id)) continue;
      button.remove();
      this.thumbnails.delete(id);
    }
    const latest = all.at(-1);
    this.root.hidden = !latest;
    this.refreshPreviewVisibility();
    if (!latest) {
      this.close();
      this.image.removeAttribute('src');
      this.previewImage.removeAttribute('src');
      this.timeline.replaceChildren();
      this.thumbnails.clear();
      this.selected = undefined;
      return;
    }
    this.previewImage.src = this.url(latest);
    this.previewName.textContent = latest.agent.name;
    this.previewName.dataset.agentId = latest.agent.id;
    this.previewName.dataset.active = String(
      this.activeAgents.has(latest.agent.id),
    );
    this.preview.className = `agent-render-preview agent-color-${latest.agent.color}`;
    this.dismissButton.className = `quiet-button agent-render-control agent-render-dismiss agent-color-${latest.agent.color}`;
    stamp(this.previewTime, latest.capturedAt);
    this.preview.setAttribute(
      'aria-label',
      `View agent snapshots · ${latest.agent.name}`,
    );
    if (this.viewer.hidden) return;

    const agents = new Map(all.map(item => [item.agent.id, item.agent]));
    if (!agents.has(this.agent)) this.agent = '';
    const options = [
      ['', 'All agents'],
      ...[...agents.values()].map(agent => [agent.id, agent.name]),
    ];
    if (
      options.length !== this.filter.options.length ||
      options.some(
        ([id, name], index) =>
          this.filter.options[index]?.value !== id ||
          this.filter.options[index]?.text !== name,
      )
    )
      this.filter.replaceChildren(
        ...options.map(([id, name]) => new Option(name, id)),
      );
    this.filter.value = this.agent;
    const items = this.items();
    if (!items.some(item => item.id === this.selected)) this.following = true;
    if (this.following) this.selected = items.at(-1)!.id;
    const index = items.findIndex(item => item.id === this.selected);
    const selected = items[index];
    const url = this.url(selected);
    const changed = this.image.src !== url;
    if (changed) this.image.src = url;
    this.image.alt = `Render from ${selected.agent.name} at ${new Date(selected.capturedAt).toLocaleString()}`;
    this.name.className = `agent-render-agent agent-color-${selected.agent.color}`;
    this.name.textContent = selected.agent.name;
    this.name.dataset.agentId = selected.agent.id;
    this.name.dataset.active = String(this.activeAgents.has(selected.agent.id));
    stamp(this.time, selected.capturedAt);
    this.count.textContent = `${index + 1} / ${items.length}`;
    this.previous.disabled = index === 0;
    this.next.disabled = index === items.length - 1;
    this.latest.disabled = this.following;
    const visible = new Set(items.map(item => item.id));
    for (const [id, button] of this.thumbnails) {
      if (visible.has(id)) continue;
      button.remove();
      this.thumbnails.delete(id);
    }
    for (const [index, item] of items.entries()) {
      let button = this.thumbnails.get(item.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = `agent-render-thumb agent-color-${item.agent.color}`;
        button.setAttribute('role', 'option');
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.src = this.url(item);
        const label = document.createElement('span');
        label.textContent = item.agent.name;
        const time = document.createElement('time');
        stamp(time, item.capturedAt);
        button.append(image, label, time);
        button.addEventListener('click', () => this.select(item.id));
        this.thumbnails.set(item.id, button);
      }
      button.setAttribute('aria-selected', String(item.id === this.selected));
      button.setAttribute(
        'aria-label',
        `${item.agent.name} · ${new Date(item.capturedAt).toLocaleString()}`,
      );
      button.tabIndex = item.id === this.selected ? 0 : -1;
      if (this.timeline.children[index] !== button)
        this.timeline.insertBefore(
          button,
          this.timeline.children[index] ?? null,
        );
    }
    if (reveal || changed)
      this.thumbnails
        .get(this.selected!)!
        .scrollIntoView({block: 'nearest', inline: 'nearest'});
  }

  private url(item: AgentRender): string {
    let url = this.urls.get(item.id);
    if (!url) {
      url = URL.createObjectURL(
        new Blob([decodeBase64(item.image.base64, 'Render image')], {
          type: 'image/png',
        }),
      );
      this.urls.set(item.id, url);
    }
    return url;
  }

  private dispose(): void {
    this.unsubscribe();
    this.close();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.root.remove();
  }
}

function control(
  label: string,
  icon: typeof X,
  action: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quiet-button agent-render-control';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(createIcon(icon));
  button.addEventListener('click', action);
  return button;
}

function stamp(element: HTMLTimeElement, value: string): void {
  element.dateTime = value;
  element.title = new Date(value).toLocaleString();
  element.textContent = new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
