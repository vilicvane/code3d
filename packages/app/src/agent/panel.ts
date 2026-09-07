import {
  AgentEndpoint,
  AgentError,
  RelayHost,
  createAgentConfig,
  createHostIdentity,
  normalizeRelayUrl,
  type AgentConfig,
  type HostState,
} from '@code3d/agent';
import type {CodeEditor} from '../editor';
import type {AgentProjectSession} from './project-session';
import {agentPrompt} from './prompt';
import {AgentPersistence} from './persistence';

type Grant = {
  config: AgentConfig;
  endpoint: AgentEndpoint;
  lastSeen?: string;
  busy: number;
};

export class AgentPanel {
  private readonly dialog = document.createElement('dialog');
  private readonly relay = document.createElement('input');
  private readonly name = document.createElement('input');
  private readonly task = document.createElement('textarea');
  private readonly prompt = document.createElement('textarea');
  private readonly list = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly message = document.createElement('p');
  private readonly retry = button('Retry saving', () =>
    this.run(async () => {
      await this.project.retrySaves();
      this.message.textContent = 'Project saved.';
    }),
  );
  private readonly grants = new Map<string, Grant>();
  private host?: RelayHost;
  private identity?: Awaited<ReturnType<typeof createHostIdentity>>;
  private hostState: HostState = 'closed';
  private adding = false;
  private generation = 0;
  private displayedAgentId?: string;
  private storage?: AgentPersistence;
  private readonly initialization: Promise<void>;
  private readonly inFlight = new Set<Promise<unknown>>();
  private available = false;
  private operations = Promise.resolve();

  constructor(
    private readonly editor: CodeEditor,
    private readonly project: AgentProjectSession,
    open: HTMLButtonElement,
    private readonly workspace: string | undefined,
  ) {
    this.dialog.className = 'agent-dialog';
    this.dialog.setAttribute('aria-label', 'Local agents');
    const heading = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = 'Local agents';
    heading.append(
      title,
      button('Close', () => this.dialog.close()),
    );
    this.relay.type = 'url';
    this.relay.required = true;
    this.relay.value =
      localStorage.getItem('code3d:agent-relay') ??
      import.meta.env.VITE_AGENT_RELAY_URL ??
      (import.meta.env.DEV ? 'http://127.0.0.1:3134' : '');
    this.relay.placeholder = 'https://your-relay.example';
    this.name.value = 'Agent 1';
    this.name.maxLength = 64;
    this.task.rows = 3;
    this.task.placeholder = 'What should this agent do?';
    this.prompt.rows = 12;
    this.prompt.readOnly = true;
    this.prompt.hidden = true;
    this.prompt.setAttribute('aria-label', 'Agent prompt');
    this.status.className = 'agent-status';
    this.status.setAttribute('role', 'status');
    this.message.className = 'agent-message';
    this.message.setAttribute('role', 'status');
    this.list.className = 'agent-list';
    const actions = document.createElement('div');
    actions.className = 'agent-actions';
    actions.append(
      button('Add agent & copy prompt', () => this.add()),
      button('End session', () => this.run(() => this.end())),
      this.retry,
    );
    const copy = button('Copy displayed prompt', () =>
      this.run(() => this.copy(this.prompt.value)),
    );
    const note = document.createElement('p');
    note.className = 'agent-note';
    note.textContent =
      'Agents are saved for this project and reconnect automatically when you open it. Keep the page open while agents work. Revoke stops new requests while accepted changes finish saving.';
    this.dialog.append(
      heading,
      note,
      field('Relay URL', this.relay),
      field('Agent name', this.name),
      field('Task or update', this.task),
      actions,
      this.status,
      this.list,
      this.message,
      this.prompt,
      copy,
    );
    document.body.append(this.dialog);
    open.addEventListener('click', () => {
      this.refresh();
      this.dialog.showModal();
    });
    this.dialog.addEventListener('click', event => {
      if (event.target === this.dialog) this.dialog.close();
    });
    window.addEventListener('pagehide', () => this.suspend());
    window.addEventListener('pageshow', event => {
      if (event.persisted) window.location.reload();
    });
    this.initialization = this.restore();
    this.run(() => this.initialization);
    this.refresh();
  }

  refresh(): void {
    this.relay.disabled = this.identity !== undefined;
    this.retry.hidden = !this.project.hasUnsaved;
    this.status.textContent = `${this.hostState === 'closed' ? 'No active session' : this.hostState === 'online' ? 'App connected to relay' : this.hostState === 'connecting' ? 'Connecting to relay…' : 'Relay offline · reconnecting…'}${this.project.hasUnsaved ? ' · Changes waiting to be saved' : ''}`;
    this.list.replaceChildren(
      ...[...this.grants.values()].map(grant => {
        const row = document.createElement('div');
        row.className = 'agent-row';
        const label = document.createElement('span');
        const cursor = this.editor.agentCursor(grant.config.agentId);
        label.textContent = `${grant.config.name} · ${grant.busy ? 'Working' : grant.lastSeen ? 'Last active ' + new Date(grant.lastSeen).toLocaleTimeString() : 'Waiting for first request'}${cursor.invalid ? ' · Cursor lost' : cursor.ref ? ' · ' + cursor.ref.file : ''}`;
        row.append(
          label,
          button('Copy initial prompt', () => this.copyGrant(grant, true)),
          button('Copy update', () => this.copyGrant(grant, false)),
          button('Revoke', () =>
            this.run(async () => {
              await this.persist(grant.config.agentId);
              grant.endpoint.close();
              this.grants.delete(grant.config.agentId);
              this.editor.removeAgentCursor(grant.config.agentId);
              if (this.displayedAgentId === grant.config.agentId) {
                this.prompt.value = '';
                this.prompt.hidden = true;
                this.displayedAgentId = undefined;
                this.message.textContent = 'Agent revoked.';
              }
              this.refresh();
            }),
          ),
        );
        return row;
      }),
    );
  }

