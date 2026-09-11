/// <reference lib="webworker" />
/// <reference lib="es2024.sharedmemory" />

import {
  artifactAccounting,
  artifactMailboxHeaderBytes,
  artifactOperationBytes,
  artifactReply,
  artifactRequestTimeout,
  artifactReadControl,
  type ArtifactStoreEndpoint,
  type ArtifactStoreRequest,
} from './artifact-store-protocol';
import {ArtifactStoreServer} from './artifact-store-server';

const scope = self as DedicatedWorkerGlobalScope;
const server = new ArtifactStoreServer();
type Client = ArtifactStoreEndpoint & {
  received: number;
  reads: Map<
    number,
    {generation: number | undefined; controller: AbortController}
  >;
};
const clients = new Set<Client>();
let disposing = false;
let finishing = false;
let closing: ReturnType<typeof setTimeout> | undefined;

function closeIdleClients(): void {
  if (closing !== undefined) clearTimeout(closing);
  closing = undefined;
  for (const client of clients) {
    const accounting = new BigInt64Array(client.accounting);
    if (
      Atomics.load(accounting, artifactAccounting.closed) &&
      client.received >=
        Number(Atomics.load(accounting, artifactAccounting.posted))
    ) {
      for (const read of client.reads.values()) read.controller.abort();
      client.port.close();
      clients.delete(client);
    }
  }
  if (disposing && !clients.size && !finishing) {
    finishing = true;
    void server.drain().then(() => {
      scope.postMessage({kind: 'disposed'});
      scope.close();
    });
  } else if (
    [...clients].some(client =>
      Atomics.load(
        new BigInt64Array(client.accounting),
        artifactAccounting.closed,
      ),
    )
  ) {
    // Messages already posted by a terminated Worker can still be in transit.
    // The last fully posted sequence fences closing, even if termination
    // interrupted an increment or postMessage for an unfinished cache call.
    closing = setTimeout(closeIdleClients, 25);
  }
}

scope.onmessage = ({
  data,
}: MessageEvent<
  | {kind: 'connect'; endpoint: ArtifactStoreEndpoint}
  | {kind: 'disconnect' | 'dispose'}
  | {kind: 'cancel-reads'; id: number}
>) => {
  if (data.kind === 'cancel-reads') {
    const client = [...clients].find(client => client.id === data.id);
    if (client) {
      const generation = Atomics.load(
        new Int32Array(client.control),
        artifactReadControl.generation,
      );
      for (const read of client.reads.values()) {
        if (read.generation !== undefined && read.generation !== generation)
          read.controller.abort();
      }
    }
    return;
  }
  if (data.kind !== 'connect') {
    if (data.kind === 'dispose') disposing = true;
    closeIdleClients();
    return;
  }
  const client: Client = {...data.endpoint, received: 0, reads: new Map()};
  const accounting = new BigInt64Array(client.accounting);
  clients.add(client);
  client.port.onmessage = ({data}: MessageEvent<ArtifactStoreRequest>) => {
    if (data.reply) {
      // Responses must not serialize the global queue: a dead reader or a large
      // streamed result cannot prevent another Worker using its pending values.
      void respond(client, data);
    } else {
      client.received = data.sequence;
      const bytes = BigInt(artifactOperationBytes(data.operation));
      server.enqueue(data.namespace, data.operation, () => {
        Atomics.sub(accounting, artifactAccounting.bytes, bytes);
        Atomics.sub(accounting, artifactAccounting.operations, 1n);
        closeIdleClients();
      });
      closeIdleClients();
    }
  };
  client.port.postMessage({kind: 'ready'});
};

async function respond(
  client: Client,
  request: Extract<ArtifactStoreRequest, {reply: true}>,
): Promise<void> {
  const state = new Int32Array(request.mailbox, 0, 4);
  const control = new Int32Array(client.control);
  if (
    request.generation !== undefined &&
    request.generation !== Atomics.load(control, artifactReadControl.generation)
  )
    return;
  const controller = new AbortController();
  const signal = controller.signal;
  client.reads.set(request.id, {generation: request.generation, controller});
  const wake = () => {
    Atomics.add(control, artifactReadControl.wake, 1);
    Atomics.notify(control, artifactReadControl.wake);
  };
  const abort = () => {
    Atomics.store(state, 0, artifactReply.failed);
    Atomics.notify(state, 0);
    wake();
  };
  signal.addEventListener('abort', abort, {once: true});
  const accounting = new BigInt64Array(client.accounting);
  const closed = () =>
    signal.aborted ||
    !!Atomics.load(accounting, artifactAccounting.closed) ||
    (request.generation !== undefined &&
      request.generation !==
        Atomics.load(control, artifactReadControl.generation));
  const buffer = new Uint8Array(request.mailbox, artifactMailboxHeaderBytes);
  try {
    if (request.operation.kind === 'clear') {
      // A restarted compiler may request a clear before the dead compiler's
      // last port messages arrive. Drain those accepted writes first.
      while (
        [...clients].some(client => {
          const accounting = new BigInt64Array(client.accounting);
          return Atomics.load(accounting, artifactAccounting.closed);
        })
      ) {
        await server.drain();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    const result = await server.request(
      request.namespace,
      request.operation,
      signal,
    );
    if (closed()) return;
    const bytes = result instanceof Uint8Array ? result : undefined;
    Atomics.store(state, 2, bytes?.byteLength ?? 0);
    Atomics.store(state, 3, bytes ? 1 : result ? 1 : 0);
    if (bytes) {
      for (
        let offset = 0;
        offset < bytes.byteLength;
        offset += buffer.byteLength
      ) {
        if (closed()) return;
        const chunk = bytes.subarray(offset, offset + buffer.byteLength);
        buffer.set(chunk);
        Atomics.store(state, 1, chunk.byteLength);
        Atomics.store(state, 0, artifactReply.chunk);
        wake();
        const wait = Atomics.waitAsync(
          state,
          0,
          artifactReply.chunk,
          artifactRequestTimeout,
        );
        if ((await wait.value) === 'timed-out') return;
      }
    }
    if (closed()) return;
    Atomics.store(state, 0, artifactReply.done);
  } catch {
    if (closed()) return;
    Atomics.store(state, 0, artifactReply.failed);
  } finally {
    signal.removeEventListener('abort', abort);
    client.reads.delete(request.id);
  }
  wake();
}
