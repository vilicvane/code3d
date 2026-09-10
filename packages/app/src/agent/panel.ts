import {
  AgentEndpoint,
  AgentError,
  LocalHost,
  createAgentConfig,
  parsePort,
  randomAgentPort,
  type AgentConfig,
  type HostState,
} from '@code3d/agent';
import type {CodeEditor} from '../editor';
import type {AgentProjectSession} from './project-session';
import {agentPrompt} from './prompt';
import {AgentPersistence} from './persistence';
import {randomAgentColor} from './colors';
import {randomAgentName} from './names';
import type {AgentRenderHistory} from './render-history';
import {MousePointer2, UserRoundCog} from 'lucide';
import {createIcon} from '../ui/icons';

type Grant = {
  config: AgentConfig;
  color: number;
  interacted: boolean;
  endpoint: AgentEndpoint;
  lastSeen?: string;
  busy: number;
  host?: LocalHost;
  state: HostState;
};

type AgentRow = {
  element: HTMLDivElement;
  identity: HTMLDivElement;
  activity: HTMLSpanElement;
};

export class AgentPanel {
  private readonly navigation = document.createElement('div');
  private readonly badges = new Map<string, HTMLButtonElement>();
  private followedAgentId?: string;
  private readonly followListeners = new Set<(agentId?: string) => void>();
  private readonly dialog = document.createElement('dialog');
  private readonly createForm = document.createElement('div');
  private readonly createFields = document.createElement('fieldset');
  private readonly port = document.createElement('input');
  private readonly name = document.createElement('input');
  private readonly prompt = document.createElement('textarea');
  private readonly promptSection = document.createElement('section');
  private readonly promptMessage = document.createElement('p');
  private readonly list = document.createElement('div');
  private readonly status = document.createElement('span');
  private readonly connection = document.createElement('details');
  private readonly connectionToggle = document.createElement('summary');
  private readonly connectionStatus = document.createElement('p');
  private readonly connectionUrl = document.createElement('span');
  private readonly addButton = button('Add agent & copy prompt', () =>
    this.add(),
  );
  private readonly revokeAll = button('Revoke all', () => {
    this.connection.open = false;
    this.run(() => this.end());
  });
  private readonly message = document.createElement('p');
  private readonly retry = button('Retry saving', () =>
    this.run(async () => {
      await this.project.retrySaves();
      this.message.textContent = 'Project saved.';
    }),
  );
  private readonly grants = new Map<string, Grant>();
  private readonly rows = new Map<string, AgentRow>();
  private sessionId?: string;
  private adding = false;
  private generation = 0;
  private displayedAgentId?: string;
  private copyFeedbackTimer?: number;
  private promptGeneration = 0;
  private storage?: AgentPersistence;
  private readonly initialization: Promise<void>;
  private readonly inFlight = new Set<Promise<unknown>>();
  private available = false;
  private operations = Promise.resolve();

