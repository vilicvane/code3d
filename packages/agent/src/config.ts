import {
  AgentError,
  encodeBase64,
  identifier,
  object,
  secret,
  string,
} from './validation.js';

export type AgentConfig = Readonly<{
  port: number;
  origin: string;
  sessionId: string;
  agentId: string;
  name: string;
  key: string;
}>;

export function parsePort(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1024 ||
    value > 65535
  )
    throw new AgentError(
      'invalid_config',
      'Local port must be an integer between 1024 and 65535.',
    );
  return value;
}

export function randomAgentPort(excluded: readonly number[] = []): number {
  for (;;) {
    const port =
      49152 + (crypto.getRandomValues(new Uint16Array(1))[0]! % 16384);
    if (!excluded.includes(port)) return port;
  }
}

export function parseAgentConfig(value: unknown): AgentConfig {
  const config = object(
    value,
    ['port', 'origin', 'sessionId', 'agentId', 'name', 'key'],
    'Agent configuration',
  );
  let origin: URL;
  try {
    origin = new URL(string(config.origin, 'App origin'));
  } catch {
    throw new AgentError(
      'invalid_config',
      'App origin must be an HTTP or HTTPS origin.',
    );
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local)) ||
    origin.origin !== config.origin
  )
    throw new AgentError(
      'invalid_config',
      'App origin must be an HTTPS origin (HTTP is allowed on loopback), without a path or credentials.',
    );
  return {
    port: parsePort(config.port),
    origin: origin.origin,
    sessionId: identifier(config.sessionId, 'Session ID'),
    agentId: identifier(config.agentId, 'Agent ID'),
    name: string(config.name, 'Agent name'),
    key: secret(config.key, 'Content key'),
  };
}

/** The App creates an independent identity and secret for each local agent. */
export function createAgentConfig(
  options: Pick<AgentConfig, 'port' | 'origin' | 'sessionId' | 'name'>,
): AgentConfig {
  return parseAgentConfig({
    ...options,
    agentId: crypto.randomUUID(),
    key: encodeBase64(crypto.getRandomValues(new Uint8Array(32))),
  });
}

export function requestUrl(config: AgentConfig): URL {
  return new URL(
    `http://127.0.0.1:${config.port}/sessions/${config.sessionId}/agents/${config.agentId}/requests`,
  );
}

export function connectionUrl(config: AgentConfig): URL {
  return new URL(
    `ws://127.0.0.1:${config.port}/sessions/${config.sessionId}/agents/${config.agentId}/app`,
  );
}
