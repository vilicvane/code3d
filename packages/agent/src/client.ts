import {type AgentConfig, requestUrl} from './config.js';
import {AgentCipher, maxEnvelopeBytes} from './crypto.js';
import {
  type AgentRequest,
  type AgentResponse,
  parseRequest,
  parseResponse,
} from './protocol.js';
import {AgentError} from './validation.js';

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
    } catch {
      throw new AgentError(
        signal.aborted ? 'request_aborted' : 'transport_failed',
        'Request result is unknown. Ensure the c3d MCP server is running and the App is connected. Query the request ID before submitting another change.',
      );
    }
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      const seconds =
        retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN;
      await response.body?.cancel();
      throw new AgentError(
        'bridge_error',
        'Local bridge returned HTTP ' +
          response.status +
          '. The application result is not confirmed.' +
          (Number.isSafeInteger(seconds) && seconds >= 0
            ? ` Retry after ${seconds} seconds using the original request ID, or query that ID.`
            : ''),
      );
    }
    let raw: unknown;
    try {
      const text = await readBoundedBody(response, maxEnvelopeBytes);
      raw = JSON.parse(text) as unknown;
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentError(
        'invalid_response',
        'Local bridge did not return a complete encrypted response.',
      );
    }
    const opened = await this.cipher.open('response', raw);
    if (opened.requestId !== requestId)
      throw new AgentError(
        'response_mismatch',
        'Response belongs to a different request.',
      );
    return {requestId, response: parseResponse(opened.value)};
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