  constructor(
    private readonly editor: CodeEditor,
    private readonly project: AgentProjectSession,
    private readonly open: HTMLButtonElement,
    private readonly workspace: string | undefined,
    private readonly renders: AgentRenderHistory,
    private readonly presenceChanged: (
      activeAgents: ReadonlySet<string>,
    ) => void,
  ) {
    this.navigation.className = 'agent-nav-agents';
    open.before(this.navigation);
    open.setAttribute('aria-label', 'Connect Agent');
    open.title = 'Connect Agent';
    this.dialog.className = 'app-dialog agent-dialog';
    this.dialog.setAttribute('aria-label', 'Connect Agent');
    const content = document.createElement('div');
    content.className = 'app-dialog-content';
    const heading = document.createElement('header');
    const titleLine = document.createElement('div');
    titleLine.className = 'agent-header-title';
    const title = document.createElement('h2');
    title.textContent = 'Connect Agent';
    this.port.type = 'number';
    this.port.required = true;
    this.port.min = '1024';
    this.port.max = '65535';
    this.port.step = '1';
    this.port.value = String(randomAgentPort());
    this.name.value = this.suggestName();
    this.name.maxLength = 64;
    this.prompt.rows = 12;
    this.prompt.readOnly = true;
    this.prompt.setAttribute('aria-label', 'Agent prompt');
    this.status.className = 'agent-status';
    this.status.setAttribute('role', 'status');
    this.connection.className = 'agent-connection';
    this.connectionToggle.setAttribute('aria-label', 'Local agent connections');
    this.connectionToggle.append(this.status, 'Local');
    const connectionMenu = document.createElement('div');
    connectionMenu.className = 'agent-connection-menu';
    this.connectionUrl.className = 'agent-connection-url';
    this.revokeAll.classList.add('agent-revoke-all', 'button-danger');
    connectionMenu.append(
      this.connectionStatus,
      this.connectionUrl,
      this.revokeAll,
    );
    this.connection.append(this.connectionToggle, connectionMenu);
    this.connection.addEventListener('toggle', () => {
      this.connectionUrl.textContent = '127.0.0.1 · one local port per agent';
    });
    this.message.className = 'agent-message';
    this.message.setAttribute('role', 'status');
    this.list.className = 'agent-list';
    this.addButton.classList.add('button-primary');
    const footer = document.createElement('footer');
    footer.append(
      button('Close', () => this.dialog.close()),
      this.addButton,
    );
    const feedback = document.createElement('div');
    feedback.className = 'agent-feedback';
    feedback.append(this.message, this.retry);
    const copy = button('Copy displayed prompt', () =>
      this.run(() => this.copy(this.displayedAgentId!, this.prompt.value)),
    );
    const note = document.createElement('p');
    note.className = 'agent-note';
    note.textContent =
      'Copy a prompt to your local agent to start its CLI service. Allow this site to connect to your local network when asked. This page keeps reconnecting until you revoke access. Keep it open while agents work.';
    titleLine.append(title, this.connection);
    heading.append(titleLine, note);
    this.createFields.append(
      field('Agent name', this.name),
      field('Local port', this.port),
    );
    const promptActions = document.createElement('div');
    promptActions.className = 'agent-prompt-actions';
    this.promptMessage.className = 'agent-prompt-message';
    this.promptMessage.setAttribute('role', 'status');
    promptActions.append(this.promptMessage, copy);
    this.promptSection.className = 'agent-prompt';
    this.promptSection.append(this.prompt, promptActions);
    this.createForm.className = 'agent-create-form';
    const createContent = document.createElement('div');
    createContent.className = 'agent-create-content';
    createContent.append(this.createFields, feedback, footer);
    this.createForm.append(createContent);
    content.append(heading, this.list, this.createForm);
    this.dialog.append(content);
    document.body.append(this.dialog);
    open.addEventListener('click', () => {
      this.refresh();
      this.dialog.showModal();
    });
    this.dialog.addEventListener('click', event => {
      if (event.target === this.dialog) this.dialog.close();
    });
    this.dialog.addEventListener('cancel', event => {
      if (!this.connection.open) return;
      event.preventDefault();
      this.connection.open = false;
    });
    this.dialog.addEventListener('keydown', event => event.stopPropagation());
    this.dialog.addEventListener('close', () => {
      this.connection.open = false;
      this.clearPromptMessage();
      this.finishCreateAnimation();
    });
    document.addEventListener('pointerdown', event => {
      if (!this.connection.contains(event.target as Node))
        this.connection.open = false;
    });
    window.addEventListener('pagehide', () => this.suspend());
    window.addEventListener('pageshow', event => {
      if (event.persisted) window.location.reload();
    });
    this.initialization = this.restore();
    this.run(() => this.initialization);
    this.refresh();
  }

  get followingAgentId(): string | undefined {
    return this.followedAgentId;
  }

  onFollowChange(listener: (agentId?: string) => void): () => void {
    this.followListeners.add(listener);
    return () => this.followListeners.delete(listener);
  }

