import {
  AgentError,
  encodeBase64,
  identifier,
  object,
  secret,
  string,
} from './validation.js';

export type AgentConfig = Readonly<{
  version: 1;
  relay: string;
  sessionId: string;
  agentId: string;
  name: string;
  accessToken: string;
  key: string;
}>;

export function parseAgentConfig(value: unknown): AgentConfig {
  const config = object(
    value,
    ['version', 'relay', 'sessionId', 'agentId', 'name', 'accessToken', 'key'],
    'Agent configuration',
  );
  if (config.version !== 1)
    throw new AgentError(
      'invalid_config',
      'Unsupported agent configuration version.',
    );
  let relay: URL;
  try {
    relay = new URL(string(config.relay, 'Relay URL'));
  } catch {
    throw new AgentError(
      'invalid_config',
      'Relay URL must be an absolute URL.',
    );
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(relay.hostname);
  if (
    (relay.protocol !== 'https:' && !(relay.protocol === 'http:' && local)) ||
    relay.username ||
    relay.password ||
    relay.search ||
    relay.hash
  )
    throw new AgentError(
      'invalid_config',
      'Relay URL must use HTTPS (HTTP is allowed on loopback), without credentials, query or fragment.',
    );
  return {
    version: 1,
    relay: relay.href.replace(/\/$/, ''),
    sessionId: identifier(config.sessionId, 'Session ID'),
    agentId: identifier(config.agentId, 'Agent ID'),
    name: string(config.name, 'Agent name'),
    accessToken: secret(config.accessToken, 'Relay access token'),
    key: secret(config.key, 'Content key'),
  };
}

/** Called by the App when issuing an agent's configuration, never by the relay. */
export function createAgentConfig(
  options: Pick<AgentConfig, 'relay' | 'sessionId' | 'name'>,
): AgentConfig {
  return parseAgentConfig({
    version: 1,
    ...options,
    agentId: crypto.randomUUID(),
    accessToken: encodeBase64(crypto.getRandomValues(new Uint8Array(32))),
    key: encodeBase64(crypto.getRandomValues(new Uint8Array(32))),
  });
}

export function requestUrl(config: AgentConfig): URL {
  return new URL(
    config.relay +
      '/sessions/' +
      config.sessionId +
      '/agents/' +
      config.agentId +
      '/requests',
  );
}
