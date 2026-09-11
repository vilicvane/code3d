/// <reference lib="webworker" />
import {artifactAccounting} from '../../src/model/artifact-store-protocol';
import {ArtifactStoreConnection} from '../../src/model/artifact-store';
import type {
  ArtifactStoreInitialization,
  ArtifactOperation,
} from '../../src/model/artifact-store-protocol';
const storage = new ArtifactStoreConnection();
let accounting: BigInt64Array;
const scope = self as DedicatedWorkerGlobalScope;
scope.onmessage = async ({
  data,
}: MessageEvent<
  | ArtifactStoreInitialization
  | {kind: 'command'; namespace: string; operation: ArtifactOperation}
  | {kind: 'write'; namespace: string; count: number; size: number}
  | {kind: 'interrupt-post'; namespace: string}
>) => {
  if (data.kind === 'artifact-store') {
    if (data.endpoint) accounting = new BigInt64Array(data.endpoint.accounting);
    storage.connect(data.endpoint);
    return;
  }
  await storage.ready;
  const store = storage.scope(data.namespace);
  if (data.kind === 'interrupt-post') {
    // Model termination can occur between admission accounting and postMessage.
    Atomics.add(accounting, artifactAccounting.bytes, 1024n);
    Atomics.add(accounting, artifactAccounting.operations, 1n);
    scope.postMessage({value: 'interrupted'});
    return;
  }
  const start = performance.now();
  let value: unknown;
  if (data.kind === 'write') {
    const bytes = new Uint8Array(data.size);
    for (let i = 0; i < data.count; i++) {
      bytes[0] = i;
      store.set(String(i), bytes);
    }
    store.flush();
    value = {
      pendingBytes: storage.pendingBytes,
      first: store.get('0')?.[0],
      last: store.get(String(data.count - 1))?.[0],
    };
  } else {
    const operation = data.operation;
    switch (operation.kind) {
      case 'get': {
        const bytes = store.get(operation.id);
        value = bytes
          ? {
              length: bytes.length,
              first: bytes[0],
              json:
                bytes.length < 1024
                  ? new TextDecoder().decode(bytes)
                  : undefined,
            }
          : undefined;
        break;
      }
      case 'delete':
        store.delete(operation.id);
        break;
      case 'set':
        store.set(operation.id, operation.bytes);
        break;
      case 'drain':
        storage.drain();
        break;
      case 'clear':
        storage.clear(data.namespace);
        break;
      case 'stats':
        value = storage.stats;
        break;
      case 'publish':
        storage.publish(
          data.namespace,
          operation.id,
          JSON.parse(new TextDecoder().decode(operation.bytes)),
          operation.required,
        );
        break;
      default:
        throw new Error('Unsupported fixture operation.');
    }
  }
  scope.postMessage({
    value,
    milliseconds: performance.now() - start,
    pendingBytes: storage.pendingBytes,
  });
};
