import {
  action,
  computed,
  makeObservable,
  observable,
  observableRef,
  reaction,
} from 'mobx';
import type {AgentConnections} from '../agent/connections';
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
    action(() => {
      this.dismissedFrames = new Set(this.history.items.map(item => item.id));
    }),
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
  private readonly stopRendering: () => void;
  private readonly stopPresence: () => void;
  private readonly stopHistory: () => void;
  private readonly listeners = new AbortController();
  private selected: string | undefined = undefined;
  private dismissedFrames: ReadonlySet<string> | undefined = undefined;
  private opened = false;
  private following = true;
  private agent = '';

  constructor(
    private readonly host: HTMLElement,
    private readonly history: AgentRenderHistory,
    private readonly connections: Pick<AgentConnections, 'activeAgentIds'>,
  ) {
    makeObservable<
      this,
      | 'selected'
      | 'dismissedFrames'
      | 'opened'
      | 'following'
      | 'agent'
      | 'items'
      | 'selectedItem'
      | 'previewHidden'
      | 'open'
      | 'close'
      | 'select'
      | 'reconcileHistory'
    >(this, {
      selected: observable,
      dismissedFrames: observableRef,
      opened: observable,
      following: observable,
      agent: observable,
      items: computed,
      selectedItem: computed,
      previewHidden: computed,
      open: action,
      close: action,
      select: action,
      reconcileHistory: action,
    });
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
    this.filter.addEventListener(
      'change',
      action(() => {
        this.agent = this.filter.value;
        this.following = true;
      }),
    );
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
    this.latest.addEventListener(
      'click',
      action(() => {
        this.following = true;
      }),
    );
    navigation.append(this.previous, this.latest, this.next);
    this.timeline.className = 'agent-render-timeline';
    this.timeline.setAttribute('role', 'listbox');
    this.timeline.setAttribute('aria-label', 'Render timeline');
    this.timeline.setAttribute('aria-orientation', 'horizontal');
    this.timeline.addEventListener('keydown', event => {
      const items = this.items;
      const index = items.findIndex(item => item.id === this.selectedItem?.id);
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
      queueMicrotask(() => {
        const selected = this.selectedItem;
        if (selected && !this.listeners.signal.aborted)
          this.thumbnails.get(selected.id)?.focus({preventScroll: true});
      });
    });
    footer.append(navigation, this.timeline);
    this.viewer.append(header, figure, footer);
    this.dismissButton.classList.add('agent-render-dismiss');
    this.root.append(this.preview, this.dismissButton, this.viewer);
    this.host.append(this.root);
    this.root.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape' && this.opened) {
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
    this.stopHistory = reaction(
      () => history.items,
      items => this.reconcileHistory(items),
      {
        name: 'AgentRenderView.historySession',
      },
    );
    this.stopRendering = reaction(
      () => [
        history.items,
        this.items,
        this.selectedItem,
        this.opened,
        this.previewHidden,
        this.following,
      ],
      () => this.render(),
      {
        name: 'AgentRenderView.render',
        fireImmediately: true,
        scheduler: queueMicrotask,
      },
    );
    // Presence changes only affect labels, not frame selection or timeline scroll.
    this.stopPresence = reaction(
      () => connections.activeAgentIds,
      agents => {
        for (const label of [this.previewName, this.name])
          label.dataset.active = String(
            agents.has(label.dataset.agentId ?? ''),
          );
      },
      {name: 'AgentRenderView.presence', fireImmediately: true},
    );
    window.addEventListener('pagehide', () => this.dispose(), {
      once: true,
      signal: this.listeners.signal,
    });
  }

  // Expire browsing intentions when their targets disappear. New receipts end a
  // dismissal permanently, even if that new receipt is subsequently revoked.
  private reconcileHistory(items: readonly AgentRender[]): void {
    if (!items.length) {
      this.close();
      this.selected = undefined;
    }
    if (!items.some(item => item.agent.id === this.agent)) this.agent = '';
    if (!this.items.some(item => item.id === this.selected))
      this.following = true;
    if (
      this.dismissedFrames &&
      items.some(item => !this.dismissedFrames!.has(item.id))
    )
      this.dismissedFrames = undefined;
  }

  private get previewHidden(): boolean {
    return (
      this.opened ||
      (!!this.dismissedFrames &&
        this.history.items.every(item => this.dismissedFrames!.has(item.id)))
    );
  }

  private get selectedItem(): AgentRender | undefined {
    return (
      (!this.following && this.items.find(item => item.id === this.selected)) ||
      this.items.at(-1)
    );
  }

  private open(): void {
    this.agent = '';
    this.following = true;
    this.opened = true;
    for (const child of this.host.children) {
      if (!(child instanceof HTMLElement) || child === this.root) continue;
      this.inactive.set(child, child.inert);
      child.inert = true;
    }
  }

  private close(): void {
    this.opened = false;
    for (const [child, inert] of this.inactive) child.inert = inert;
    this.inactive.clear();
  }

  private get items(): readonly AgentRender[] {
    const filtered = this.history.items.filter(
      item => item.agent.id === this.agent,
    );
    return filtered.length ? filtered : this.history.items;
  }

  private select(id: string): void {
    this.selected = id;
    this.following = id === this.items.at(-1)?.id;
  }

  private move(delta: number): void {
    const items = this.items;
    const item =
      items[items.findIndex(item => item.id === this.selectedItem?.id) + delta];
    if (item) this.select(item.id);
  }

  private render(): void {
    const wasOpen = !this.viewer.hidden;
    const reveal = !wasOpen && this.opened;
    this.viewer.hidden = !this.opened;
    this.preview.hidden = this.dismissButton.hidden = this.previewHidden;
    this.preview.setAttribute('aria-expanded', String(this.opened));
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
    if (!latest) {
      for (const [child, inert] of this.inactive) child.inert = inert;
      this.inactive.clear();
      this.image.removeAttribute('src');
      this.previewImage.removeAttribute('src');
      this.timeline.replaceChildren();
      this.thumbnails.clear();
      return;
    }
    this.previewImage.src = this.url(latest);
    this.previewName.textContent = latest.agent.name;
    this.previewName.dataset.agentId = latest.agent.id;
    this.previewName.dataset.active = String(
      this.connections.activeAgentIds.has(latest.agent.id),
    );
    this.preview.className = `agent-render-preview agent-color-${latest.agent.color}`;
    this.dismissButton.className = `quiet-button agent-render-control agent-render-dismiss agent-color-${latest.agent.color}`;
    stamp(this.previewTime, latest.capturedAt);
    this.preview.setAttribute(
      'aria-label',
      `View agent snapshots · ${latest.agent.name}`,
    );
    if (this.viewer.hidden) {
      if (wasOpen && !this.previewHidden)
        this.preview.focus({preventScroll: true});
      return;
    }

    const agents = new Map(all.map(item => [item.agent.id, item.agent]));
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
    this.filter.value = agents.has(this.agent) ? this.agent : '';
    const items = this.items;
    const index = items.findIndex(item => item.id === this.selectedItem?.id);
    const selected = items[index];
    const url = this.url(selected);
    const changed = this.image.src !== url;
    if (changed) this.image.src = url;
    this.image.alt = `Render from ${selected.agent.name} at ${new Date(selected.capturedAt).toLocaleString()}`;
    this.name.className = `agent-render-agent agent-color-${selected.agent.color}`;
    this.name.textContent = selected.agent.name;
    this.name.dataset.agentId = selected.agent.id;
    this.name.dataset.active = String(
      this.connections.activeAgentIds.has(selected.agent.id),
    );
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
      button.setAttribute(
        'aria-selected',
        String(item.id === this.selectedItem?.id),
      );
      button.setAttribute(
        'aria-label',
        `${item.agent.name} · ${new Date(item.capturedAt).toLocaleString()}`,
      );
      button.tabIndex = item.id === this.selectedItem?.id ? 0 : -1;
      if (this.timeline.children[index] !== button)
        this.timeline.insertBefore(
          button,
          this.timeline.children[index] ?? null,
        );
    }
    if (reveal) this.closeButton.focus({preventScroll: true});
    if (reveal || changed)
      this.thumbnails
        .get(this.selectedItem!.id)!
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

  dispose(): void {
    this.stopRendering();
    this.stopPresence();
    this.stopHistory();
    this.listeners.abort();
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
