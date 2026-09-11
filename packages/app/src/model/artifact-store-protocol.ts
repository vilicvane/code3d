export type ArtifactOperation =
  | Readonly<{kind: 'get' | 'touch' | 'delete'; id: string}>
  | Readonly<{kind: 'set'; id: string; bytes: Uint8Array}>
  | Readonly<{kind: 'flush' | 'stats' | 'clear' | 'drain'}>
  | Readonly<{kind: 'get-many' | 'touch-many'; ids: readonly string[]}>
  | Readonly<{
      kind: 'publish';
      id: string;
      stamp: number;
      bytes: Uint8Array;
      required: readonly string[];
    }>;

export type ArtifactStoreRequest = Readonly<{
  namespace: string;
  operation: ArtifactOperation;
}> &
  (
    | {reply: true; id: number; generation?: number; mailbox: SharedArrayBuffer}
    | {reply: false; sequence: number}
  );

export type ArtifactStoreEndpoint = Readonly<{
  id: number;
  control: SharedArrayBuffer;
  port: MessagePort;
  mailbox: SharedArrayBuffer;
  accounting: SharedArrayBuffer;
}>;

export type ArtifactStoreInitialization = Readonly<{
  kind: 'artifact-store';
  endpoint?: ArtifactStoreEndpoint;
}>;

// Atomics keep accounting accurate while the model Worker is running synchronous JS/WASM.
export const artifactAccounting = {
  bytes: 0,
  operations: 1,
  closed: 2,
  posted: 3,
} as const;
export const artifactAccountingBytes = 4 * BigInt64Array.BYTES_PER_ELEMENT;

export function artifactOperationBytes(operation: ArtifactOperation): number {
  return 'bytes' in operation ? operation.bytes.byteLength : 0;
}

// Stable cancellation/wakeup state survives retiring a cancelled read mailbox.
export const artifactReadControl = {generation: 0, wake: 1} as const;

// Each client reuses a bounded mailbox, replacing it only when a read is cancelled.
// Large records stream through it; late replies retain their retired mailbox.
export const artifactMailboxBytes = 1024 * 1024;
export const artifactMailboxHeaderBytes = 16;
export const artifactRequestTimeout = 30_000;
export const artifactReply = {
  pending: 0,
  chunk: 1,
  done: 2,
  failed: 3,
} as const;

/** One binary reply preserves missing and empty records without encoding payload bytes. */
export function packArtifactValues(
  values: readonly (Uint8Array | undefined)[],
): Uint8Array {
  const header = 4 * (1 + values.length);
  const bytes = new Uint8Array(
    header + values.reduce((sum, value) => sum + (value?.byteLength ?? 0), 0),
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, values.length, true);
  let offset = header;
  values.forEach((value, index) => {
    view.setUint32(4 * (index + 1), value ? value.byteLength + 1 : 0, true);
    if (value) {
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  });
  return bytes;
}

export function unpackArtifactValues(
  bytes: Uint8Array,
): readonly (Uint8Array | undefined)[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  let offset = 4 * (1 + count);
  return Array.from({length: count}, (_, index) => {
    const size = view.getUint32(4 * (index + 1), true);
    if (!size) return;
    const value = bytes.subarray(offset, offset + size - 1);
    offset += size - 1;
    return value;
  });
}
