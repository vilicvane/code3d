import {type AgentConfig, requestUrl} from './config.js';
import {AgentCipher, maxEnvelopeBytes} from './crypto.js';
import {
  type AgentRequest,
  type AgentResponse,
  parseRequest,
  parseResponse,
} from './protocol.js';
import {AgentError} from './validation.js';
import {
  parseTransportFailure,
  type RequestDelivery,
} from './bridge-protocol.js';

export type RequestOptions = Readonly<{
  requestId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export class AgentClient {
  private constructor(
    private readonly config: AgentConfig,
    private readonly cipher: AgentCipher,
  ) {}

  static async create(config: AgentConfig): Promise<AgentClient> {
    return new AgentClient(config, await AgentCipher.create(config));
  }

  async request(
    request: AgentRequest,
    options: RequestOptions = {},
  ): Promise<{requestId: string; response: AgentResponse}> {
    const requestId = options.requestId ?? crypto.randomUUID();
    const body = await this.cipher.seal(
      'request',
      requestId,
      parseRequest(request),
    );
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
    const signal = options.signal
      ? AbortSignal.any([timeout, options.signal])
      : timeout;
    let response: Response;
    try {
      response = await fetch(requestUrl(this.config), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        credentials: 'omit',
        signal,
      });
    } catch (error) {
      const refused =
        !signal.aborted &&
        error instanceof Error &&
        (error.cause as {code?: string} | undefined)?.code === 'ECONNREFUSED';
      throw new AgentTransportError(
        refused
          ? 'service_unavailable'
          : signal.aborted
            ? 'request_aborted'
            : 'transport_failed',
        refused
          ? 'The local c3d service is not listening. Start serve in the current agent session. This attempt did not connect; earlier attempts with the same ID may still have been accepted.'
          : 'The request outcome is unknown. Restore the service and App connection, then query the original request ID before another change.',
        refused ? 'not_sent' : 'unknown',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AgentTransportError(
        'bridge_error',
        `Local service returned HTTP ${response.status}. The application outcome is unknown; query the original request ID after restoring the connection.`,
        'unknown',
      );
    }
    try {
      const raw: unknown = JSON.parse(
        await readBoundedBody(response, maxEnvelopeBytes),
      );
      const opened = await this.cipher.open('response', raw);
      if (opened.requestId !== requestId)
        throw new AgentError(
          'response_mismatch',
          'Response belongs to a different request.',
        );
      const value = opened.value as {transportError?: unknown} | null;
      if (value && typeof value === 'object' && 'transportError' in value) {
        const failure = parseTransportFailure(value.transportError);
        throw new AgentTransportError(
          failure.code,
          failure.message,
          failure.delivery,
        );
      }
      return {requestId, response: parseResponse(opened.value)};
    } catch (error) {
      if (error instanceof AgentTransportError) throw error;
      throw new AgentTransportError(
        error instanceof AgentError ? error.code : 'invalid_response',
        'No complete authenticated result was received. Query the original request ID after restoring the connection.',
        'unknown',
      );
    }
  }
}

/** Bound streamed bodies too; Content-Length is not a trustworthy size limit. */
export async function readBoundedBody(
  response: Response,
  limit: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new AgentError('invalid_response', 'Response body is empty.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AgentError(
          'message_too_large',
          'Response exceeds the size limit.',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}

export class AgentTransportError extends AgentError {
  constructor(
    code: string,
    message: string,
    readonly delivery: RequestDelivery,
  ) {
    super(code, message, {delivery});
  }
}
