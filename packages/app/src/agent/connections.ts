import {
  AgentEndpoint,
  AgentError,
  LocalHost,
  createAgentConfig,
  parsePort,
  type AgentConfig,
  type HostState,
} from '@code3d/agent';
import {
  action,
  computed,
  makeObservable,
  observable,
  observableRef,
  runInAction,
} from 'mobx';
import type {CodeEditor} from '../editor';
import type {AgentProjectSession} from './project-session';
import {AgentPersistence} from './persistence';
import {randomAgentColor} from './colors';
import type {AgentRenderHistory} from './render-history';

export type AgentGrant = Readonly<{
  config: AgentConfig;
  color: number;
  interacted: boolean;
  lastSeen: string | undefined;
  busy: number;
  state: HostState;
  active: boolean;
}>;

class Connection implements AgentGrant {
  interacted = false;
  busy = 0;
  state: HostState = 'closed';
  host?: LocalHost;

  constructor(
    public config: AgentConfig,
    readonly color: number,
    readonly endpoint: AgentEndpoint,
    public lastSeen: string | undefined = undefined,
  ) {
    makeObservable(this, {
      config: observableRef,
      interacted: observable,
      lastSeen: observable,
      busy: observable,
      state: observable,
      active: computed,
    });
  }

  get active(): boolean {
    return this.state === 'online' && this.interacted;
  }
}

/** Project-owned grants and connection resources, shared by every Agent view. */
export class AgentConnections {
  private readonly connections = observable.map<string, Connection>([], {
    deep: false,
  });
  private followedAgentId: string | undefined = undefined;
  private availableState = false;
  private addingState = false;
  private sessionId?: string;
  private generation = 0;
  private storage?: AgentPersistence;
  private readonly inFlight = new Set<Promise<unknown>>();
  private operations: Promise<unknown> = Promise.resolve();
  readonly ready: Promise<void>;

  constructor(
    private readonly editor: Pick<
      CodeEditor,
      'setAgentCursor' | 'setAgentActivity' | 'removeAgentCursor'
    >,
    private readonly project: AgentProjectSession,
    private readonly renders: AgentRenderHistory,
    workspace: string | undefined,
  ) {
    makeObservable<this, 'followedAgentId' | 'availableState' | 'addingState'>(
      this,
      {
        followedAgentId: observable,
        availableState: observable,
        addingState: observable,
        grants: computed,
        available: computed,
        adding: computed,
        followingAgentId: computed,
        activeAgentIds: computed,
        onlineCount: computed,
        toggleFollow: action,
        dispose: action,
      },
    );
    this.ready = this.restore(workspace).catch(async error => {
      this.renders.clear();
      await this.storage?.close();
      this.storage = undefined;
      throw error;
    });
  }

  get grants(): readonly AgentGrant[] {
    return [...this.connections.values()];
  }

  get available(): boolean {
    return this.availableState;
  }
  get adding(): boolean {
    return this.addingState;
  }
  get followingAgentId(): string | undefined {
    return this.followedAgentId;
  }

  get activeAgentIds(): ReadonlySet<string> {
    return new Set(
      this.grants
        .filter(grant => grant.active)
        .map(grant => grant.config.agentId),
    );
  }

  get onlineCount(): number {
    return this.grants.filter(grant => grant.state === 'online').length;
  }

  toggleFollow(agentId: string): void {
    if (!this.connections.has(agentId)) return;
    this.followedAgentId =
      this.followedAgentId === agentId ? undefined : agentId;
  }

  async add(name: string, port: number): Promise<AgentGrant | undefined> {
    if (this.addingState) return;
    runInAction(() => {
      this.addingState = true;
    });
    try {
      return await this.enqueue(async generation => {
        if (this.connections.size >= 16)
          throw new Error(
            'This page supports up to 16 agent grants. Revoke an unused grant first.',
          );
        port = this.availablePort(port);
        this.sessionId ??= crypto.randomUUID();
        const config = createAgentConfig({
          port,
          origin: location.origin,
          sessionId: this.sessionId,
          name,
        });
        const color = randomAgentColor(this.grants.map(grant => grant.color));
        const endpoint = await this.createEndpoint(config, color);
        if (generation !== this.generation) {
          endpoint.close();
          return;
        }
        const grant = new Connection(config, color, endpoint);
        try {
          await this.persist([...this.grants, grant]);
        } catch (error) {
          endpoint.close();
          if (!this.connections.size) this.sessionId = undefined;
          throw error;
        }
        if (generation !== this.generation) {
          endpoint.close();
          return;
        }
        runInAction(() => {
          this.connections.set(config.agentId, grant);
        });
        this.editor.setAgentCursor(
          config.agentId,
          config.name,
          undefined,
          color,
        );
        this.connect(grant);
        return grant;
      });
    } finally {
      runInAction(() => {
        this.addingState = false;
      });
    }
  }

  revoke(agentId: string): Promise<void> {
    return this.enqueue(async generation => {
      const grant = this.connections.get(agentId);
      if (!grant) return;
      await this.persist(
        this.grants.filter(grant => grant.config.agentId !== agentId),
      );
      if (generation !== this.generation) return;
      runInAction(() => {
        grant.host?.close();
        grant.endpoint.close();
        this.connections.delete(agentId);
        if (this.followedAgentId === agentId) this.followedAgentId = undefined;
        this.renders.remove(agentId);
        this.editor.removeAgentCursor(agentId);
        this.project.forgetAgent(agentId);
      });
    });
  }

