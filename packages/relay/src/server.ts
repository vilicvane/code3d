import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {WebSocket, WebSocketServer} from 'ws';
import {
  maxEnvelopeBytes,
  maxRelayMessageBytes,
  parseHostMessage,
  sessionIdForToken,
  type RelayMessage,
} from '@code3d/agent';

type Pending = {finish(status: number, body?: string): void};
type Host = {socket: WebSocket; requests: Map<string, Pending>};
export type RelayOptions = {
  requestTimeoutMs?: number;
  heartbeatMs?: number;
  maxConnections?: number;
  maxPending?: number;
  maxBufferedBytes?: number;
};

/** Only live sockets and unfinished HTTP exchanges exist here. No session registration or storage. */
export function createRelay(options: RelayOptions = {}) {
  const hosts = new Map<string, Host>();
  const maxPending = options.maxPending ?? 32;
  const maxBufferedBytes = options.maxBufferedBytes ?? 64 * 1024 * 1024;
  let pendingCount = 0;
  let bufferedBytes = 0;
  let closing = false;
  const server = createServer(
    {requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 8192},
    (request, response) => {
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      if (request.method === 'GET' && request.url === '/health') {
        response.writeHead(200).end('ok');
        return;
      }
      const route = request.url?.match(
        /^\/sessions\/([A-Za-z0-9_-]{43})\/agents\/([A-Za-z0-9_-]{1,128})\/requests$/,
      );
      if (request.method !== 'POST' || !route) {
        response.writeHead(404).end();
        return;
      }
      const host = hosts.get(route[1]);
      if (!host || host.socket.readyState !== WebSocket.OPEN) {
        response.writeHead(503).end();
        return;
      }
      if (
        closing ||
        pendingCount >= maxPending ||
        host.requests.size >= 8 ||
        host.socket.bufferedAmount > maxEnvelopeBytes
      ) {
        response.writeHead(429).end();
        return;
      }
      const contentLength = Number(request.headers['content-length'] ?? 0);
      if (contentLength > maxEnvelopeBytes) {
        response.writeHead(413).end();
        return;
      }
      const id = randomUUID();
      let finished = false;
      let size = 0;
      let reserved = 0;
      const chunks: Buffer[] = [];
      const release = () => {
        bufferedBytes -= reserved;
        reserved = 0;
        chunks.length = 0;
      };
      const timer = setTimeout(
        () => finish(504),
        options.requestTimeoutMs ?? 115_000,
      );
      const finish = (status: number, body?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        host.requests.delete(id);
        pendingCount--;
        release();
        if (!response.destroyed) {
          if (body) response.setHeader('content-type', 'application/json');
          response.writeHead(status).end(body);
        }
      };
      pendingCount++;
      host.requests.set(id, {finish});
      response.on('close', () => finish(499));
      request.on('error', () => finish(400));
      request.on('data', (chunk: Buffer) => {
        if (finished) return;
        size += chunk.byteLength;
        if (size > maxEnvelopeBytes) {
          finish(413);
          return;
        }
        if (bufferedBytes + chunk.byteLength > maxBufferedBytes) {
          finish(429);
          return;
        }
        bufferedBytes += chunk.byteLength;
        reserved += chunk.byteLength;
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (finished) return;
        if (
          host.socket.readyState !== WebSocket.OPEN ||
          hosts.get(route[1]) !== host
        ) {
          finish(503);
          return;
        }
        const body = Buffer.concat(chunks).toString('utf8');
        const message: RelayMessage = {
          type: 'request',
          id,
          agentId: route[2],
          body,
        };
        host.socket.send(JSON.stringify(message), error => {
          release();
          if (error) finish(502);
        });
        // Once forwarded, the App owns execution. Disconnecting the caller never cancels a mutation.
      });
    },
  );
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: maxRelayMessageBytes,
    perMessageDeflate: false,
  });
  const alive = new Set<WebSocket>();
  server.on('upgrade', (request, socket, head) => {
    const route = request.url?.match(/^\/sessions\/([A-Za-z0-9_-]{43})\/host$/);
    if (
      closing ||
      !route ||
      sockets.clients.size >= (options.maxConnections ?? 256)
    ) {
      socket.end(
        'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n',
      );
      return;
    }
    sockets.handleUpgrade(request, socket, head, ws =>
      sockets.emit('connection', ws, request),
    );
  });
  sockets.on('connection', (socket, request) => {
    const expectedSessionId = request.url!.split('/')[2];
    let host: Host | undefined;
    let sessionId: string | undefined;
    let authenticating = false;
    const deadline = setTimeout(() => socket.terminate(), 5000);
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      clearTimeout(deadline);
      alive.delete(socket);
      if (sessionId && hosts.get(sessionId) === host) hosts.delete(sessionId);
      for (const pending of host?.requests.values() ?? []) pending.finish(503);
    });
    socket.on('message', (data, binary) => {
      void (async () => {
        if (binary || authenticating) {
          socket.close(1008);
          return;
        }
        const message = parseHostMessage(JSON.parse(data.toString()));
        if (!host) {
          if (message.type !== 'host') {
            socket.close(1008);
            return;
          }
          authenticating = true;
          const routeId = await sessionIdForToken(message.token);
          if (socket.readyState !== WebSocket.OPEN) return;
          if (routeId !== expectedSessionId) {
            socket.close(1008);
            return;
          }
          sessionId = routeId;
          const previous = hosts.get(routeId);
          if (previous) {
            for (const pending of previous.requests.values())
              pending.finish(503);
            previous.socket.close(1000, 'Host reconnected');
          }
          host = {socket, requests: new Map()};
          hosts.set(routeId, host);
          clearTimeout(deadline);
          authenticating = false;
          socket.send(
            JSON.stringify({
              type: 'ready',
              sessionId: routeId,
            } satisfies RelayMessage),
          );
          return;
        }
        if (message.type !== 'response') {
          socket.close(1008);
          return;
        }
        // An unguessable ID belongs to this particular host connection, never another App.
        host.requests.get(message.id)?.finish(message.status, message.body);
      })().catch(() => socket.close(1008));
    });
  });
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.delete(socket)) socket.terminate();
      else socket.ping();
    }
  }, options.heartbeatMs ?? 20_000);
  heartbeat.unref();
  return {
    server,
    async close(): Promise<void> {
      closing = true;
      clearInterval(heartbeat);
      for (const host of hosts.values())
        for (const pending of host.requests.values()) pending.finish(503);
      for (const socket of sockets.clients) socket.terminate();
      hosts.clear();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
