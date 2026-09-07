import {normalizeRelayUrl} from './config.js';
import {
  maxRelayMessageBytes,
  parseRelayMessage,
  type HostMessage,
} from './relay-protocol.js';
import {AgentError} from './validation.js';

export type HostState = 'connecting' | 'online' | 'offline' | 'closed';
export type RelayHostOptions = Readonly<{
  relay: string;
  token: string;
  sessionId: string;
  handle(agentId: string, envelope: unknown): Promise<unknown>;
  stateChanged?(state: HostState): void;
}>;

/** Reconnecting transport only. The App keeps grants and receipts across socket replacements. */
export class RelayHost {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private retry = 0;
  private state: HostState = 'connecting';
  private readonly url: string;

  constructor(private readonly options: RelayHostOptions) {
    this.url =
      normalizeRelayUrl(options.relay).replace(/^http/, 'ws') +
      '/sessions/' +
      options.sessionId +
      '/host';
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

  private connect(): void {
    if (this.closed) return;
    this.setState('connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;
    const deadline = setTimeout(() => socket.close(), 10_000);
    socket.onopen = () => {
      if (this.socket === socket)
        socket.send(
          JSON.stringify({
            type: 'host',
            token: this.options.token,
          } satisfies HostMessage),
        );
      else socket.close();
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      clearTimeout(deadline);
      if (this.socket !== socket || this.closed) return;
      this.socket = undefined;
      this.setState('offline');
      this.timer = setTimeout(
        () => this.connect(),
        Math.min(10_000, 500 * 2 ** this.retry++) * (0.8 + Math.random() * 0.4),
      );
    };
    socket.onmessage = event => {
      void (async () => {
        if (this.socket !== socket || this.closed) return;
        if (
          typeof event.data !== 'string' ||
          event.data.length > maxRelayMessageBytes
        )
          throw new Error('Invalid relay frame.');
        const message = parseRelayMessage(JSON.parse(event.data));
        if (message.type === 'ready') {
          if (message.sessionId !== this.options.sessionId)
            throw new Error('Relay returned a different session.');
          clearTimeout(deadline);
          this.retry = 0;
          this.setState('online');
          return;
        }
        if (this.state !== 'online') throw new Error('Relay is not ready.');
        let response: HostMessage;
        try {
          const envelope = await this.options.handle(
            message.agentId,
            JSON.parse(message.body),
          );
          response = {
            type: 'response',
            id: message.id,
            status: 200,
            body: JSON.stringify(envelope),
          };
        } catch (error) {
          response = {
            type: 'response',
            id: message.id,
            status:
              error instanceof AgentError && error.code === 'unknown_agent'
                ? 403
                : 400,
          };
        }
        if (this.socket === socket && socket.readyState === WebSocket.OPEN) {
          if (socket.bufferedAmount > maxRelayMessageBytes) {
            socket.close();
            return;
          }
          socket.send(JSON.stringify(response));
        }
      })().catch(() => socket.close(1008));
    };
  }
}
