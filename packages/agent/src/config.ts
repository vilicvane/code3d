import {
  AgentError,
  decodeBase64,
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
  key: string;
}>;

export function parseAgentConfig(value: unknown): AgentConfig {
  const config = object(
    value,
    ['version', 'relay', 'sessionId', 'agentId', 'name', 'key'],
    'Agent configuration',
  );
  if (config.version !== 1)
    throw new AgentError(
      'invalid_config',
      'Unsupported agent configuration version.',
    );
  return {
    version: 1,
    relay: normalizeRelayUrl(config.relay),
    sessionId: identifier(config.sessionId, 'Session ID'),
    agentId: identifier(config.agentId, 'Agent ID'),
    name: string(config.name, 'Agent name'),
    key: secret(config.key, 'Content key'),
  };
}

export function normalizeRelayUrl(value: unknown): string {
  let relay: URL;
  try {
    relay = new URL(string(value, 'Relay URL'));
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
  return relay.href.replace(/\/$/, '');
}

/** Called by the App when issuing an agent's configuration, never by the relay. */
export function createAgentConfig(
  options: Pick<AgentConfig, 'relay' | 'sessionId' | 'name'>,
): AgentConfig {
  return parseAgentConfig({
    version: 1,
    ...options,
    agentId: crypto.randomUUID(),
    key: encodeBase64(crypto.getRandomValues(new Uint8Array(32))),
  });
}

/** The host token stays in the App. Its one-way route ID is safe to hand to agents. */
export async function sessionIdForToken(token: string): Promise<string> {
  secret(token, 'Host token');
  return encodeBase64(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', decodeBase64(token, 'Host token')),
    ),
  );
}

export async function createHostIdentity(): Promise<{
  token: string;
  sessionId: string;
}> {
  const token = encodeBase64(crypto.getRandomValues(new Uint8Array(32)));
  return {token, sessionId: await sessionIdForToken(token)};
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