  refresh(): void {
    this.presenceChanged(
      new Set(
        [...this.grants.values()]
          .filter(isActive)
          .map(grant => grant.config.agentId),
      ),
    );
    this.open.replaceChildren();
    this.open.classList.toggle('button-primary', !this.grants.size);
    if (!this.grants.size) this.open.textContent = 'Connect Agent';
    else this.open.append(createIcon(UserRoundCog));
    this.navigation.hidden = !this.grants.size;
    if (this.followedAgentId && !this.grants.has(this.followedAgentId))
      this.followedAgentId = undefined;
    for (const [id, badge] of this.badges) {
      if (this.grants.has(id)) continue;
      badge.remove();
      this.badges.delete(id);
    }
    for (const grant of this.grants.values()) {
      const id = grant.config.agentId;
      let badge = this.badges.get(id);
      if (!badge) {
        badge = document.createElement('button');
        badge.type = 'button';
        badge.addEventListener('click', () => {
          this.followedAgentId = this.followedAgentId === id ? undefined : id;
          this.refresh();
          for (const listener of this.followListeners)
            listener(this.followedAgentId);
        });
        this.badges.set(id, badge);
        this.navigation.append(badge);
      }
      const identity = agentBadge(grant);
      const following = this.followedAgentId === id;
      badge.className = identity.className;
      badge.dataset.active = identity.dataset.active;
      badge.dataset.agentId = id;
      badge.setAttribute('aria-pressed', String(following));
      badge.setAttribute(
        'aria-label',
        `${following ? 'Stop following' : 'Follow'} ${grant.config.name}`,
      );
      badge.title = `${badge.getAttribute('aria-label')} · ${grant.state === 'online' ? 'Connected' : 'Disconnected'}`;
      badge.replaceChildren(...identity.childNodes);
      if (following)
        badge.append(createIcon(MousePointer2, 'agent-follow-icon'));
    }
    this.addButton.disabled = !this.available || this.adding;
    this.retry.hidden = !this.project.hasUnsaved;
    const online = [...this.grants.values()].filter(
      grant => grant.state === 'online',
    ).length;
    this.status.dataset.state = !this.grants.size
      ? 'closed'
      : online === this.grants.size
        ? 'online'
        : 'connecting';
    this.status.title = `${!this.grants.size ? 'No active agents' : `${online} of ${this.grants.size} local agents connected${online < this.grants.size ? ' · retrying disconnected agents' : ''}`}${this.project.hasUnsaved ? ' · Changes waiting to be saved' : ''}`;
    this.status.setAttribute('aria-label', this.status.title);
    this.connectionToggle.title = this.status.title;
    this.connectionStatus.textContent = this.status.title;
    this.connectionUrl.textContent = '127.0.0.1 · one local port per agent';
    this.revokeAll.disabled = !this.grants.size;
    for (const [agentId, row] of this.rows) {
      if (this.grants.has(agentId)) continue;
      row.element.remove();
      this.rows.delete(agentId);
    }
    for (const grant of this.grants.values()) {
      const agentId = grant.config.agentId;
      let row = this.rows.get(agentId);
      if (!row) {
        row = this.createRow(grant);
        this.rows.set(agentId, row);
        this.list.append(row.element);
      }
      row.activity.title =
        grant.state === 'online'
          ? 'Connected to the local CLI service'
          : 'Waiting for the local CLI service · retrying automatically';
      row.activity.textContent = grant.busy
        ? 'Working'
        : grant.lastSeen
          ? ''
          : 'Never connected';
      row.activity.hidden = !row.activity.textContent;
      row.identity.replaceChildren(agentBadge(grant), row.activity);
      if (
        this.displayedAgentId === agentId &&
        this.promptSection.parentElement !== row.element
      )
        row.element.append(this.promptSection);
    }
  }