  private add(): void {
    if (this.adding) return;
    const task = this.task.value;
    const name = this.name.value.trim() || `Agent ${this.grants.size + 1}`;
    this.adding = true;
    const generation = this.generation;
    this.run(
      async () => {
        await this.initialization;
        if (!this.available || generation !== this.generation) return;
        if (this.grants.size >= 16)
          throw new Error(
            'This page supports up to 16 agent grants. Revoke an unused grant first.',
          );
        const relay = normalizeRelayUrl(this.relay.value);
        if (!this.identity) {
          const identity = await createHostIdentity();
          if (generation !== this.generation) return;
          this.identity = identity;
          localStorage.setItem('code3d:agent-relay', relay);
        }
        const config = createAgentConfig({
          relay,
          sessionId: this.identity.sessionId,
          name,
        });
        const endpoint = await AgentEndpoint.create(
          config,
          request => this.project.handle(config.agentId, name, request),
          {journal: this.storage!.journal(config)},
        );
        if (generation !== this.generation) {
          endpoint.close();
          return;
        }
        const grant: Grant = {config, endpoint, busy: 0};
        this.grants.set(config.agentId, grant);
        try {
          await this.persist();
        } catch (error) {
          this.grants.delete(config.agentId);
          endpoint.close();
          if (!this.host) this.identity = undefined;
          throw error;
        }
        if (generation !== this.generation) return;
        if (!this.host) this.connect();
        this.name.value = `Agent ${this.grants.size + 1}`;
        this.refresh();
        this.displayedAgentId = config.agentId;
        await this.copy(agentPrompt(config, true, task));
      },
      () => {
        this.adding = false;
      },
    );
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
      grant.lastSeen = new Date().toISOString();
      return result;
    } finally {
      grant.busy--;
      this.refresh();
    }
  }

  private copyGrant(grant: Grant, initial: boolean): void {
    const value = agentPrompt(grant.config, initial, this.task.value);
    this.displayedAgentId = grant.config.agentId;
    this.run(() => this.copy(value));
  }

  private async copy(value: string): Promise<void> {
    this.prompt.value = value;
    this.prompt.hidden = false;
    try {
      await navigator.clipboard.writeText(value);
      this.message.textContent = 'Prompt copied.';
    } catch {
      this.prompt.focus();
      this.prompt.select();
      this.message.textContent = 'Select and copy the prompt below.';
    }
  }

  private async restore(): Promise<void> {
    if (!this.workspace)
      throw new Error('Reconnect the project folder to activate its agents.');
    const generation = this.generation;
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
        saved.grants.map(async ({config, lastSeen}) => {
          const endpoint = await AgentEndpoint.create(
            config,
            request =>
              this.project.handle(config.agentId, config.name, request),
            {journal: storage.journal(config)},
          );
          return {config, endpoint, lastSeen, busy: 0};
        }),
      );
      if (generation !== this.generation) {
        for (const grant of restored) grant.endpoint.close();
        return;
      }
      this.identity = saved.identity;
      this.relay.value = saved.relay;
      for (const grant of restored)
        this.grants.set(grant.config.agentId, grant);
      this.name.value = `Agent ${this.grants.size + 1}`;
      this.connect();
    }
    this.available = true;
  }

  private connect(): void {
    this.host = new RelayHost({
      relay: this.relay.value,
      ...this.identity!,
      stateChanged: state => {
        this.hostState = state;
        this.refresh();
      },
      handle: (agentId, envelope) => {
        const pending = this.handle(agentId, envelope);
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
      this.identity
        ? {
            relay: this.relay.value,
            identity: this.identity,
            grants: [...this.grants.values()]
              .filter(grant => grant.config.agentId !== excludeAgentId)
              .map(({config, lastSeen}) => ({config, lastSeen})),
          }
        : undefined,
    );
  }

  private suspend(): void {
    this.generation++;
    this.available = false;
    this.host?.close();
    for (const grant of this.grants.values()) grant.endpoint.close();
    void Promise.allSettled([...this.inFlight]).then(() =>
      this.storage?.close(),
    );
  }

  private async end(): Promise<void> {
    await this.initialization;
    await this.storage!.save();
    this.generation++;
    this.host?.close();
    this.host = undefined;
    this.identity = undefined;
    this.hostState = 'closed';
    for (const grant of this.grants.values()) {
      grant.endpoint.close();
      this.editor.removeAgentCursor(grant.config.agentId);
    }
    this.grants.clear();
    this.prompt.value = '';
    this.prompt.hidden = true;
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

function button(label: string, click: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quiet-button';
  button.textContent = label;
  button.addEventListener('click', click);
  return button;
}
function field(label: string, input: HTMLElement): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = 'agent-field';
  const caption = document.createElement('span');
  caption.textContent = label;
  field.append(caption, input);
  return field;
}
