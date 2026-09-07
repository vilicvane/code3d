import {
  randomAgentPort,
  type AgentConfig,
  type ReceiptJournal,
  type StoredReceipt,
} from '@code3d/agent';
import {randomAgentColor} from './colors';

export type PersistedAgentSession = {
  sessionId: string;
  grants: {config: AgentConfig; color: number; lastSeen?: string}[];
};

/** One project owner per browser origin. Local servers never store this data. */
export class AgentPersistence {
  private constructor(
    private readonly database: IDBDatabase,
    private readonly workspace: string,
    private readonly release: () => Promise<void>,
  ) {}

  static open(workspace: string): Promise<AgentPersistence> {
    return new Promise((resolve, reject) => {
      const holding = navigator.locks.request(
        `code3d:agents:${workspace}`,
        {ifAvailable: true},
        async lock => {
          if (!lock)
            throw new Error(
              'Agents are active in another tab for this project. Close that tab and reload this page to take over.',
            );
          const request = indexedDB.open('code3d-agents-v1', 3);
          request.onupgradeneeded = event => {
            if (event.oldVersion === 0) {
              request.result.createObjectStore('sessions');
              request.result.createObjectStore('receipts');
            } else {
              // Assign existing grants once while retaining their credentials and receipts.
              const cursor = request
                .transaction!.objectStore('sessions')
                .openCursor();
              cursor.onsuccess = () => {
                const entry = cursor.result;
                if (!entry) return;
                const legacy = entry.value as {
                  identity: {sessionId: string};
                  grants: {
                    config: Omit<AgentConfig, 'version' | 'port' | 'origin'> & {
                      version: 1;
                      relay: string;
                    };
                    color: number;
                    lastSeen?: string;
                  }[];
                };
                const ports: number[] = [];
                const session: PersistedAgentSession = {
                  sessionId: legacy.identity.sessionId,
                  grants: legacy.grants.map(grant => {
                    const port = randomAgentPort(ports);
                    ports.push(port);
                    const {
                      relay: _relay,
                      version: _version,
                      ...identity
                    } = grant.config;
                    return {
                      ...grant,
                      color:
                        event.oldVersion < 2 ? randomAgentColor() : grant.color,
                      config: {
                        ...identity,
                        version: 2,
                        port,
                        origin: location.origin,
                      },
                    };
                  }),
                };
                entry.update(session);
                entry.continue();
              };
            }
          };
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            let blocked = false;
            request.onblocked = () => {
              blocked = true;
              reject(
                new Error(
                  'Close other Code3D tabs and reload this page to upgrade agent storage.',
                ),
              );
            };
            request.onsuccess = () => {
              if (blocked) request.result.close();
              else resolve(request.result);
            };
            request.onerror = () => reject(request.error);
          });
          database.onversionchange = () => database.close();
          let release!: () => void;
          const held = new Promise<void>(done => {
            release = done;
          });
          resolve(
            new AgentPersistence(database, workspace, () => {
              release();
              return holding;
            }),
          );
          await held;
          database.close();
        },
      );
      void holding.catch(reject);
    });
  }

  close(): Promise<void> {
    return this.release();
  }

  async load(): Promise<PersistedAgentSession | undefined> {
    return requestResult(
      this.database
        .transaction('sessions')
        .objectStore('sessions')
        .get(this.workspace),
    );
  }

  async save(session?: PersistedAgentSession): Promise<void> {
    const transaction = this.database.transaction(
      ['sessions', 'receipts'],
      'readwrite',
    );
    const complete = transactionComplete(transaction);
    const sessions = transaction.objectStore('sessions');
    const request = sessions.get(this.workspace);
    request.onsuccess = () => {
      const previous = request.result as PersistedAgentSession | undefined;
      for (const grant of previous?.grants ?? []) {
        if (
          !session?.grants.some(
            next => next.config.agentId === grant.config.agentId,
          )
        )
          transaction
            .objectStore('receipts')
            .delete(this.receiptRange(grant.config.agentId));
      }
      if (session) sessions.put(session, this.workspace);
      else sessions.delete(this.workspace);
    };
    await complete;
  }

  async recordActivity(config: AgentConfig, lastSeen: string): Promise<void> {
    const transaction = this.database.transaction('sessions', 'readwrite');
    const complete = transactionComplete(transaction);
    const sessions = transaction.objectStore('sessions');
    const request = sessions.get(this.workspace);
    request.onsuccess = () => {
      const session = request.result as PersistedAgentSession | undefined;
      const grant = session?.grants.find(
        grant =>
          grant.config.agentId === config.agentId &&
          grant.config.sessionId === config.sessionId,
      );
      if (!grant) {
        transaction.abort();
        return;
      }
      grant.lastSeen = lastSeen;
      sessions.put(session, this.workspace);
    };
    await complete;
  }

  journal(config: AgentConfig): ReceiptJournal {
    return {
      load: () =>
        requestResult<StoredReceipt[]>(
          this.database
            .transaction('receipts')
            .objectStore('receipts')
            .getAll(this.receiptRange(config.agentId)),
        ),
      write: async receipt => {
        const transaction = this.database.transaction(
          ['sessions', 'receipts'],
          'readwrite',
        );
        const complete = transactionComplete(transaction);
        const request = transaction.objectStore('sessions').get(this.workspace);
        request.onsuccess = () => {
          const session = request.result as PersistedAgentSession | undefined;
          if (
            !session?.grants.some(
              grant =>
                grant.config.agentId === config.agentId &&
                grant.config.sessionId === config.sessionId,
            )
          ) {
            transaction.abort();
            return;
          }
          transaction
            .objectStore('receipts')
            .put(receipt, [this.workspace, config.agentId, receipt.requestId]);
        };
        await complete;
      },
    };
  }

  private receiptRange(agentId: string): IDBKeyRange {
    return IDBKeyRange.bound(
      [this.workspace, agentId, ''],
      [this.workspace, agentId, '\uffff'],
    );
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error('Agent authorization was removed.'),
      );
    transaction.onerror = () => reject(transaction.error);
  });
}
