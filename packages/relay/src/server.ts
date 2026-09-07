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
import {clientAddress} from './client-address.js';
import {TrafficLimiter, type TrafficOptions} from './traffic.js';

type Pending = {
  finish(status: number, body?: string, retryAfter?: number): void;
};
type Host = {socket: WebSocket; requests: Map<string, Pending>};
export type RelayOptions = {
  requestTimeoutMs?: number;
  heartbeatMs?: number;
  maxConnections?: number;
  maxPending?: number;
  maxBufferedBytes?: number;
  traffic?: TrafficOptions;
  trustProxy?: boolean;
};

/** Live routing plus bounded in-memory traffic counters; no business state or storage. */
export function createRelay(options: RelayOptions = {}) {
  const traffic = new TrafficLimiter(options.traffic);
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
      const reject = (status: number, retryAfter?: number) => {
        response.setHeader('connection', 'close');
        if (retryAfter) response.setHeader('retry-after', retryAfter);
        response.writeHead(status).end();
      };
      if (request.method === 'GET' && request.url === '/health') {
        response.writeHead(200).end('ok');
        return;
      }
      let ip: string;
      try {
        ip = clientAddress(request, options.trustProxy ?? false);
      } catch {
        reject(400);
        return;
      }
      const route = request.url?.match(
        /^\/sessions\/([A-Za-z0-9_-]{43})\/agents\/([A-Za-z0-9_-]{1,128})\/requests$/,
      );
      const host = route ? hosts.get(route[1]) : undefined;
      const admissionWait = traffic.take(
        ip,
        host ? route![1] : undefined,
        0,
        1,
      );
      if (admissionWait) {
        reject(429, admissionWait);
        return;
      }
      if (request.method !== 'POST' || !route) {
        response.writeHead(404).end();
        return;
      }
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
        reject(429, 1);
        return;
      }
      const contentLength = Number(request.headers['content-length'] ?? 0);
      if (contentLength > maxEnvelopeBytes) {
        reject(413);
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
      const finish = (status: number, body?: string, retryAfter?: number) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        host.requests.delete(id);
        pendingCount--;
        release();
        if (!response.destroyed) {
          if (retryAfter) response.setHeader('retry-after', retryAfter);
          if (status !== 200) response.setHeader('connection', 'close');
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
        const retryAfter = traffic.take(ip, route[1], chunk.byteLength);
        if (retryAfter) {
          finish(429, undefined, retryAfter);
          return;
        }
        size += chunk.byteLength;
        if (size > maxEnvelopeBytes) {
          finish(413);
          return;
        }
        if (bufferedBytes + chunk.byteLength > maxBufferedBytes) {
          finish(429, undefined, 1);
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
        const wire = JSON.stringify(message);
        const wireBytes = Buffer.byteLength(wire);
        if (wireBytes > maxRelayMessageBytes) {
          finish(413);
          return;
        }
        // Opaque uploads can expand through JSON escaping or UTF-8 replacement.
        // Charge that expansion so forwarded payload cannot amplify unmetered traffic.
        const extraBytes = Math.max(0, wireBytes - size);
        const retryAfter = traffic.take(ip, route[1], extraBytes);
        if (retryAfter) {
          finish(429, undefined, retryAfter);
          return;
        }
        if (bufferedBytes + extraBytes > maxBufferedBytes) {
          finish(429, undefined, 1);
          return;
        }
        bufferedBytes += extraBytes;
        reserved += extraBytes;
        host.socket.send(wire, error => {
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
    let ip: string;
    try {
      ip = clientAddress(request, options.trustProxy ?? false);
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const retryAfter = traffic.take(ip, undefined, 0, 1);
    if (retryAfter) {
      socket.end(
        `HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${retryAfter}\r\nConnection: close\r\n\r\n`,
      );
      return;
    }
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
    const ip = clientAddress(request, options.trustProxy ?? false);
    const expectedSessionId = request.url!.split('/')[2];
    let host: Host | undefined;
    let sessionId: string | undefined;
    let authenticating = false;
    const deadline = setTimeout(() => socket.terminate(), 5000);
    alive.add(socket);
    const admit = (bytes: number): boolean => {
      if (socket.readyState !== WebSocket.OPEN) return false;
      const retryAfter = traffic.take(ip, sessionId, bytes, 1);
      if (!retryAfter) return true;
      for (const pending of host?.requests.values() ?? [])
        pending.finish(429, undefined, retryAfter);
      socket.close(1008, 'Traffic limit exceeded');
      return false;
    };
    socket.on('ping', data => admit(data.byteLength));
    socket.on('pong', data => {
      if (admit(data.byteLength)) alive.add(socket);
    });
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      clearTimeout(deadline);
      alive.delete(socket);
      if (sessionId && hosts.get(sessionId) === host) hosts.delete(sessionId);
      for (const pending of host?.requests.values() ?? []) pending.finish(503);
    });
    socket.on('message', (data, binary) => {
      const size = Array.isArray(data)
        ? data.reduce((sum, chunk) => sum + chunk.byteLength, 0)
        : data.byteLength;
      if (!admit(size)) return;
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
    traffic.sweep();
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
