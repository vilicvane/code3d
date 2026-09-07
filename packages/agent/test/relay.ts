import {createServer} from 'node:http';
import {once} from 'node:events';
import type {TestContext} from 'node:test';
import {
  AgentEndpoint,
  createAgentConfig,
  type AgentConfig,
  type Envelope,
  type RequestHandler,
} from '../bld/index.js';

/** A loopback transport fixture; the production relay must never receive a content key. */
export async function relay(t: TestContext, handler: RequestHandler) {
  const received: {
    url: string | undefined;
    authorization: string | undefined;
    body: string;
  }[] = [];
  const grants = new Map<
    string,
    {config: AgentConfig; endpoint: AgentEndpoint}
  >();
  let transform:
    ((envelope: Envelope) => Envelope | Promise<Envelope>) | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of request)
        chunks.push(Buffer.from(chunk as Uint8Array));
      const body = Buffer.concat(chunks).toString();
      received.push({
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      const grant = [...grants.values()].find(
        ({config}) =>
          request.url ===
          `/sessions/${config.sessionId}/agents/${config.agentId}/requests`,
      );
      if (!grant) {
        response.writeHead(403).end();
        return;
      }
      let envelope = await grant.endpoint.handle(JSON.parse(body));
      if (transform) envelope = await transform(envelope);
      response
        .writeHead(200, {'content-type': 'application/json'})
        .end(JSON.stringify(envelope));
    })().catch(() => {
      response.writeHead(400).end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const grant of grants.values()) grant.endpoint.close();
    const closed = new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
    server.closeAllConnections();
    await closed;
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing loopback address.');
  return {
    received,
    transform(fn: typeof transform) {
      transform = fn;
    },
    async grant(name = 'Agent'): Promise<AgentConfig> {
      const config = createAgentConfig({
        relay: `http://127.0.0.1:${address.port}`,
        sessionId: 'project-session',
        name,
      });
      grants.set(config.agentId, {
        config,
        endpoint: await AgentEndpoint.create(config, handler),
      });
      return config;
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return {promise, resolve};
}
