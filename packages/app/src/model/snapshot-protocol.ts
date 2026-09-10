import type {SnapshotQuery, SnapshotQueryResult} from '@code3d/core/tooling';

export type SnapshotWorkerRequest =
  | {
      kind: 'initialize';
      url: string;
      wasm: Uint8Array;
      sketchWasm: Uint8Array;
      resources: readonly (readonly [string, string])[];
    }
  | {
      kind: 'compute';
      id: string;
      bytes: Uint8Array;
      queries: readonly SnapshotQuery[];
      cancellation: Int32Array<SharedArrayBuffer>;
    };

export type SnapshotWorkerResponse =
  | {kind: 'ready'; nativeBytes: number}
  | {kind: 'loaded'; id: string; restoreMs: number; nativeBytes: number}
  | {
      kind: 'result';
      id: string;
      key: string;
      value: SnapshotQueryResult;
      milliseconds: number;
      nativeBytes: number;
    }
  | {kind: 'done'; id: string; milliseconds: number; nativeBytes: number}
  | {kind: 'error'; id?: string; message: string; nativeBytes: number};