  private createRow(grant: Grant): AgentRow {
    const row = document.createElement('div');
    row.className = 'agent-row';
    const summary = document.createElement('div');
    summary.className = 'agent-row-summary';
    const activity = document.createElement('span');
    activity.className = 'agent-row-status';
    const identity = document.createElement('div');
    identity.className = 'agent-row-identity';
    summary.append(identity);
    const actions = document.createElement('div');
    actions.className = 'agent-row-actions';
    const revoke = button('Revoke', () =>
      this.run(async () => {
        await this.persist(grant.config.agentId);
        grant.host?.close();
        grant.endpoint.close();
        this.grants.delete(grant.config.agentId);
        this.renders.remove(grant.config.agentId);
        this.editor.removeAgentCursor(grant.config.agentId);
        this.project.forgetAgent(grant.config.agentId);
        if (this.displayedAgentId === grant.config.agentId) {
          this.hidePrompt();
          this.message.textContent = 'Agent revoked.';
        }
        this.refresh();
      }),
    );
    revoke.classList.add('button-danger');
    actions.append(
      button('Copy initial prompt', () => this.copyGrant(grant, true)),
      button('Copy update', () => this.copyGrant(grant, false)),
      revoke,
    );
    const port = document.createElement('input');
    port.type = 'number';
    port.min = '1024';
    port.max = '65535';
    port.step = '1';
    port.value = String(grant.config.port);
    port.className = 'agent-port-input';
    port.setAttribute('aria-label', `${grant.config.name} port`);
    port.addEventListener('change', () =>
      this.run(() => this.updatePort(grant, port)),
    );
    const local = document.createElement('label');
    local.className = 'agent-port';
    const portLabel = document.createElement('span');
    portLabel.textContent = 'Port';
    local.append(portLabel, port);
    actions.prepend(local);
    row.append(summary, actions);
    return {element: row, identity, activity};
  }

  private add(): void {
    if (this.adding) return;
    const name = this.name.value.trim() || this.suggestName();
    this.adding = true;
    this.refresh();
    const generation = this.generation;
    this.run(
      async () => {
        await this.initialization;
        if (!this.available || generation !== this.generation) return;
        if (this.grants.size >= 16)
          throw new Error(
            'This page supports up to 16 agent grants. Revoke an unused grant first.',
          );
        const port = this.availablePort(Number(this.port.value));
        this.sessionId ??= crypto.randomUUID();
        const config = createAgentConfig({
          port,
          origin: location.origin,
          sessionId: this.sessionId,
          name,
        });
        const color = randomAgentColor();
        const endpoint = await this.createEndpoint(config, color);
        if (generation !== this.generation) {
          endpoint.close();
          return;
        }
        const grant: Grant = {
          config,
          color,
          endpoint,
          busy: 0,
          interacted: false,
          state: 'closed',
        };
        this.grants.set(config.agentId, grant);
        try {
          await this.persist();
        } catch (error) {
          this.grants.delete(config.agentId);
          endpoint.close();
          if (!this.grants.size) this.sessionId = undefined;
          throw error;
        }
        if (generation !== this.generation) return;
        this.editor.setAgentCursor(
          config.agentId,
          config.name,
          undefined,
          grant.color,
        );
        this.revealCreateForm();
        this.connect(grant);
        this.port.value = String(
          randomAgentPort(
            [...this.grants.values()].map(grant => grant.config.port),
          ),
        );
        this.name.value = this.suggestName();
        await this.copy(config.agentId, agentPrompt(config, true));
      },
      () => {
        this.adding = false;
      },
    );
  }

