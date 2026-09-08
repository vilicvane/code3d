import {randomUUID} from 'node:crypto';
import {createServer, type ServerResponse} from 'node:http';
import {WebSocket, WebSocketServer} from 'ws';
import {
  AgentCipher,
  AgentError,
  connectionUrl,
  maxBridgeMessageBytes,
  maxEnvelopeBytes,
  parseAppMessage,
  parseEnvelope,
  requestUrl,
  type AgentConfig,
  type BridgeMessage,
  type TransportFailure,
} from '@code3d/agent';

type Pending = {
  requestId: string;
  response: ServerResponse;
  timer: ReturnType<typeof setTimeout>;
  socket: WebSocket;
};

/** The local process owns transport only. The connected App owns authorization and execution. */
export async function createLocalBridge(config: AgentConfig) {
  const cipher = await AgentCipher.create(config);
  const pending = new Map<string, Pending>();
  const sockets = new Set<WebSocket>();
  let app: WebSocket | undefined;
  let closed = false;
  let inFlight = 0;
  let bufferedBytes = 0;
  const maxBufferedBytes = 128 * 1024 * 1024;
  const fail = async (
    response: ServerResponse,
    requestId: string,
    failure: TransportFailure,
  ) => {
    const envelope = await cipher.seal('response', requestId, {
      transportError: failure,
    });
    if (!response.destroyed)
      response
        .writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        })
        .end(JSON.stringify(envelope));
  };
  const unknown = (request: Pending, code: string, message: string) => {
    void fail(request.response, request.requestId, {
      code,
      message,
      delivery: 'unknown',
    }).catch(() => request.response.destroy());
  };
  const server = createServer(
    {requestTimeout: 30_000, headersTimeout: 10_000},
    (request, response) => {
      const reject = (status: number) => {
        response.writeHead(status).end();
        request.resume();
      };
      if (
        request.headers.host !== `127.0.0.1:${config.port}` ||
        request.headers.origin !== undefined
      ) {
        reject(403);
        return;
      }
      if (request.url === '/health' && request.method === 'GET') {
        response
          .writeHead(200, {'content-type': 'application/json'})
          .end(JSON.stringify({connected: app !== undefined}));
        return;
      }
      if (
        request.url !== requestUrl(config).pathname ||
        request.method !== 'POST'
      ) {
        reject(404);
        return;
      }
      if (inFlight >= 32) {
        reject(429);
        return;
      }
      if (Number(request.headers['content-length'] ?? 0) > maxEnvelopeBytes) {
        reject(413);
        return;
      }
      inFlight++;
      response.once('close', () => {
        inFlight--;
      });
      let size = 0;
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request.iterator({destroyOnReturn: false})) {
          const bytes = Buffer.from(chunk as Uint8Array);
          if (size + bytes.length > maxEnvelopeBytes) {
            reject(413);
            return;
          }
          if (bufferedBytes + bytes.length > maxBufferedBytes) {
            reject(429);
            return;
          }
          size += bytes.length;
          bufferedBytes += bytes.length;
          chunks.push(bytes);
        }
        const body = Buffer.concat(chunks).toString('utf8');
        const envelope = parseEnvelope(JSON.parse(body));
        // Local callers must prove possession before consuming App work or receipts.
        await cipher.open('request', envelope);
        if (response.destroyed) return;
        const socket = app;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          await fail(response, envelope.requestId, {
            code: 'app_disconnected',
            message:
              'The local service is running, but the App is not connected. Open the project and allow local-network access. This attempt was not forwarded.',
            delivery: 'not_sent',
          });
          return;
        }
        if (
          pending.size >= 32 ||
          socket.bufferedAmount > maxBridgeMessageBytes
        ) {
          reject(429);
          return;
        }
        const id = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          unknown(
            {response, requestId: envelope.requestId, timer, socket},
            'request_timeout',
            'The App did not return a result before the transport deadline. The outcome is unknown.',
          );
        }, 115_000);
        pending.set(id, {
          response,
          requestId: envelope.requestId,
          timer,
          socket,
        });
        response.once('close', () => {
          clearTimeout(timer);
          pending.delete(id);
        });
        socket.send(
          JSON.stringify({type: 'request', id, body} satisfies BridgeMessage),
        );
      })()
        .catch(() => {
          if (!response.headersSent) response.writeHead(400).end();
        })
        .finally(() => {
          bufferedBytes -= size;
        });
    },
  );
  server.maxConnections = 64;
  const websocket = new WebSocketServer({
    noServer: true,
    maxPayload: maxBridgeMessageBytes,
    perMessageDeflate: false,
  });
  server.on('upgrade', (request, socket, head) => {
    if (
      closed ||
      request.headers.host !== `127.0.0.1:${config.port}` ||
      request.headers.origin !== config.origin ||
      request.url !== connectionUrl(config).pathname
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    if (sockets.size >= 8) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      return;
    }
    websocket.handleUpgrade(request, socket, head, connection =>
      websocket.emit('connection', connection),
    );
  });
  websocket.on('connection', socket => {
    sockets.add(socket);
    const bridgeChallenge = randomUUID();
    let appChallenge: string | undefined;
    const challengeId = randomUUID();
    let authenticated = false;
    let authenticating = false;
    let alive = true;
    const deadline = setTimeout(() => socket.terminate(), 10_000);
    socket.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 15_000);
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      sockets.delete(socket);
      if (app === socket) app = undefined;
      for (const [id, request] of pending) {
        if (request.socket !== socket) continue;
        clearTimeout(request.timer);
        pending.delete(id);
        unknown(
          request,
          'app_disconnected',
          'The App disconnected after forwarding this request. Its outcome is unknown.',
        );
      }
    });
    socket.on('message', (data, binary) => {
      void (async () => {
        if (binary) throw new Error('Text frames required.');
        const message = parseAppMessage(JSON.parse(data.toString()));
        if (message.type === 'hello') {
          if (appChallenge !== undefined) throw new Error('Repeated hello.');
          appChallenge = message.challenge;
          const envelope = await cipher.seal('bridge-proof', challengeId, {
            appChallenge,
            bridgeChallenge,
          });
          if (socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({
                type: 'challenge',
                envelope,
              } satisfies BridgeMessage),
            );
          return;
        }
        if (message.type === 'authenticate') {
          if (!appChallenge || authenticated || authenticating)
            throw new Error('Repeated authentication.');
          authenticating = true;
          const proof = await cipher.open('app-proof', message.envelope);
          if (
            proof.requestId !== challengeId ||
            JSON.stringify(proof.value) !==
              JSON.stringify({appChallenge, bridgeChallenge})
          )
            throw new Error('Incorrect challenge.');
          if (socket.readyState !== WebSocket.OPEN || closed) return;
          if (app) {
            socket.close(1008, 'App is already connected.');
            return;
          }
          authenticated = true;
          clearTimeout(deadline);
          app = socket;
          socket.send(JSON.stringify({type: 'ready'} satisfies BridgeMessage));
          return;
        }
        if (!authenticated || app !== socket)
          throw new Error('Authentication required.');
        const request = pending.get(message.id);
        if (!request || request.socket !== socket) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.body === undefined) request.response.writeHead(403).end();
        else {
          const bytes = Buffer.byteLength(message.body);
          if (bufferedBytes + bytes > maxBufferedBytes) {
            request.response.writeHead(429).end();
            return;
          }
          bufferedBytes += bytes;
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            bufferedBytes -= bytes;
          };
          request.response.once('finish', release);
          request.response.once('close', release);
          request.response
            .writeHead(200, {
              'content-type': 'application/json',
              'cache-control': 'no-store',
            })
            .end(message.body);
        }
      })().catch(() =>
        socket.close(1008, 'Authentication or message rejected.'),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    const fail = (error: NodeJS.ErrnoException) =>
      reject(
        new AgentError(
          error.code === 'EADDRINUSE' ? 'port_in_use' : 'listen_failed',
          error.code === 'EADDRINUSE'
            ? `Port ${config.port} is already in use. Stop the existing c3d server, or change the port in Code3D and copy its updated configuration. The port was not changed automatically.`
            : `Could not listen on 127.0.0.1:${config.port}.`,
        ),
      );
    server.once('error', fail);
    server.listen(config.port, '127.0.0.1', () => {
      server.off('error', fail);
      resolve();
    });
  });
  return {
    server,
    get connected() {
      return app !== undefined;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.terminate();
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.response.destroy();
      }
      pending.clear();
      websocket.close();
      const done = new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await done;
    },
  };
}
