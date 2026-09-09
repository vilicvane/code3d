/// <reference lib="webworker" />
import type * as CoreTooling from '@code3d/core/tooling';
import type {
  SnapshotWorkerRequest,
  SnapshotWorkerResponse,
} from './snapshot-protocol';
import {checkCompilationCancellation} from './compilation-cancellation';

const scope = self as DedicatedWorkerGlobalScope;
let tooling: typeof CoreTooling | undefined;
const nativeBytes = () =>
  tooling?.kernelOperationCacheStats().nativeAllocatedBytes ?? 0;
const send = (message: SnapshotWorkerResponse, transfer: Transferable[] = []) =>
  scope.postMessage(message, transfer);

scope.onmessage = async ({data}: MessageEvent<SnapshotWorkerRequest>) => {
  try {
    if (data.kind === 'initialize') {
      const entry = await import(/* @vite-ignore */ data.url);
      tooling = (await entry.default(data.wasm, data.sketchWasm)).tooling;
      send({kind: 'ready', nativeBytes: nativeBytes()});
      return;
    }
    const start = performance.now();
    let previous = start;
    tooling!.executeSnapshotQueryBatch(
      data.id,
      data.bytes,
      data.queries,
      () => checkCompilationCancellation(data.cancellation),
      (query, value) => {
        const now = performance.now();
        const transfer = Object.values(value).flatMap(item =>
          ArrayBuffer.isView(item) ? [item.buffer as ArrayBuffer] : [],
        );
        send(
          {
            kind: 'result',
            id: data.id,
            key: query.key.id,
            value,
            milliseconds: now - previous,
            nativeBytes: nativeBytes(),
          },
          transfer,
        );
        previous = performance.now();
      },
      milliseconds => {
        send({
          kind: 'loaded',
          id: data.id,
          restoreMs: milliseconds,
          nativeBytes: nativeBytes(),
        });
        previous = performance.now();
      },
    );
    send({
      kind: 'done',
      id: data.id,
      milliseconds: performance.now() - start,
      nativeBytes: nativeBytes(),
    });
  } catch (error) {
    send({
      kind: 'error',
      id: data.kind === 'compute' ? data.id : undefined,
      message:
        tooling?.describeOpenCascadeException(error) ??
        (error instanceof Error ? error.message : String(error)),
      nativeBytes: nativeBytes(),
    });
  }
};
