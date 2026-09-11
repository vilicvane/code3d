import {
  artifactAccounting,
  artifactAccountingBytes,
  artifactMailboxBytes,
  artifactMailboxHeaderBytes,
  artifactReadControl,
  type ArtifactStoreEndpoint,
  type ArtifactStoreInitialization,
} from './artifact-store-protocol';
import ArtifactWorker from './artifact-store.worker?worker';

/** Project-owned I/O survives replacement of compiler/executor Workers. */
export class ArtifactStoreHost {
  private readonly worker = new ArtifactWorker();
  private readonly clients = new Map<Worker, ArtifactStoreEndpoint>();
  private nextClient = 0;
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
      id: ++this.nextClient,
      control: new SharedArrayBuffer(8),
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

  cancelReads(worker: Worker): void {
    const endpoint = this.clients.get(worker);
    if (!endpoint) return;
    const control = new Int32Array(endpoint.control);
    Atomics.add(control, artifactReadControl.generation, 1);
    Atomics.add(control, artifactReadControl.wake, 1);
    Atomics.notify(control, artifactReadControl.wake);
    this.worker.postMessage({kind: 'cancel-reads', id: endpoint.id});
  }

  disconnect(worker: Worker): void {
    const endpoint = this.clients.get(worker);
    if (!endpoint) return;
    this.cancelReads(worker);
    this.clients.delete(worker);
    Atomics.store(
      new BigInt64Array(endpoint.accounting),
      artifactAccounting.closed,
      1n,
    );
    const control = new Int32Array(endpoint.control);
    Atomics.add(control, artifactReadControl.wake, 1);
    Atomics.notify(control, artifactReadControl.wake);
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
