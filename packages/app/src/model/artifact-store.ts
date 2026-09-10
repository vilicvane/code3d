import type {KernelArtifactStore} from '@code3d/core/tooling';
import {
  artifactMailboxBytes,
  artifactMailboxHeaderBytes,
  artifactReply,
  artifactRequestTimeout,
  unpackArtifactValues,
  type ArtifactOperation,
  type ArtifactStoreRequest,
} from './artifact-store-protocol';
import ArtifactWorker from './artifact-store.worker?worker';
import type {PersistentArtifactStats} from './persistent-artifacts';

/** Synchronous cache API over a dedicated I/O worker's short OPFS transactions. */
export class ArtifactStoreConnection {
  private readonly worker: Worker;
  private readonly port: MessagePort;
  private readonly mailbox = new SharedArrayBuffer(
    artifactMailboxHeaderBytes + artifactMailboxBytes,
  );
  private readonly state = new Int32Array(this.mailbox, 0, 4);
  private readonly buffer = new Uint8Array(
    this.mailbox,
    artifactMailboxHeaderBytes,
  );
  private failed = false;
  private readonly readAccess = new Map<string, Set<string>>();
  readonly ready: Promise<void>;

  constructor() {
    this.worker = new ArtifactWorker();
    const {port1, port2} = new MessageChannel();
    this.port = port1;
    // A nested Worker's postMessage delivery can depend on its blocked creator.
    // Connect a MessagePort before using Atomics.wait for synchronous replies.
    this.worker.postMessage({port: port2}, [port2]);
    this.ready = new Promise(resolve => {
      this.worker.onmessage = () => resolve();
      this.worker.addEventListener(
        'error',
        () => {
          this.failed = true;
          resolve();
        },
        {once: true},
      );
    });
    this.worker.onerror = () => {
      this.failed = true;
    };
  }

  scope(namespace: string): KernelArtifactStore {
    return {
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
        this.request(namespace, {kind: 'set', id, bytes});
      },
      touch: id => this.request(namespace, {kind: 'touch', id}) === true,
      touchMany: ids => {
        const result = this.request(namespace, {kind: 'touch-many', ids});
        return result instanceof Uint8Array
          ? Array.from(result, Boolean)
          : ids.map(() => false);
      },
      delete: id => {
        this.request(namespace, {kind: 'delete', id});
      },
      flush: () => {
        this.request(namespace, {kind: 'flush'});
      },
    };
  }

  publish(
    namespace: string,
    id: string,
    value: {stamp: number; artifact: string},
    required: readonly string[],
  ): boolean {
    return (
      this.request(namespace, {
        kind: 'publish',
        id,
        stamp: value.stamp,
        bytes: new TextEncoder().encode(JSON.stringify(value)),
        required,
      }) === true
    );
  }

  get stats(): PersistentArtifactStats | undefined {
    const bytes = this.request('', {kind: 'stats'});
    return bytes instanceof Uint8Array
      ? (JSON.parse(new TextDecoder().decode(bytes)) ?? undefined)
      : undefined;
  }

  private recordRead(namespace: string, id: string): void {
    let entries = this.readAccess.get(namespace);
    if (!entries) this.readAccess.set(namespace, (entries = new Set()));
    entries.delete(id);
    entries.add(id);
  }

  /** Disk reads, like memory hits, update LRU together at the next write/flush. */
  private flushReadAccess(): void {
    const pending = [...this.readAccess];
    this.readAccess.clear();
    for (const [namespace, entries] of pending)
      this.request(namespace, {kind: 'touch-many', ids: [...entries]});
  }

  private request(
    namespace: string,
    operation: ArtifactOperation,
  ): Uint8Array | boolean | undefined {
    if (this.failed) return;
    if (operation.kind !== 'get' && operation.kind !== 'get-many')
      this.flushReadAccess();
    this.state.fill(0);
    const message: ArtifactStoreRequest = {
      namespace,
      operation,
      mailbox: this.mailbox,
    };
    this.port.postMessage(message);
    let bytes: Uint8Array | undefined;
    let offset = 0;
    for (;;) {
      if (
        Atomics.wait(
          this.state,
          0,
          artifactReply.pending,
          artifactRequestTimeout,
        ) === 'timed-out'
      ) {
        this.failed = true;
        this.worker.terminate();
        return;
      }
      const phase = Atomics.load(this.state, 0);
      if (phase === artifactReply.failed) return;
      if (phase === artifactReply.done)
        return (
          bytes ??
          (Atomics.load(this.state, 3)
            ? operation.kind === 'get'
              ? new Uint8Array()
              : true
            : undefined)
        );
      if (phase === artifactReply.chunk) {
        bytes ??= new Uint8Array(Atomics.load(this.state, 2));
        const length = Atomics.load(this.state, 1);
        bytes.set(this.buffer.subarray(0, length), offset);
        offset += length;
        Atomics.store(this.state, 0, artifactReply.pending);
        Atomics.notify(this.state, 0);
      }
    }
  }

  dispose(): void {
    this.failed = true;
    this.port.close();
    this.worker.terminate();
  }
}
