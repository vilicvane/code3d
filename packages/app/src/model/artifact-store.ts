import type {KernelArtifactStore} from '@code3d/core/tooling';
import {
  artifactAccounting,
  artifactMailboxHeaderBytes,
  artifactOperationBytes,
  artifactReply,
  artifactRequestTimeout,
  artifactReadControl,
  artifactMailboxBytes,
  unpackArtifactValues,
  type ArtifactOperation,
  type ArtifactStoreEndpoint,
  type ArtifactStoreRequest,
} from './artifact-store-protocol';
import {
  checkCompilationCancellation,
  type CompilationCancellation,
} from './compilation-cancellation';
import type {ArtifactStoreServer} from './artifact-store-server';

/** Synchronous reads and background mutations over a project-owned I/O connection. */
export class ArtifactStoreConnection {
  // Compiler/executor requests are serialized. Synchronous preview restoration
  // temporarily overrides this token without changing the active compile.
  readCancellation?: CompilationCancellation;

  withReadCancellation<T>(
    cancellation: CompilationCancellation,
    action: () => T,
  ): T {
    const previous = this.readCancellation;
    this.readCancellation = cancellation;
    try {
      return action();
    } finally {
      this.readCancellation = previous;
    }
  }

  private endpoint?: ArtifactStoreEndpoint;
  private state?: Int32Array<SharedArrayBuffer>;
  private buffer?: Uint8Array;
  private accounting?: BigInt64Array;
  private failed = false;
  private sequence = 0;
  private nextRead = 0;
  private transferMilliseconds = 0;
  private readMilliseconds = 0;
  private readonly readAccess = new Map<string, Set<string>>();
  private resolveReady!: () => void;
  readonly ready = new Promise<void>(resolve => {
    this.resolveReady = resolve;
  });

  connect(endpoint?: ArtifactStoreEndpoint): void {
    if (!endpoint) {
      this.failed = true;
      this.resolveReady();
      return;
    }
    this.endpoint = endpoint;
    this.state = new Int32Array(endpoint.mailbox, 0, 4);
    this.buffer = new Uint8Array(endpoint.mailbox, artifactMailboxHeaderBytes);
    this.accounting = new BigInt64Array(endpoint.accounting);
    endpoint.port.onmessage = () => this.resolveReady();
  }

  get pendingBytes(): number {
    return this.accounting
      ? Number(Atomics.load(this.accounting, artifactAccounting.bytes))
      : 0;
  }

  scope(namespace: string): KernelArtifactStore {
    const connection = this;
    return {
      get pendingWriteBytes() {
        return connection.pendingBytes;
      },
      get: id => {
        const result = this.request(namespace, {kind: 'get', id});
        if (result instanceof Uint8Array) {
          this.recordRead(namespace, id);
          return result;
        }
        return undefined;
      },
      getMany: ids => {
        const result = this.request(namespace, {kind: 'get-many', ids});
        const values =
          result instanceof Uint8Array
            ? unpackArtifactValues(result)
            : ids.map(() => undefined);
        values.forEach((value, index) => {
          if (value) this.recordRead(namespace, ids[index]);
        });
        return values;
      },
      set: (id, bytes) => {
        // Encoders and resource caches may retain this view. Transfer an owned copy,
        // so their live bytes are neither detached nor cloned a second time in transit.
        this.enqueue(namespace, {kind: 'set', id, bytes});
      },
      touch: id => this.request(namespace, {kind: 'touch', id}) === true,
      touchMany: ids => {
        const result = this.request(namespace, {kind: 'touch-many', ids});
        return result instanceof Uint8Array
          ? Array.from(result, Boolean)
          : ids.map(() => false);
      },
      delete: id => this.enqueue(namespace, {kind: 'delete', id}),
      flush: () => this.enqueue(namespace, {kind: 'flush'}),
    };
  }

  publish(
    namespace: string,
    id: string,
    value: {stamp: number; artifact: string},
    required: readonly string[],
  ): void {
    this.enqueue(namespace, {
      kind: 'publish',
      id,
      stamp: value.stamp,
      bytes: new TextEncoder().encode(JSON.stringify(value)),
      required,
    });
  }

  clear(namespace: string): void {
    if (this.request(namespace, {kind: 'clear'}) !== true)
      throw new Error('Could not clear the persistent build cache.');
  }

  /** Explicit durability barrier; ordinary model completion only schedules a flush. */
  drain(): void {
    this.flushReadAccess();
    this.request('', {kind: 'drain'});
  }

  get stats():
    | (ArtifactStoreServer['stats'] & {
        transferMilliseconds: number;
        readMilliseconds: number;
      })
    | undefined {
    const bytes = this.request('', {kind: 'stats'});
    return bytes instanceof Uint8Array
      ? {
          ...JSON.parse(new TextDecoder().decode(bytes)),
          transferMilliseconds: this.transferMilliseconds,
          readMilliseconds: this.readMilliseconds,
        }
      : undefined;
  }

