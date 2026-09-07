import {maxEnvelopeBytes} from './crypto.js';
import {AgentError, identifier, object, secret, string} from './validation.js';

// These are transport messages. A relay never opens or interprets their body.
export type RelayMessage =
  | {type: 'ready'; sessionId: string}
  | {type: 'request'; id: string; agentId: string; body: string};
export type HostMessage =
  | {type: 'host'; token: string}
  | {
      type: 'response';
      id: string;
      status: 200 | 400 | 403 | 429 | 500;
      body?: string;
    };
export const maxRelayMessageBytes = maxEnvelopeBytes * 2 + 1024;

function body(value: unknown): string {
  const result = string(value, 'Encrypted body');
  if (new TextEncoder().encode(result).length > maxEnvelopeBytes)
    throw new AgentError(
      'message_too_large',
      'Encrypted body exceeds the size limit.',
    );
  return result;
}

export function parseRelayMessage(value: unknown): RelayMessage {
  const data = object(
    value,
    ['type', 'sessionId', 'id', 'agentId', 'body'],
    'Relay message',
  );
  if (data.type === 'ready')
    return {type: 'ready', sessionId: identifier(data.sessionId, 'Session ID')};
  if (data.type === 'request')
    return {
      type: 'request',
      id: identifier(data.id, 'Transport ID'),
      agentId: identifier(data.agentId, 'Agent ID'),
      body: body(data.body),
    };
  throw new AgentError('invalid_message', 'Unknown relay message.');
}

export function parseHostMessage(value: unknown): HostMessage {
  const data = object(
    value,
    ['type', 'token', 'id', 'status', 'body'],
    'Host message',
  );
  if (data.type === 'host')
    return {type: 'host', token: secret(data.token, 'Host token')};
  if (
    data.type === 'response' &&
    [200, 400, 403, 429, 500].includes(data.status as number)
  )
    return {
      type: 'response',
      id: identifier(data.id, 'Transport ID'),
      status: data.status as 200 | 400 | 403 | 429 | 500,
      ...(data.body === undefined ? {} : {body: body(data.body)}),
    };
  throw new AgentError('invalid_message', 'Unknown host message.');
}
