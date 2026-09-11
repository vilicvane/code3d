import type {KernelArtifactStore} from '@code3d/core/tooling';

/** The small synchronous surface shared by OPFS and fault-injection tests. */
export interface ArtifactFile {
  getSize(): number;
  read(bytes: Uint8Array, options: {at: number}): number;
  write(bytes: Uint8Array, options: {at: number}): number;
  truncate(size: number): void;
  flush(): void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});
const magic = encoder.encode('C3DCACHE');
const fileHeaderSize = 24;
const recordHeaderSize = 16;
const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function checksum(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

type RecordMetadata = {id: string; kind: 'value' | 'touch' | 'delete'};
type Entry = {
  offset: number;
  length: number;
  checksum: number;
  recordBytes: number;
};

type JournalIndex = {
  active: number;
  generation: number;
  end: number;
  liveBytes: number;
  recordCount: number;
  entries: ReadonlyMap<string, Entry>;
};

/**
 * Two append-only generations, one current format. Opening scans record headers
 * in bounded windows, never loading the artifact history into memory. A compaction publishes its
 * generation header only after all copied records are flushed; the previous
 * file stays intact until then. Physical bytes, including compaction headroom,
 * are bounded by maximumBytes (each generation gets half).
 */
export class ArtifactJournal implements KernelArtifactStore {
  private active = 0;
  private generation = 0;
  private end = fileHeaderSize;
  private liveBytes = 0;
  private entries = new Map<string, Entry>();
  private readonly touched = new Set<string>();
  private lastFlush = performance.now();
  private unflushedBytes = 0;
  private readonly capacity: number;
  private corruptRecords = 0;
  private recordCount = 0;
  private durableOrder: string[] = [];
  private pendingFile?: ArtifactFile;
  private pendingStart = 0;
  private pendingBytes = 0;
  private pendingRecords: Uint8Array[] = [];
  private writeFailed = false;

  constructor(
    private readonly files: readonly [ArtifactFile, ArtifactFile],
    readonly maximumBytes: number,
    previous?: JournalIndex,
  ) {
    this.capacity = Math.floor(maximumBytes / 2);
    const generations = files.map(file => this.readGeneration(file));
    this.active = generations[1] > generations[0] ? 1 : 0;
    this.generation = Math.max(...generations);
    if (this.generation < 0) {
      this.generation = 0;
      files[0].truncate(0);
      this.publish(files[0], this.generation);
    } else if (
      previous &&
      previous.active === this.active &&
      previous.generation === this.generation &&
      previous.end === files[this.active].getSize()
    ) {
      this.end = previous.end;
      this.entries = new Map(previous.entries);
      this.liveBytes = previous.liveBytes;
      this.recordCount = previous.recordCount;
    } else {
      this.scan();
    }
    // The active generation is durable before reclaiming an interrupted copy.
    if (files[1 - this.active].getSize()) {
      files[1 - this.active].truncate(0);
      files[1 - this.active].flush();
    }
    if (this.end > this.capacity) this.compact(0);
    this.durableOrder = [...this.entries.keys()];
  }

  get(id: string, touch = true): Uint8Array | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const bytes = this.readValue(entry);
    if (!bytes) {
      this.delete(id);
      return undefined;
    }
    if (touch) this.touch(id);
    return bytes;
  }

  getMany(
    ids: readonly string[],
    touch = true,
  ): readonly (Uint8Array | undefined)[] {
    return ids.map(id => this.get(id, touch));
  }

  set(id: string, bytes: Uint8Array): void {
    const metadata: RecordMetadata = {id, kind: 'value'};
    const size =
      recordHeaderSize +
      encoder.encode(JSON.stringify(metadata)).length +
      bytes.length;
    // An oversized artifact is still useful in the independent memory cache.
    if (size > this.capacity - fileHeaderSize) return;
    if (this.end + size > this.capacity) this.compact(size);
    const entry = this.append(metadata, bytes);
    const previous = this.entries.get(id);
    if (previous) this.liveBytes -= previous.recordBytes;
    this.entries.delete(id);
    this.entries.set(id, entry);
    this.liveBytes += entry.recordBytes;
    this.touched.delete(id);
    this.flushPeriodically();
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  touch(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.entries.set(id, entry);
    this.touched.delete(id);
    this.touched.add(id);
    this.flushPeriodically();
    return true;
  }

  touchMany(ids: readonly string[]): readonly boolean[] {
    return ids.map(id => this.touch(id));
  }

  delete(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.touched.delete(id);
    this.liveBytes -= entry.recordBytes;
    if (this.end + 1024 > this.capacity) this.compact(0);
    else this.append({id, kind: 'delete'}, new Uint8Array());
  }

  deletePrefix(prefix: string): void {
    if ([...this.entries.keys()].some(id => id.startsWith(prefix)))
      this.compact(0, prefix);
  }

  flush(): void {
    if (
      this.recordCount + this.touched.size >
      Math.max(16384, this.entries.size * 8)
    )
      this.compact(0);
    // A complete unchanged evaluation usually returns to the same LRU order.
    // Do not append another full set of touch records in that case.
    const order = [...this.entries.keys()];
    if (
      order.length === this.durableOrder.length &&
      order.every((id, index) => id === this.durableOrder[index])
    )
      this.touched.clear();
    // Touches preserve edit/undo history across restarts without rewriting BREP.
    for (const id of this.touched) {
      if (this.end + 1024 > this.capacity) {
        this.compact(0);
        break;
      }
      this.append({id, kind: 'touch'}, new Uint8Array());
    }
    this.touched.clear();
    if (!this.unflushedBytes) return;
    this.flushData();
    this.files[this.active].flush();
    this.durableOrder = [...this.entries.keys()];
    this.lastFlush = performance.now();
    this.unflushedBytes = 0;
  }

  stats() {
    return {
      entries: this.entries.size,
      liveBytes: this.liveBytes,
      diskBytes: this.files.reduce((sum, file) => sum + file.getSize(), 0),
      maximumBytes: this.maximumBytes,
      corruptRecords: this.corruptRecords,
    };
  }

  /** Retain only metadata between compiles; a changed file generation/size rescans. */
  index(): JournalIndex | undefined {
    if (this.writeFailed) return undefined;
    return {
      active: this.active,
      generation: this.generation,
      end: this.end,
      liveBytes: this.liveBytes,
      recordCount: this.recordCount,
      entries: new Map(this.entries),
    };
  }

  private flushPeriodically(): void {
    if (
      this.unflushedBytes >= 4 * 1024 ** 2 ||
      performance.now() - this.lastFlush >= 250
    )
      this.flush();
  }

  private readGeneration(file: ArtifactFile): number {
    if (file.getSize() < fileHeaderSize) return -1;
    const header = new Uint8Array(fileHeaderSize);
    if (
      file.read(header, {at: 0}) !== header.length ||
      !magic.every((byte, index) => header[index] === byte)
    )
      return -1;
    const view = new DataView(header.buffer);
    const generation = view.getFloat64(8, true);
    return checksum(header.subarray(0, 16)) === view.getUint32(16, true) &&
      Number.isSafeInteger(generation) &&
      generation >= 0
      ? generation
      : -1;
  }

  private publish(file: ArtifactFile, generation: number): void {
    const header = new Uint8Array(fileHeaderSize);
    header.set(magic);
    const view = new DataView(header.buffer);
    view.setFloat64(8, generation, true);
    view.setUint32(16, checksum(header.subarray(0, 16)), true);
    this.write(file, header, 0);
    file.flush();
  }

  private scan(): void {
    const file = this.files[this.active];
    const size = file.getSize();
    let offset = fileHeaderSize;
    let windowStart = 0;
    let window = new Uint8Array();
    const read = (at: number, length: number): Uint8Array | undefined => {
      if (at < windowStart || at + length > windowStart + window.length) {
        windowStart = at;
        window = new Uint8Array(Math.min(64 * 1024, size - at));
        if (file.read(window, {at}) !== window.length) return undefined;
      }
      return window.subarray(at - windowStart, at - windowStart + length);
    };
    while (offset + recordHeaderSize <= size) {
      const header = read(offset, recordHeaderSize);
      if (!header) break;
      const view = new DataView(
        header.buffer,
        header.byteOffset,
        header.byteLength,
      );
      const metadataLength = view.getUint32(0, true);
      const length = view.getUint32(4, true);
      const recordBytes = recordHeaderSize + metadataLength + length;
      if (
        !metadataLength ||
        metadataLength > 1024 ||
        offset + recordBytes > size
      )
        break;
      const bytes = read(offset + recordHeaderSize, metadataLength);
      if (!bytes || checksum(bytes) !== view.getUint32(8, true)) break;
      let metadata: RecordMetadata;
      try {
        metadata = JSON.parse(decoder.decode(bytes));
        if (
          typeof metadata.id !== 'string' ||
          !['value', 'touch', 'delete'].includes(metadata.kind) ||
          (metadata.kind !== 'value' && length !== 0)
        )
          break;
      } catch {
        break;
      }
      const previous = this.entries.get(metadata.id);
      this.entries.delete(metadata.id);
      if (metadata.kind === 'value') {
        if (previous) this.liveBytes -= previous.recordBytes;
        this.entries.set(metadata.id, {
          offset: offset + recordHeaderSize + metadataLength,
          length,
          checksum: view.getUint32(12, true),
          recordBytes,
        });
        this.liveBytes += recordBytes;
      } else if (metadata.kind === 'touch' && previous) {
        this.entries.set(metadata.id, previous);
      } else if (previous) {
        this.liveBytes -= previous.recordBytes;
      }
      offset += recordBytes;
      this.recordCount++;
    }
    this.end = offset;
    // A killed writer can leave an unpublished header or truncated tail.
    if (offset !== size) file.truncate(offset);
  }

  private readValue(entry: Entry): Uint8Array | undefined {
    if (
      this.pendingFile === this.files[this.active] &&
      entry.offset + entry.length > this.pendingStart
    )
      this.flushData();
    const bytes = new Uint8Array(entry.length);
    if (
      this.files[this.active].read(bytes, {at: entry.offset}) !==
        bytes.length ||
      checksum(bytes) !== entry.checksum
    ) {
      this.corruptRecords++;
      return undefined;
    }
    return bytes;
  }

  private append(
    metadata: RecordMetadata,
    bytes: Uint8Array,
    file = this.files[this.active],
  ): Entry {
    const encoded = encoder.encode(JSON.stringify(metadata));
    const header = new Uint8Array(recordHeaderSize);
    const view = new DataView(header.buffer);
    view.setUint32(0, encoded.length, true);
    view.setUint32(4, bytes.length, true);
    view.setUint32(8, checksum(encoded), true);
    const crc = checksum(bytes);
    view.setUint32(12, crc, true);
    const offset = this.end + recordHeaderSize + encoded.length;
    const recordBytes = recordHeaderSize + encoded.length + bytes.length;
    const record = new Uint8Array(recordBytes);
    record.set(header);
    record.set(encoded, recordHeaderSize);
    record.set(bytes, recordHeaderSize + encoded.length);
    if (!this.pendingRecords.length) {
      this.pendingStart = this.end;
      this.pendingFile = file;
    }
    this.pendingRecords.push(record);
    this.pendingBytes += recordBytes;
    this.end += recordBytes;
    this.recordCount++;
    this.unflushedBytes += recordBytes;
    if (this.pendingBytes >= 4 * 1024 ** 2) this.flushData();
    return {offset, length: bytes.length, checksum: crc, recordBytes};
  }

  private compact(incomingBytes: number, removedPrefix?: string): void {
    this.flushData();
    this.files[this.active].flush();
    const target = this.files[1 - this.active];
    const keep = new Map(this.entries);
    let live = this.liveBytes;
    if (removedPrefix !== undefined) {
      for (const [id, entry] of keep) {
        if (!id.startsWith(removedPrefix)) continue;
        keep.delete(id);
        live -= entry.recordBytes;
      }
    }
    const targetBytes = Math.max(
      0,
      Math.floor(
        (this.capacity - fileHeaderSize - incomingBytes) *
          (removedPrefix === undefined ? 0.8 : 1),
      ),
    );
    for (const [id, entry] of keep) {
      if (live <= targetBytes) break;
      keep.delete(id);
      live -= entry.recordBytes;
    }
    target.truncate(0);
    // An unpublished generation can never supersede the current durable file.
    this.write(target, new Uint8Array(fileHeaderSize), 0);
    const previousEnd = this.end;
    const previousCount = this.recordCount;
    this.end = fileHeaderSize;
    this.recordCount = 0;
    const next = new Map<string, Entry>();
    let nextBytes = 0;
    try {
      for (const [id, entry] of keep) {
        const bytes = this.readValue(entry);
        if (!bytes) continue;
        const copied = this.append({id, kind: 'value'}, bytes, target);
        next.set(id, copied);
        nextBytes += copied.recordBytes;
      }
      this.flushData();
      target.flush();
      this.publish(target, this.generation + 1);
    } catch (error) {
      this.end = previousEnd;
      this.recordCount = previousCount;
      this.pendingRecords = [];
      this.pendingBytes = 0;
      this.pendingFile = undefined;
      throw error;
    }
    this.active = 1 - this.active;
    this.generation++;
    this.entries = next;
    this.liveBytes = nextBytes;
    this.touched.clear();
    this.durableOrder = [...this.entries.keys()];
    this.files[1 - this.active].truncate(0);
    this.files[1 - this.active].flush();
    this.unflushedBytes = 0;
    this.lastFlush = performance.now();
  }

  private write(file: ArtifactFile, bytes: Uint8Array, at: number): void {
    try {
      if (file.write(bytes, {at}) !== bytes.length)
        throw new Error('Incomplete artifact cache write');
    } catch (error) {
      this.writeFailed = true;
      throw error;
    }
  }

  private flushData(): void {
    if (!this.pendingRecords.length) return;
    const bytes = new Uint8Array(this.pendingBytes);
    let offset = 0;
    for (const record of this.pendingRecords) {
      bytes.set(record, offset);
      offset += record.length;
    }
    // One contiguous append avoids thousands of synchronous OPFS IPCs. Length
    // and CRC checks reject a torn final record after a terminated write.
    this.write(this.pendingFile!, bytes, this.pendingStart);
    this.pendingRecords = [];
    this.pendingBytes = 0;
    this.pendingFile = undefined;
  }
}
