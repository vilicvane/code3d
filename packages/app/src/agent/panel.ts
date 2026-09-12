import {randomAgentPort} from '@code3d/agent';
import {autorun, makeObservable, observable, reaction, runInAction} from 'mobx';
import type {AgentProjectSession} from './project-session';
import {AgentConnections, type AgentGrant} from './connections';
import {agentPrompt} from './prompt';
import {findAgentName, randomAgentName} from './names';
import {MousePointer2, UserRoundCog} from 'lucide';
import {createIcon} from '../ui/icons';
import {AppDialog} from '../ui/dialog';

type AgentRow = {
  element: HTMLDivElement;
  identity: HTMLDivElement;
  activity: HTMLSpanElement;
  stopPort: () => void;
};

export class AgentPanel {
  private readonly navigation = document.createElement('div');
  private readonly badges = new Map<string, HTMLButtonElement>();
  private readonly modal: AppDialog;
  private readonly createForm = document.createElement('div');
  private readonly createFields = document.createElement('fieldset');
  private readonly port = document.createElement('input');
  private readonly name = document.createElement('input');
  private readonly nameWho = document.createElement('a');
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
  private readonly rows = new Map<string, AgentRow>();
  private displayedAgentId: string | undefined = undefined;
  private copyFeedbackTimer?: number;
  private promptGeneration = 0;
  private readonly stopRendering: () => void;
  private readonly listeners = new AbortController();

  constructor(
    private readonly connections: AgentConnections,
    private readonly project: AgentProjectSession,
    private readonly open: HTMLButtonElement,
  ) {
    makeObservable<this, 'displayedAgentId'>(this, {
      displayedAgentId: observable,
    });
    this.navigation.className = 'agent-nav-agents';
    open.before(this.navigation);
    open.setAttribute('aria-label', 'Connect Agent');
    open.title = 'Connect Agent';
    this.modal = new AppDialog({
      title: 'Connect Agent',
      className: 'agent-dialog',
      canDismiss: () => {
        if (!this.connection.open) return true;
        this.connection.open = false;
        return false;
      },
      onClose: () => {
        this.connection.open = false;
        this.clearPromptMessage();
        this.finishCreateAnimation();
      },
    });
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
    this.name.addEventListener('input', () => this.refreshNameLink());
    this.nameWho.className = 'agent-name-who';
    this.nameWho.target = '_blank';
    this.nameWho.rel = 'noopener noreferrer';
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
      button('Close', () => this.modal.close()),
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
    const nameField = document.createElement('div');
    nameField.className = 'agent-name-field';
    nameField.append(field('Agent name', this.name), this.nameWho);
    this.createFields.append(nameField, field('Local port', this.port));
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
    this.modal.element.append(content);
    open.addEventListener(
      'click',
      () => {
        this.modal.open();
      },
      {signal: this.listeners.signal},
    );
    document.addEventListener(
      'pointerdown',
      event => {
        if (!this.connection.contains(event.target as Node))
          this.connection.open = false;
      },
      {signal: this.listeners.signal},
    );
    this.stopRendering = autorun(() => this.render(), {
      name: 'AgentPanel.render',
    });
    window.addEventListener('pagehide', () => this.dispose(), {
      once: true,
      signal: this.listeners.signal,
    });
    const suggestedName = this.name.value;
    this.run(async () => {
      await connections.ready;
      if (this.listeners.signal.aborted) return;
      if (this.name.value === suggestedName)
        this.name.value = this.suggestName();
      this.port.value = String(
        randomAgentPort(connections.grants.map(grant => grant.config.port)),
      );
      this.refreshNameLink();
    });
    this.refreshNameLink();
  }

