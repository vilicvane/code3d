import type {AgentConfig} from './config.js';
import {
  AgentError,
  decodeBase64,
  encodeBase64,
  identifier,
  object,
  string,
} from './validation.js';

export const maxMessageBytes = 16 * 1024 * 1024;
export const maxEnvelopeBytes = Math.ceil((maxMessageBytes * 4) / 3) + 1024;
export type Direction = 'request' | 'response' | 'bridge-proof' | 'app-proof';
export type Envelope = Readonly<{
  version: 1;
  requestId: string;
  nonce: string;
  ciphertext: string;
}>;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

export function parseEnvelope(value: unknown): Envelope {
  const data = object(
    value,
    ['version', 'requestId', 'nonce', 'ciphertext'],
    'Encrypted envelope',
  );
  if (data.version !== 1)
    throw new AgentError(
      'invalid_envelope',
      'Unsupported encrypted envelope version.',
    );
  const ciphertext = string(data.ciphertext, 'Ciphertext');
  if (ciphertext.length > maxEnvelopeBytes)
    throw new AgentError(
      'message_too_large',
      'Encrypted message exceeds the size limit.',
    );
  if (decodeBase64(data.nonce, 'Nonce').length !== 12)
    throw new AgentError('invalid_envelope', 'Nonce must be 12 bytes.');
  return {
    version: 1,
    requestId: identifier(data.requestId, 'Request ID'),
    nonce: data.nonce as string,
    ciphertext,
  };
}

/** Per-agent, per-direction keys keep senders in distinct nonce domains. */
export class AgentCipher {
  private constructor(
    private readonly identity: Pick<AgentConfig, 'sessionId' | 'agentId'>,
    private readonly keys: Readonly<Record<Direction, CryptoKey>>,
  ) {}

  static async create(config: AgentConfig): Promise<AgentCipher> {
    const root = await crypto.subtle.importKey(
      'raw',
      decodeBase64(config.key, 'Content key'),
      'HKDF',
      false,
      ['deriveKey'],
    );
    const derive = (direction: Direction) =>
      crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: encoder.encode(config.sessionId),
          info: encoder.encode(
            JSON.stringify(['code3d-agent', 1, config.agentId, direction]),
          ),
        },
        root,
        {name: 'AES-GCM', length: 256},
        false,
        ['encrypt', 'decrypt'],
      );
    const [request, response, bridgeProof, appProof] = await Promise.all([
      derive('request'),
      derive('response'),
      derive('bridge-proof'),
      derive('app-proof'),
    ]);
    return new AgentCipher(config, {
      request,
      response,
      'bridge-proof': bridgeProof,
      'app-proof': appProof,
    });
  }

  async seal(
    direction: Direction,
    requestId: string,
    value: unknown,
  ): Promise<Envelope> {
    identifier(requestId, 'Request ID');
    const plaintext = encoder.encode(JSON.stringify(value));
    if (plaintext.length > maxMessageBytes)
      throw new AgentError(
        'message_too_large',
        'Message exceeds the size limit.',
      );
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        tagLength: 128,
        additionalData: this.context(direction, requestId),
      },
      this.keys[direction],
      plaintext,
    );
    return {
      version: 1,
      requestId,
      nonce: encodeBase64(nonce),
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    };
  }

  async open(
    direction: Direction,
    value: unknown,
  ): Promise<{requestId: string; value: unknown}> {
    const envelope = parseEnvelope(value);
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: decodeBase64(envelope.nonce, 'Nonce'),
          tagLength: 128,
          additionalData: this.context(direction, envelope.requestId),
        },
        this.keys[direction],
        decodeBase64(envelope.ciphertext, 'Ciphertext'),
      );
    } catch {
      throw new AgentError(
        'authentication_failed',
        'Encrypted message authentication failed.',
      );
    }
    if (plaintext.byteLength > maxMessageBytes)
      throw new AgentError(
        'message_too_large',
        'Message exceeds the size limit.',
      );
    try {
      return {
        requestId: envelope.requestId,
        value: JSON.parse(decoder.decode(plaintext)) as unknown,
      };
    } catch {
      throw new AgentError(
        'invalid_message',
        'Decrypted message must contain UTF-8 JSON.',
      );
    }
  }

  private context(
    direction: Direction,
    requestId: string,
  ): Uint8Array<ArrayBuffer> {
    return encoder.encode(
      JSON.stringify([
        'code3d-agent',
        1,
        this.identity.sessionId,
        this.identity.agentId,
        direction,
        requestId,
      ]),
    );
  }
}