  updatePort(agentId: string, value: number): Promise<void> {
    return this.enqueue(async generation => {
      const grant = this.connections.get(agentId);
      if (!grant) return;
      const port = this.availablePort(value, agentId);
      if (port === grant.config.port) return;
      const config = {...grant.config, port};
      await this.persist(
        this.grants.map(current =>
          current === grant
            ? {config, color: grant.color, lastSeen: grant.lastSeen}
            : current,
        ),
      );
      if (generation !== this.generation) return;
      runInAction(() => {
        grant.config = config;
        grant.host?.close();
        this.connect(grant);
      });
    });
  }

  end(): Promise<void> {
    return this.enqueue(async generation => {
      await this.storage!.save();
      if (generation !== this.generation) return;
      runInAction(() => {
        this.generation++;
        this.sessionId = undefined;
        for (const grant of this.connections.values()) {
          grant.host?.close();
          grant.endpoint.close();
          this.editor.removeAgentCursor(grant.config.agentId);
          this.project.forgetAgent(grant.config.agentId);
        }
        this.connections.clear();
        this.followedAgentId = undefined;
        this.renders.clear();
      });
    });
  }

  dispose(): void {
    this.generation++;
    this.availableState = false;
    this.followedAgentId = undefined;
    for (const grant of this.connections.values()) {
      grant.host?.close();
      grant.endpoint.close();
    }
    this.connections.clear();
    this.renders.clear();
    // Storage outlives accepted operations and receipt writes, even after views leave.
    void Promise.allSettled([
      this.ready,
      this.operations,
      ...this.inFlight,
    ]).then(() => this.storage?.close());
  }

  private async restore(workspace: string | undefined): Promise<void> {
    if (!workspace)
      throw new Error('Reconnect the project folder to activate its agents.');
    const generation = this.generation;
    const storage = await AgentPersistence.open(workspace);
    if (generation !== this.generation) {
      await storage.close();
      return;
    }
    this.storage = storage;
    const saved = await storage.load();
    if (generation !== this.generation) return;
    if (saved) {
      // Drain every endpoint creation before releasing resources on a failed restore.
      const results = await Promise.allSettled(
        saved.grants.map(
          async ({config, color, lastSeen}) =>
            new Connection(
              config,
              color,
              await this.createEndpoint(config, color),
              lastSeen,
            ),
        ),
      );
      const restored = results.flatMap(result =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const failure = results.find(result => result.status === 'rejected');
      if (failure || generation !== this.generation) {
        for (const grant of restored) grant.endpoint.close();
        if (failure) throw failure.reason;
        return;
      }
      this.sessionId = saved.sessionId;
      runInAction(() => {
        for (const grant of restored) {
          this.connections.set(grant.config.agentId, grant);
          this.editor.setAgentCursor(
            grant.config.agentId,
            grant.config.name,
            undefined,
            grant.color,
          );
          if (grant.lastSeen)
            this.editor.setAgentActivity(grant.config.agentId, grant.lastSeen);
        }
      });
      for (const grant of restored) this.connect(grant);
    }
    runInAction(() => {
      this.availableState = true;
    });
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
              runInAction(() => {
                for (const receipt of receipts)
                  this.renders.record(agent, receipt);
              });
            return receipts;
          },
          write: async receipt => {
            await journal.write(receipt);
            if (
              generation === this.generation &&
              this.connections.has(config.agentId)
            )
              this.renders.record(agent, receipt);
          },
        },
        onRequest: async () => {
          const grant = this.connections.get(config.agentId);
          if (!grant)
            throw new AgentError(
              'unknown_agent',
              'This agent grant is absent or revoked.',
            );
          const lastSeen = new Date().toISOString();
          runInAction(() => {
            grant.interacted = true;
            grant.lastSeen = lastSeen;
            this.editor.setAgentActivity(config.agentId, lastSeen);
          });
          await this.storage!.recordActivity(config, lastSeen);
        },
      },
    );
  }

  private connect(grant: Connection): void {
    grant.host = new LocalHost({
      config: grant.config,
      stateChanged: action(state => {
        grant.state = state;
      }),
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

  private async handle(agentId: string, envelope: unknown): Promise<unknown> {
    const grant = this.connections.get(agentId);
    if (!grant)
      throw new AgentError(
        'unknown_agent',
        'This agent grant is absent or revoked.',
      );
    runInAction(() => {
      grant.busy++;
    });
    try {
      return await grant.endpoint.handle(envelope);
    } finally {
      runInAction(() => {
        grant.busy--;
      });
    }
  }

  private availablePort(value: number, agentId?: string): number {
    const port = parsePort(value);
    if (
      this.grants.some(
        grant => grant.config.agentId !== agentId && grant.config.port === port,
      )
    )
      throw new Error(
        'Another agent in this project uses that port. Choose a different port.',
      );
    return port;
  }

  private persist(
    grants: readonly Pick<AgentGrant, 'config' | 'color' | 'lastSeen'>[] = this
      .grants,
  ): Promise<void> {
    return this.storage!.save(
      this.sessionId
        ? {
            sessionId: this.sessionId,
            grants: grants.map(({config, color, lastSeen}) => ({
              config,
              color,
              lastSeen,
            })),
          }
        : undefined,
    );
  }

  private enqueue<T>(
    operation: (generation: number) => Promise<T>,
  ): Promise<T | undefined> {
    const generation = this.generation;
    const pending = this.operations.then(async () => {
      await this.ready;
      if (!this.availableState || generation !== this.generation) return;
      return operation(generation);
    });
    this.operations = pending.catch(() => {});
    return pending;
  }
}