  private revealCreateForm(): void {
    this.finishCreateAnimation();
    if (
      !this.dialog.open ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    this.createForm.inert = true;
    this.createFields.disabled = true;
    this.createForm.classList.add('agent-create-revealing');
    const animation = this.createForm.animate(
      {gridTemplateRows: ['0fr', '1fr'], opacity: [0, 1]},
      {
        delay: 80,
        duration: 360,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'backwards',
      },
    );
    animation.onfinish = () => this.finishCreateAnimation();
  }

  private finishCreateAnimation(): void {
    for (const animation of this.createForm.getAnimations()) animation.cancel();
    this.createForm.classList.remove('agent-create-revealing');
    this.createForm.inert = false;
    this.createFields.disabled = false;
  }

  private async handle(agentId: string, envelope: unknown): Promise<unknown> {
    const grant = this.grants.get(agentId);
    if (!grant)
      throw new AgentError(
        'unknown_agent',
        'This agent grant is absent or revoked.',
      );
    grant.busy++;
    this.refresh();
    try {
      const result = await grant.endpoint.handle(envelope);
      return result;
    } finally {
      grant.busy--;
      this.refresh();
    }
  }

  private createEndpoint(
    config: AgentConfig,
    color: number,
  ): Promise<AgentEndpoint> {
    const journal = this.storage!.journal(config);
    const generation = this.generation;
    const agent = {id: config.agentId, name: config.name, color};
    return AgentEndpoint.create(
      config,
      request => this.project.handle(config.agentId, config.name, request),
      {
        journal: {
          load: async () => {
            const receipts = await journal.load();
            if (generation === this.generation)
              for (const receipt of receipts)
                this.renders.record(agent, receipt);
            return receipts;
          },
          write: async receipt => {
            await journal.write(receipt);
            if (
              generation === this.generation &&
              this.grants.has(config.agentId)
            )
              this.renders.record(agent, receipt);
          },
        },
        onRequest: async () => {
          const grant = this.grants.get(config.agentId)!;
          grant.interacted = true;
          grant.lastSeen = new Date().toISOString();
          this.editor.setAgentActivity(config.agentId, grant.lastSeen);
          this.refresh();
          await this.storage!.recordActivity(config, grant.lastSeen);
        },
      },
    );
  }

  private copyGrant(grant: Grant, initial: boolean): void {
    const value = agentPrompt(grant.config, initial);
    this.run(() => this.copy(grant.config.agentId, value));
  }

  private async copy(agentId: string, value: string): Promise<void> {
    if (!this.grants.has(agentId)) return;
    this.displayedAgentId = agentId;
    this.prompt.value = value;
    this.clearPromptMessage();
    const generation = this.promptGeneration;
    this.refresh();
    this.rows.get(agentId)!.element.scrollIntoView({block: 'nearest'});
    try {
      await navigator.clipboard.writeText(value);
      if (!this.dialog.open || generation !== this.promptGeneration) return;
      this.promptMessage.textContent = 'Prompt copied.';
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        this.promptMessage.animate({opacity: [0.35, 1]}, 180);
      this.copyFeedbackTimer = window.setTimeout(
        () => this.clearPromptMessage(),
        3000,
      );
    } catch {
      if (!this.dialog.open || generation !== this.promptGeneration) return;
      this.prompt.focus();
      this.prompt.select();
      this.promptMessage.textContent = 'Select and copy the prompt above.';
    }
  }

  private hidePrompt(): void {
    this.displayedAgentId = undefined;
    this.prompt.value = '';
    this.clearPromptMessage();
    this.promptSection.remove();
  }

  private clearPromptMessage(): void {
    this.promptGeneration++;
    window.clearTimeout(this.copyFeedbackTimer);
    this.copyFeedbackTimer = undefined;
    this.promptMessage.textContent = '';
    for (const animation of this.promptMessage.getAnimations())
      animation.cancel();
  }

  private async restore(): Promise<void> {
    if (!this.workspace)
      throw new Error('Reconnect the project folder to activate its agents.');
    const generation = this.generation;
    const suggestedName = this.name.value;
    const storage = await AgentPersistence.open(this.workspace);
    if (generation !== this.generation) {
      await storage.close();
      return;
    }
    this.storage = storage;
    const saved = await storage.load();
    if (generation !== this.generation) return;
    if (saved) {
      const restored = await Promise.all(
        saved.grants.map(async ({config, color, lastSeen}) => {
          const endpoint = await this.createEndpoint(config, color);
          return {
            config,
            color,
            endpoint,
            lastSeen,
            busy: 0,
            interacted: false,
            state: 'closed' as const,
          };
        }),
      );
      if (generation !== this.generation) {
        for (const grant of restored) grant.endpoint.close();
        return;
      }
      this.sessionId = saved.sessionId;
      for (const grant of restored) {
        this.grants.set(grant.config.agentId, grant);
        this.editor.setAgentCursor(
          grant.config.agentId,
          grant.config.name,
          undefined,
          grant.color,
        );
        if (grant.lastSeen)
          this.editor.setAgentActivity(grant.config.agentId, grant.lastSeen);
      }
      if (this.name.value === suggestedName)
        this.name.value = this.suggestName();
      for (const grant of this.grants.values()) this.connect(grant);
      this.port.value = String(
        randomAgentPort(
          [...this.grants.values()].map(grant => grant.config.port),
        ),
      );
    }
    this.available = true;
  }

  private suggestName(): string {
    return randomAgentName(
      [...this.grants.values()].map(grant => grant.config.name),
    );
  }

  private availablePort(value: number, agentId?: string): number {
    const port = parsePort(value);
    if (
      [...this.grants.values()].some(
        grant => grant.config.agentId !== agentId && grant.config.port === port,
      )
    )
      throw new Error(
        'Another agent in this project uses that port. Choose a different port.',
      );
    return port;
  }

  private async updatePort(
    grant: Grant,
    input: HTMLInputElement,
  ): Promise<void> {
    if (!this.available) return;
    const generation = this.generation;
    const previous = grant.config;
    try {
      const port = this.availablePort(Number(input.value), previous.agentId);
      if (port === previous.port) return;
      grant.config = {...previous, port};
      await this.persist();
    } catch (error) {
      grant.config = previous;
      input.value = String(previous.port);
      throw error;
    }
    if (generation !== this.generation) return;
    grant.host?.close();
    this.connect(grant);
    await this.copy(grant.config.agentId, agentPrompt(grant.config, true));
    this.message.textContent =
      'Port saved. Give the updated prompt to your agent to restart its CLI service.';
  }

  private connect(grant: Grant): void {
    grant.host = new LocalHost({
      config: grant.config,
      stateChanged: state => {
        grant.state = state;
        this.refresh();
      },
      handle: envelope => {
        const pending = this.handle(grant.config.agentId, envelope);
        this.inFlight.add(pending);
        void pending
          .finally(() => this.inFlight.delete(pending))
          .catch(() => {});
        return pending;
      },
    });
  }

  private persist(excludeAgentId?: string): Promise<void> {
    return this.storage!.save(
      this.sessionId
        ? {
            sessionId: this.sessionId,
            grants: [...this.grants.values()]
              .filter(grant => grant.config.agentId !== excludeAgentId)
              .map(({config, color, lastSeen}) => ({config, color, lastSeen})),
          }
        : undefined,
    );
  }

  private suspend(): void {
    this.clearPromptMessage();
    this.finishCreateAnimation();
    this.generation++;
    this.available = false;
    this.renders.clear();
    for (const grant of this.grants.values()) {
      grant.host?.close();
      grant.endpoint.close();
    }
    void Promise.allSettled([...this.inFlight]).then(() =>
      this.storage?.close(),
    );
  }

  private async end(): Promise<void> {
    await this.initialization;
    await this.storage!.save();
    this.finishCreateAnimation();
    this.generation++;
    this.sessionId = undefined;
    for (const grant of this.grants.values()) {
      grant.host?.close();
      grant.endpoint.close();
      this.editor.removeAgentCursor(grant.config.agentId);
      this.project.forgetAgent(grant.config.agentId);
    }
    this.grants.clear();
    this.renders.clear();
    this.hidePrompt();
    this.message.textContent = 'All agent access revoked.';
    this.refresh();
  }

  private run(operation: () => Promise<void>, finallyRun?: () => void): void {
    this.operations = this.operations
      .then(operation)
      .catch(error => {
        this.message.textContent =
          error instanceof Error ? error.message : 'Agent session failed.';
      })
      .finally(() => {
        finallyRun?.();
        this.refresh();
      });
  }
}

function isActive(grant: Grant): boolean {
  return grant.state === 'online' && grant.interacted;
}

function agentBadge(grant: Grant): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = `agent-badge agent-color-${grant.color}`;
  badge.dataset.active = String(isActive(grant));
  badge.title = `${grant.config.name} · ${grant.state === 'online' ? 'Connected' : 'Disconnected'} · ${grant.interacted ? 'Has interacted in this page' : 'No interaction since this page opened'}`;
  const dot = document.createElement('span');
  dot.className = 'agent-badge-dot';
  dot.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'agent-badge-name';
  name.textContent = grant.config.name;
  badge.append(dot, name);
  return badge;
}

function button(label: string, click: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dialog-button';
  button.textContent = label;
  button.addEventListener('click', click);
  return button;
}
function field(label: string, input: HTMLElement): HTMLLabelElement {
  const field = document.createElement('label');
  const caption = document.createElement('span');
  caption.textContent = label;
  field.append(caption, input);
  return field;
}
