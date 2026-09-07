import {connectionUrl, type AgentConfig} from './config.js';
import {AgentCipher} from './crypto.js';
import {
  maxBridgeMessageBytes,
  parseBridgeMessage,
  type AppMessage,
} from './bridge-protocol.js';

export type HostState = 'connecting' | 'online' | 'offline' | 'closed';
export type LocalHostOptions = Readonly<{
  config: AgentConfig;
  handle(envelope: unknown): Promise<unknown>;
  stateChanged?(state: HostState): void;
}>;

/** One reconnecting socket per grant. The App owns all file operations and receipts. */
export class LocalHost {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private retry = 0;
  private state: HostState = 'connecting';
  private readonly cipher: Promise<AgentCipher>;

  constructor(private readonly options: LocalHostOptions) {
    this.cipher = AgentCipher.create(options.config);
    this.connect();
  }

  get status(): HostState {
    return this.state;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.socket?.close();
    this.socket = undefined;
    this.setState('closed');
  }

  private setState(state: HostState): void {
    this.state = state;
    this.options.stateChanged?.(state);
  }

  private schedule(): void {
    if (this.closed) return;
    this.setState('offline');
    this.timer = setTimeout(
      () => this.connect(),
      Math.min(10_000, 500 * 2 ** Math.min(this.retry++, 5)) *
        (0.8 + Math.random() * 0.4),
    );
  }

  private connect(): void {
    if (this.closed) return;
    this.setState('connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(connectionUrl(this.options.config));
    } catch {
      this.schedule();
      return;
    }
    this.socket = socket;
    const deadline = setTimeout(() => socket.close(), 10_000);
    const appChallenge = crypto.randomUUID();
    socket.onopen = () => {
      if (this.socket === socket && !this.closed)
        socket.send(
          JSON.stringify({
            type: 'hello',
            challenge: appChallenge,
          } satisfies AppMessage),
        );
      else socket.close();
    };
    let authenticated = false;
    let challengeReceived = false;
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      clearTimeout(deadline);
      if (this.socket !== socket || this.closed) return;
      this.socket = undefined;
      this.schedule();
    };
    socket.onmessage = event => {
      void (async () => {
        if (this.socket !== socket || this.closed) return;
        if (
          typeof event.data !== 'string' ||
          event.data.length > maxBridgeMessageBytes
        )
          throw new Error('Invalid bridge frame.');
        const message = parseBridgeMessage(JSON.parse(event.data));
        if (message.type === 'challenge') {
          if (challengeReceived || authenticated)
            throw new Error('Repeated challenge.');
          challengeReceived = true;
          const cipher = await this.cipher;
          const proof = await cipher.open('bridge-proof', message.envelope);
          const value = proof.value as {
            appChallenge?: unknown;
            bridgeChallenge?: unknown;
          };
          if (
            value?.appChallenge !== appChallenge ||
            typeof value.bridgeChallenge !== 'string'
          )
            throw new Error('Bridge proof belongs to another connection.');
          const response: AppMessage = {
            type: 'authenticate',
            envelope: await cipher.seal(
              'app-proof',
              proof.requestId,
              proof.value,
            ),
          };
          if (
            this.socket !== socket ||
            this.closed ||
            socket.readyState !== WebSocket.OPEN
          )
            return;
          // Only the configured local service can produce this direction's proof.
          authenticated = true;
          socket.send(JSON.stringify(response));
          return;
        }
        if (!authenticated) throw new Error('Bridge is not authenticated.');
        if (message.type === 'ready') {
          if (this.state === 'online') throw new Error('Repeated ready frame.');
          clearTimeout(deadline);
          this.retry = 0;
          this.setState('online');
          return;
        }
        if (this.state !== 'online') throw new Error('Bridge is not ready.');
        let response: AppMessage;
        try {
          response = {
            type: 'response',
            id: message.id,
            body: JSON.stringify(
              await this.options.handle(JSON.parse(message.body)),
            ),
          };
        } catch {
          response = {type: 'response', id: message.id};
        }
        if (this.socket === socket && socket.readyState === WebSocket.OPEN) {
          if (socket.bufferedAmount > maxBridgeMessageBytes) {
            socket.close();
            return;
          }
          socket.send(JSON.stringify(response));
        }
      })().catch(() => socket.close(1008));
    };
  }
}
