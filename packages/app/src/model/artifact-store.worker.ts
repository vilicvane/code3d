/// <reference lib="webworker" />
/// <reference lib="es2024.sharedmemory" />

import {
  artifactMailboxHeaderBytes,
  artifactReply,
  artifactRequestTimeout,
  packArtifactValues,
  type ArtifactStoreRequest,
} from './artifact-store-protocol';
import {withPersistentArtifacts} from './persistent-artifacts';

const scope = self as DedicatedWorkerGlobalScope;
let queue = Promise.resolve();
scope.onmessage = ({data}: MessageEvent<{port: MessagePort}>) => {
  data.port.onmessage = ({data}: MessageEvent<ArtifactStoreRequest>) => {
    queue = queue.then(() => respond(data)).catch(() => {});
  };
  scope.postMessage({kind: 'ready'});
};

async function respond(request: ArtifactStoreRequest): Promise<void> {
  const state = new Int32Array(request.mailbox, 0, 4);
  const buffer = new Uint8Array(request.mailbox, artifactMailboxHeaderBytes);
  try {
    let stats;
    // Ownership ends before sending the result. No model work runs under this lock.
    const result = await withPersistentArtifacts(
      request.namespace,
      async store => {
        if (!store) return;
        const operation = request.operation;
        switch (operation.kind) {
          case 'get-many':
            return packArtifactValues(store.getMany(operation.ids));
          case 'get':
            return store.get(operation.id);
          case 'set':
            store.set(operation.id, operation.bytes);
            return true;
          case 'touch':
            return store.touch(operation.id);
          case 'touch-many':
            return Uint8Array.from(store.touchMany(operation.ids), present =>
              present ? 1 : 0,
            );
          case 'delete':
            store.delete(operation.id);
            return true;
          case 'flush':
            store.flush();
            return true;
          case 'stats':
            return;
          case 'publish': {
            const previous = store.get(operation.id);
            if (
              previous &&
              JSON.parse(new TextDecoder().decode(previous)).stamp >
                operation.stamp
            )
              return false;
            if (!operation.required.every(id => store.touch(id))) return false;
            store.set(operation.id, operation.bytes);
            return true;
          }
        }
      },
      value => {
        stats = value;
      },
      {touchReads: false},
    );
    const bytes =
      request.operation.kind === 'stats'
        ? new TextEncoder().encode(JSON.stringify(stats ?? null))
        : result instanceof Uint8Array
          ? result
          : undefined;
    Atomics.store(state, 2, bytes?.byteLength ?? 0);
    Atomics.store(state, 3, bytes ? 1 : result ? 1 : 0);
    if (bytes) {
      for (
        let offset = 0;
        offset < bytes.byteLength;
        offset += buffer.byteLength
      ) {
        const chunk = bytes.subarray(offset, offset + buffer.byteLength);
        buffer.set(chunk);
        Atomics.store(state, 1, chunk.byteLength);
        Atomics.store(state, 0, artifactReply.chunk);
        Atomics.notify(state, 0);
        const wait = Atomics.waitAsync(
          state,
          0,
          artifactReply.chunk,
          artifactRequestTimeout,
        );
        if ((await wait.value) === 'timed-out') return;
      }
    }
    Atomics.store(state, 0, artifactReply.done);
  } catch {
    Atomics.store(state, 0, artifactReply.failed);
  }
  Atomics.notify(state, 0);
}
