import {
  artifactAccounting,
  artifactAccountingBytes,
  artifactMailboxBytes,
  artifactMailboxHeaderBytes,
  artifactReply,
  type ArtifactStoreEndpoint,
  type ArtifactStoreInitialization,
} from './artifact-store-protocol';
import ArtifactWorker from './artifact-store.worker?worker';

/** Project-owned I/O survives replacement of compiler/executor Workers. */
export class ArtifactStoreHost {
  private readonly worker = new ArtifactWorker();
  private readonly clients = new Map<Worker, ArtifactStoreEndpoint>();
  private failed = false;
  private disposing = false;
  private resolveClosed!: () => void;
  private readonly closed = new Promise<void>(resolve => {
    this.resolveClosed = resolve;
  });

  constructor() {
    this.worker.onmessage = ({data}) => {
      if (data.kind === 'disposed') {
        this.worker.terminate();
        this.resolveClosed();
      }
    };
    this.worker.onerror = () => {
      this.failed = true;
      for (const worker of this.clients.keys()) {
        worker.postMessage({
          kind: 'artifact-store',
        } satisfies ArtifactStoreInitialization);
        this.disconnect(worker);
      }
      this.worker.terminate();
      this.resolveClosed();
    };
  }

  connect(worker: Worker): void {
    if (this.failed || this.disposing) {
      worker.postMessage({
        kind: 'artifact-store',
      } satisfies ArtifactStoreInitialization);
      return;
    }
    const {port1, port2} = new MessageChannel();
    const endpoint: ArtifactStoreEndpoint = {
      port: port2,
      mailbox: new SharedArrayBuffer(
        artifactMailboxHeaderBytes + artifactMailboxBytes,
      ),
      accounting: new SharedArrayBuffer(artifactAccountingBytes),
    };
    this.clients.set(worker, endpoint);
    this.worker.postMessage(
      {kind: 'connect', endpoint: {...endpoint, port: port1}},
      [port1],
    );
    worker.postMessage(
      {kind: 'artifact-store', endpoint} satisfies ArtifactStoreInitialization,
      [port2],
    );
  }

  disconnect(worker: Worker): void {
    const endpoint = this.clients.get(worker);
    if (!endpoint) return;
    this.clients.delete(worker);
    Atomics.store(
      new BigInt64Array(endpoint.accounting),
      artifactAccounting.closed,
      1n,
    );
    const state = new Int32Array(endpoint.mailbox, 0, 4);
    Atomics.store(state, 0, artifactReply.failed);
    Atomics.notify(state, 0);
    this.worker.postMessage({kind: 'disconnect'});
  }

  dispose(): Promise<void> {
    if (this.disposing || this.failed) return this.closed;
    this.disposing = true;
    for (const worker of this.clients.keys()) this.disconnect(worker);
    // The I/O worker closes itself only after accepted writes have drained.
    this.worker.postMessage({kind: 'dispose'});
    return this.closed;
  }
}
