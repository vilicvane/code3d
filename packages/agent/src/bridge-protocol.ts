import {maxEnvelopeBytes, parseEnvelope, type Envelope} from './crypto.js';
import {AgentError, identifier, object, string} from './validation.js';

export type BridgeMessage =
  | {type: 'challenge'; envelope: Envelope}
  | {type: 'ready'}
  | {type: 'request'; id: string; body: string};
export type AppMessage =
  | {type: 'hello'; challenge: string}
  | {type: 'authenticate'; envelope: Envelope}
  | {type: 'response'; id: string; body?: string};
export const maxBridgeMessageBytes = maxEnvelopeBytes * 2 + 1024;

function body(value: unknown): string {
  const result = string(value, 'Encrypted body');
  if (new TextEncoder().encode(result).length > maxEnvelopeBytes)
    throw new AgentError(
      'message_too_large',
      'Encrypted body exceeds the size limit.',
    );
  return result;
}

export function parseBridgeMessage(value: unknown): BridgeMessage {
  const data = object(
    value,
    ['type', 'envelope', 'id', 'body'],
    'Bridge message',
  );
  if (data.type === 'challenge')
    return {type: 'challenge', envelope: parseEnvelope(data.envelope)};
  if (data.type === 'ready') return {type: 'ready'};
  if (data.type === 'request')
    return {
      type: 'request',
      id: identifier(data.id, 'Transport ID'),
      body: body(data.body),
    };
  throw new AgentError('invalid_message', 'Unknown bridge message.');
}

export function parseAppMessage(value: unknown): AppMessage {
  const data = object(
    value,
    ['type', 'envelope', 'id', 'body', 'challenge'],
    'App message',
  );
  if (data.type === 'hello')
    return {
      type: 'hello',
      challenge: identifier(data.challenge, 'App challenge'),
    };
  if (data.type === 'authenticate')
    return {type: 'authenticate', envelope: parseEnvelope(data.envelope)};
  if (data.type === 'response')
    return {
      type: 'response',
      id: identifier(data.id, 'Transport ID'),
      ...(data.body === undefined ? {} : {body: body(data.body)}),
    };
  throw new AgentError('invalid_message', 'Unknown App message.');
}

/** This attempt's forwarding state, never the historical state of a request ID. */
export type RequestDelivery = 'not_sent' | 'unknown';
export type TransportFailure = {
  code: string;
  message: string;
  delivery: RequestDelivery;
};
export function parseTransportFailure(value: unknown): TransportFailure {
  const data = object(
    value,
    ['code', 'message', 'delivery'],
    'Transport failure',
  );
  if (data.delivery !== 'not_sent' && data.delivery !== 'unknown')
    throw new AgentError('invalid_response', 'Invalid request delivery state.');
  return {
    code: identifier(data.code, 'Transport error code'),
    message: string(data.message, 'Transport error message'),
    delivery: data.delivery,
  };
}