  private render(): void {
    const grants = this.connections.grants;
    this.open.replaceChildren();
    this.open.classList.toggle('button-primary', !grants.length);
    if (!grants.length) this.open.textContent = 'Connect Agent';
    else this.open.append(createIcon(UserRoundCog));
    this.navigation.hidden = !grants.length;
    for (const [id, badge] of this.badges) {
      if (grants.some(grant => grant.config.agentId === id)) continue;
      badge.remove();
      this.badges.delete(id);
    }
    for (const grant of grants) {
      const id = grant.config.agentId;
      let badge = this.badges.get(id);
      if (!badge) {
        badge = document.createElement('button');
        badge.type = 'button';
        badge.addEventListener('click', () => {
          this.connections.toggleFollow(id);
        });
        this.badges.set(id, badge);
        this.navigation.append(badge);
      }
      const identity = agentBadge(grant);
      const following = this.connections.followingAgentId === id;
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
    this.addButton.disabled =
      !this.connections.available || this.connections.adding;
    this.retry.hidden = !this.project.hasUnsaved;
    const online = this.connections.onlineCount;
    this.status.dataset.state = !grants.length
      ? 'closed'
      : online === grants.length
        ? 'online'
        : 'connecting';
    this.status.title = `${!grants.length ? 'No active agents' : `${online} of ${grants.length} local agents connected${online < grants.length ? ' · retrying disconnected agents' : ''}`}${this.project.hasUnsaved ? ' · Changes waiting to be saved' : ''}`;
    this.status.setAttribute('aria-label', this.status.title);
    this.connectionToggle.title = this.status.title;
    this.connectionStatus.textContent = this.status.title;
    this.connectionUrl.textContent = '127.0.0.1 · one local port per agent';
    this.revokeAll.disabled = !grants.length;
    for (const [agentId, row] of this.rows) {
      if (grants.some(grant => grant.config.agentId === agentId)) continue;
      row.stopPort();
      row.element.remove();
      this.rows.delete(agentId);
    }
    for (const grant of grants) {
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

  private createRow(grant: AgentGrant): AgentRow {
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
        await this.connections.revoke(grant.config.agentId);
        if (this.displayedAgentId === grant.config.agentId) {
          this.hidePrompt();
          this.message.textContent = 'Agent revoked.';
        }
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
    const stopPort = reaction(
      () => grant.config.port,
      value => {
        port.value = String(value);
      },
      {fireImmediately: true},
    );
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
    return {element: row, identity, activity, stopPort};
  }

  private add(): void {
    const name = this.name.value.trim() || this.suggestName();
    const port = Number(this.port.value);
    this.run(async () => {
      const grant = await this.connections.add(name, port);
      if (!grant || this.listeners.signal.aborted) return;
      this.revealCreateForm();
      this.port.value = String(
        randomAgentPort(
          this.connections.grants.map(grant => grant.config.port),
        ),
      );
      this.name.value = this.suggestName();
      this.refreshNameLink();
      await this.copy(grant.config.agentId, agentPrompt(grant.config, true));
    });
  }

  private revealCreateForm(): void {
    this.finishCreateAnimation();
    if (
      !this.modal.isOpen ||
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

  private copyGrant(grant: AgentGrant, initial: boolean): void {
    const value = agentPrompt(grant.config, initial);
    this.run(() => this.copy(grant.config.agentId, value));
  }

  private async copy(agentId: string, value: string): Promise<void> {
    if (
      !this.connections.grants.some(grant => grant.config.agentId === agentId)
    )
      return;
    runInAction(() => {
      this.displayedAgentId = agentId;
    });
    this.prompt.value = value;
    this.clearPromptMessage();
    const generation = this.promptGeneration;
    this.rows.get(agentId)!.element.scrollIntoView({block: 'nearest'});
    try {
      await navigator.clipboard.writeText(value);
      if (!this.modal.isOpen || generation !== this.promptGeneration) return;
      this.promptMessage.textContent = 'Prompt copied.';
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        this.promptMessage.animate({opacity: [0.35, 1]}, 180);
      this.copyFeedbackTimer = window.setTimeout(
        () => this.clearPromptMessage(),
        3000,
      );
    } catch {
      if (!this.modal.isOpen || generation !== this.promptGeneration) return;
      this.prompt.focus();
      this.prompt.select();
      this.promptMessage.textContent = 'Select and copy the prompt above.';
    }
  }

  private hidePrompt(): void {
    runInAction(() => {
      this.displayedAgentId = undefined;
    });
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

  private refreshNameLink(): void {
    const person = findAgentName(this.name.value);
    this.nameWho.hidden = !person;
    this.nameWho.textContent = person ? `${person.name} who?` : '';
    this.name.style.paddingRight = person
      ? `calc(${person.name.length + 5}ch + 18px)`
      : '';
    if (person) {
      this.nameWho.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(person.article)}`;
      this.nameWho.title = `Read about ${person.name} on Wikipedia (opens in a new tab)`;
    } else {
      this.nameWho.removeAttribute('href');
      this.nameWho.removeAttribute('title');
    }
  }

  private suggestName(): string {
    return randomAgentName(
      this.connections.grants.map(grant => grant.config.name),
    );
  }

  private async updatePort(
    grant: AgentGrant,
    input: HTMLInputElement,
  ): Promise<void> {
    if (Number(input.value) === grant.config.port) return;
    try {
      await this.connections.updatePort(
        grant.config.agentId,
        Number(input.value),
      );
    } catch (error) {
      input.value = String(grant.config.port);
      throw error;
    }
    if (this.listeners.signal.aborted) return;
    await this.copy(grant.config.agentId, agentPrompt(grant.config, true));
    this.message.textContent =
      'Port saved. Give the updated prompt to your agent to restart its CLI service.';
  }

  private async end(): Promise<void> {
    await this.connections.end();
    this.finishCreateAnimation();
    this.hidePrompt();
    this.message.textContent = 'All agent access revoked.';
  }

  dispose(): void {
    this.stopRendering();
    for (const row of this.rows.values()) row.stopPort();
    this.listeners.abort();
    this.clearPromptMessage();
    this.finishCreateAnimation();
    this.modal.dispose();
    this.navigation.remove();
  }

  private run(operation: () => Promise<void>): void {
    void operation().catch(error => {
      if (!this.listeners.signal.aborted)
        this.message.textContent =
          error instanceof Error ? error.message : 'Agent session failed.';
    });
  }
}

function agentBadge(grant: AgentGrant): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = `agent-badge agent-color-${grant.color}`;
  badge.dataset.active = String(grant.active);
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
