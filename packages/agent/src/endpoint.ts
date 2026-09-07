import type {AgentConfig} from './config.js';
import {AgentCipher, type Envelope, maxMessageBytes} from './crypto.js';
import {
  type AgentRequest,
  type AgentResponse,
  failure,
  parseRequest,
  parseResponse,
} from './protocol.js';
import {AgentError} from './validation.js';

type ApplicationRequest = Exclude<AgentRequest, {operation: 'result'}>;
export type RequestHandler = (
  request: ApplicationRequest,
) => Promise<AgentResponse>;
type Receipt = {
  fingerprint: string;
  pending: Promise<AgentResponse>;
  response?: AgentResponse;
};

/**
 * Owned by one App session/agent grant. Never evict mutation receipts and then
 * accept the same request ID again: closing/replacing an endpoint requires a
 * fresh grant, and an exhausted endpoint rejects new work while results remain readable.
 */
export class AgentEndpoint {
  private readonly receipts = new Map<string, Receipt>();
  private responseBytes = 0;
  private reservedBytes = 0;
  private closed = false;

  private constructor(
    private readonly cipher: AgentCipher,
    private readonly handler: RequestHandler,
    private readonly limits: Readonly<{requests: number; bytes: number}>,
  ) {}

  static async create(
    config: AgentConfig,
    handler: RequestHandler,
    limits = {requests: 4096, bytes: 64 * 1024 * 1024},
  ): Promise<AgentEndpoint> {
    if (
      !Number.isSafeInteger(limits.requests) ||
      limits.requests < 1 ||
      !Number.isSafeInteger(limits.bytes) ||
      limits.bytes < maxMessageBytes
    )
      throw new RangeError(
        'Receipt limits require at least one request and one maximum-size response.',
      );
    return new AgentEndpoint(await AgentCipher.create(config), handler, limits);
  }

  close(): void {
    this.closed = true;
    this.receipts.clear();
    this.responseBytes = 0;
  }

  async handle(envelope: unknown): Promise<Envelope> {
    if (this.closed)
      throw new AgentError('session_closed', 'Agent grant is closed.');
    const opened = await this.cipher.open('request', envelope);
    if (this.closed)
      throw new AgentError('session_closed', 'Agent grant is closed.');
    let response: AgentResponse;
    try {
      const request = parseRequest(opened.value);
      response =
        request.operation === 'result'
          ? this.result(request.requestId)
          : await this.execute(opened.requestId, request);
    } catch (error) {
      if (!(error instanceof AgentError)) throw error;
      response = failure(error.code, error.message);
    }
    if (this.closed)
      throw new AgentError('session_closed', 'Agent grant is closed.');
    return this.cipher.seal('response', opened.requestId, response);
  }

  private result(requestId: string): AgentResponse {
    const receipt = this.receipts.get(requestId);
    if (!receipt)
      return failure(
        'result_unknown',
        'No receipt exists for this request in the current grant.',
      );
    return (
      receipt.response ??
      failure('result_pending', 'The request is still running.')
    );
  }

  private async execute(
    requestId: string,
    request: ApplicationRequest,
  ): Promise<AgentResponse> {
    // parseRequest produces a canonical field order, preserving meaningful array order.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(request)),
    );
    const fingerprint = Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    if (this.closed)
      throw new AgentError('session_closed', 'Agent grant is closed.');
    const existing = this.receipts.get(requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        return failure(
          'request_conflict',
          'Request ID was already used with different content.',
        );
      return existing.pending;
    }
    if (
      this.receipts.size >= this.limits.requests ||
      this.responseBytes + maxMessageBytes > this.limits.bytes
    )
      return failure(
        'session_capacity',
        'Agent grant has reached its receipt capacity. Existing results remain available.',
      );
    if (
      this.responseBytes + this.reservedBytes + maxMessageBytes >
      this.limits.bytes
    )
      return failure(
        'agent_busy',
        'Receipt storage is reserved by running requests. Retry after they finish.',
      );

    // Register before calling the handler so concurrent retries join the same execution.
    let complete!: (response: AgentResponse) => void;
    const receipt: Receipt = {
      fingerprint,
      pending: new Promise(resolve => {
        complete = resolve;
      }),
    };
    this.receipts.set(requestId, receipt);
    this.reservedBytes += maxMessageBytes;
    let response: AgentResponse;
    try {
      response = parseResponse(await this.handler(request));
      if (
        new TextEncoder().encode(JSON.stringify(response)).length >
        maxMessageBytes
      )
        response = failure(
          'response_too_large',
          'Application response exceeds the message limit.',
          {outcome: 'unknown'},
        );
    } catch (error) {
      response =
        error instanceof AgentError
          ? failure(error.code, error.message, {outcome: 'unknown'})
          : failure('application_error', 'Application request failed.', {
              outcome: 'unknown',
            });
    }
    receipt.response = response;
    this.reservedBytes -= maxMessageBytes;
    if (!this.closed)
      this.responseBytes += new TextEncoder().encode(
        JSON.stringify(response),
      ).length;
    complete(response);
    return response;
  }
}
