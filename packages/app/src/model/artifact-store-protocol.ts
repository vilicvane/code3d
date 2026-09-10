export type ArtifactOperation =
  | Readonly<{kind: 'get' | 'touch' | 'delete'; id: string}>
  | Readonly<{kind: 'set'; id: string; bytes: Uint8Array}>
  | Readonly<{kind: 'flush' | 'stats' | 'clear'}>
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
  mailbox: SharedArrayBuffer;
}>;

// Each client has one bounded mailbox. Large records stream through it.
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