  dispose(): void {
    this.flushReadAccess();
    this.enqueue('', {kind: 'flush'});
    this.failed = true;
    this.resolveReady();
    if (this.accounting)
      Atomics.store(this.accounting, artifactAccounting.closed, 1n);
  }

  private recordRead(namespace: string, id: string): void {
    let entries = this.readAccess.get(namespace);
    if (!entries) this.readAccess.set(namespace, (entries = new Set()));
    entries.delete(id);
    entries.add(id);
  }

  private flushReadAccess(): void {
    const pending = [...this.readAccess];
    this.readAccess.clear();
    for (const [namespace, entries] of pending)
      this.enqueue(namespace, {kind: 'touch-many', ids: [...entries]});
  }

  private enqueue(namespace: string, operation: ArtifactOperation): void {
    if (
      this.failed ||
      !this.endpoint ||
      Atomics.load(this.accounting!, artifactAccounting.closed)
    )
      return;
    this.flushReadAccess();
    const started = performance.now();
    const transfer: Transferable[] = [];
    if ('bytes' in operation) {
      const bytes = Uint8Array.from(operation.bytes);
      operation = {...operation, bytes};
      transfer.push(bytes.buffer);
    }
    const byteLength = BigInt(artifactOperationBytes(operation));
    Atomics.add(this.accounting!, artifactAccounting.bytes, byteLength);
    Atomics.add(this.accounting!, artifactAccounting.operations, 1n);
    try {
      const sequence = ++this.sequence;
      this.endpoint.port.postMessage(
        {
          namespace,
          operation,
          reply: false,
          sequence,
        } satisfies ArtifactStoreRequest,
        transfer,
      );
      // A terminated producer guarantees only calls that finished posting.
      // Counting before postMessage cannot serve as a shutdown fence.
      Atomics.store(
        this.accounting!,
        artifactAccounting.posted,
        BigInt(sequence),
      );
    } catch {
      Atomics.sub(this.accounting!, artifactAccounting.bytes, byteLength);
      Atomics.sub(this.accounting!, artifactAccounting.operations, 1n);
      this.failed = true;
    } finally {
      this.transferMilliseconds += performance.now() - started;
    }
  }

  private request(
    namespace: string,
    operation: ArtifactOperation,
  ): Uint8Array | boolean | undefined {
    const started = performance.now();
    try {
      return this.read(namespace, operation);
    } finally {
      this.readMilliseconds += performance.now() - started;
    }
  }

  private read(
    namespace: string,
    operation: ArtifactOperation,
  ): Uint8Array | boolean | undefined {
    if (
      this.failed ||
      !this.endpoint ||
      Atomics.load(this.accounting!, artifactAccounting.closed)
    )
      return;
    const state = this.state!;
    const buffer = this.buffer!;
    const control = new Int32Array(this.endpoint.control);
    const generation = ['get', 'get-many', 'touch', 'touch-many'].includes(
      operation.kind,
    )
      ? Atomics.load(control, artifactReadControl.generation)
      : undefined;
    const cancellation =
      generation === undefined ? undefined : this.readCancellation;
    if (cancellation) checkCompilationCancellation(cancellation);
    state.fill(0);
    this.endpoint.port.postMessage({
      namespace,
      operation,
      reply: true,
      id: ++this.nextRead,
      generation,
      mailbox: state.buffer,
    } satisfies ArtifactStoreRequest);
    let bytes: Uint8Array | undefined;
    let offset = 0;
    let deadline = performance.now() + artifactRequestTimeout;
    for (;;) {
      const wake = Atomics.load(control, artifactReadControl.wake);
      if (Atomics.load(this.accounting!, artifactAccounting.closed)) return;
      if (
        generation !== undefined &&
        (generation !== Atomics.load(control, artifactReadControl.generation) ||
          (cancellation && Atomics.load(cancellation, 0)))
      ) {
        const mailbox = new SharedArrayBuffer(
          artifactMailboxHeaderBytes + artifactMailboxBytes,
        );
        this.state = new Int32Array(mailbox, 0, 4);
        this.buffer = new Uint8Array(mailbox, artifactMailboxHeaderBytes);
        throw new Error('Compilation superseded.');
      }
      const phase = Atomics.load(state, 0);
      if (phase === artifactReply.pending) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) {
          this.failed = true;
          return;
        }
        Atomics.wait(control, artifactReadControl.wake, wake, remaining);
        continue;
      }
      if (phase === artifactReply.failed) return;
      if (phase === artifactReply.done)
        return (
          bytes ??
          (Atomics.load(state, 3)
            ? operation.kind === 'get'
              ? new Uint8Array()
              : true
            : undefined)
        );
      if (phase === artifactReply.chunk) {
        bytes ??= new Uint8Array(Atomics.load(state, 2));
        const length = Atomics.load(state, 1);
        bytes.set(buffer.subarray(0, length), offset);
        deadline = performance.now() + artifactRequestTimeout;
        offset += length;
        Atomics.store(state, 0, artifactReply.pending);
        Atomics.notify(state, 0);
      }
    }
  }
}
