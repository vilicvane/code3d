import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import type {ArtifactFile} from '../src/model/artifact-journal.ts';
import {createAppTestServer} from './vite-test-server.ts';
let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ArtifactJournal: typeof import('../src/model/artifact-journal.ts').ArtifactJournal;
before(async () => {
  server = await createAppTestServer();
  ({ArtifactJournal} = await server.ssrLoadModule<
    typeof import('../src/model/artifact-journal.ts')
  >('/src/model/artifact-journal.ts'));
});
after(async () => server?.close());

class MemoryFile implements ArtifactFile {
  bytes = new Uint8Array();
  durable = new Uint8Array();
  reads: number[] = [];
  fault?: () => void;
  getSize() {
    return this.bytes.length;
  }
  read(bytes: Uint8Array, {at}: {at: number}) {
    this.reads.push(bytes.length);
    const source = this.bytes.subarray(at, at + bytes.length);
    bytes.set(source);
    return source.length;
  }
  write(bytes: Uint8Array, {at}: {at: number}) {
    this.fault?.();
    if (at + bytes.length > this.bytes.length) this.resize(at + bytes.length);
    this.bytes.set(bytes, at);
    return bytes.length;
  }
  truncate(size: number) {
    this.fault?.();
    this.resize(size);
  }
  flush() {
    this.fault?.();
    this.durable = this.bytes.slice();
  }
  crash() {
    this.bytes = this.durable.slice();
    this.fault = undefined;
  }
  private resize(size: number) {
    const bytes = new Uint8Array(size);
    bytes.set(this.bytes.subarray(0, size));
    this.bytes = bytes;
  }
}
const files = (): [MemoryFile, MemoryFile] => [
  new MemoryFile(),
  new MemoryFile(),
];
const value = (number: number, size = 500) => new Uint8Array(size).fill(number);

test('scans bounded header windows and lazily restores exact artifact bytes', () => {
  const disk = files();
  let journal = new ArtifactJournal(disk, 16 * 1024 * 1024);
  for (let i = 0; i < 12; i++) journal.set(String(i), value(i, 500_000));
  journal.flush();
  disk.forEach(file => {
    file.crash();
    file.reads = [];
  });
  journal = new ArtifactJournal(disk, 16 * 1024 * 1024);
  assert.ok(disk.every(file => file.reads.every(size => size <= 64 * 1024)));
  assert.ok(
    disk.reduce(
      (sum, file) => sum + file.reads.reduce((total, size) => total + size, 0),
      0,
    ) <
      journal.stats().diskBytes / 2,
  );
  assert.deepEqual(journal.get('7'), value(7, 500_000));
  assert.equal(journal.stats().entries, 12);
});

test('unchanged evaluations reuse the metadata index without growing the journal', () => {
  const disk = files();
  let journal = new ArtifactJournal(disk, 8192);
  for (let i = 0; i < 6; i++) journal.set(String(i), value(i));
  journal.flush();
  const size = journal.stats().diskBytes;
  for (let iteration = 0; iteration < 20; iteration++) {
    disk.forEach(file => {
      file.reads = [];
    });
    journal = new ArtifactJournal(disk, 8192, journal.index());
    assert.ok(disk.every(file => file.reads.every(size => size === 24)));
    for (let i = 0; i < 6; i++) journal.touch(String(i));
    journal.flush();
    assert.equal(journal.stats().diskBytes, size);
  }
  const previous = journal.index();
  const other = new ArtifactJournal(disk, 8192);
  other.set('other-worker', value(99));
  other.flush();
  journal = new ArtifactJournal(disk, 8192, previous);
  assert.deepEqual(journal.get('other-worker'), value(99));
});

test('disk LRU retains recently reused history across compaction and reopening', () => {
  const disk = files();
  let journal = new ArtifactJournal(disk, 8192);
  for (let i = 0; i < 6; i++) journal.set(String(i), value(i));
  journal.get('0');
  journal.flush();
  journal = new ArtifactJournal(disk, 8192);
  journal.set('6', value(6));
  journal.set('7', value(7));
  journal.flush();
  assert.deepEqual(journal.get('0'), value(0));
  assert.equal(journal.get('1'), undefined);
  assert.deepEqual(journal.get('7'), value(7));
  assert.ok(journal.stats().diskBytes <= 8192);
  assert.equal(disk.filter(file => file.getSize() > 0).length, 1);
});

test('torn append and compaction never lose the previously durable recent artifact', () => {
  for (let stop = 1; stop <= 60; stop++) {
    const disk = files();
    let journal = new ArtifactJournal(disk, 8192);
    for (let i = 0; i < 6; i++) journal.set(String(i), value(i));
    journal.get('0');
    journal.flush();
    let operations = 0;
    disk.forEach(file => {
      file.fault = () => {
        if (++operations === stop) throw new Error('Worker terminated');
      };
    });
    try {
      journal.set('6', value(6));
      journal.set('7', value(7));
      journal.flush();
    } catch {}
    disk.forEach(file => file.crash());
    journal = new ArtifactJournal(disk, 8192);
    assert.deepEqual(journal.get('0'), value(0), `fault at operation ${stop}`);
    journal.set('recovery', value(42));
    journal.flush();
    assert.deepEqual(
      new ArtifactJournal(disk, 8192).get('recovery'),
      value(42),
    );
  }
});

test('corrupt payload becomes a miss without discarding unrelated records', () => {
  const disk = files();
  let journal = new ArtifactJournal(disk, 8192);
  journal.set('bad', value(1));
  journal.set('good', value(2));
  journal.flush();
  const active = disk.find(file => file.getSize() > 0)!;
  active.bytes[200] ^= 1;
  journal = new ArtifactJournal(disk, 8192);
  assert.equal(journal.get('bad'), undefined);
  assert.deepEqual(journal.get('good'), value(2));
  assert.equal(journal.stats().corruptRecords, 1);
  journal.set('bad', value(3));
  journal.flush();
  assert.deepEqual(new ArtifactJournal(disk, 8192).get('bad'), value(3));
});

test('a short batch write discards its incomplete tail and cannot reuse a stale index', () => {
  for (const cutoff of [1, 10, 50, 100, 500, 800]) {
    const disk = files();
    let journal = new ArtifactJournal(disk, 8192);
    journal.set('durable', value(1));
    journal.flush();
    const active = disk.find(file => file.getSize() > 0)!;
    const write = active.write.bind(active);
    active.write = (bytes, options) => {
      const written = write(bytes.subarray(0, cutoff), options);
      active.flush();
      return written;
    };
    journal.set('next', value(2));
    journal.set('tail', value(3));
    assert.throws(() => journal.flush(), /Incomplete/);
    assert.equal(journal.index(), undefined);
    active.write = write;
    disk.forEach(file => file.crash());
    journal = new ArtifactJournal(disk, 8192);
    assert.deepEqual(journal.get('durable'), value(1));
    assert.equal(journal.get('tail'), undefined);
    journal.set('tail', value(3));
    journal.flush();
    assert.deepEqual(new ArtifactJournal(disk, 8192).get('tail'), value(3));
  }
});

test('quota failure preserves the previous file and permits retry after space is available', () => {
  const disk = files();
  let journal = new ArtifactJournal(disk, 8192);
  journal.set('old', value(1));
  journal.flush();
  disk.forEach(file => {
    file.fault = () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
  });
  assert.throws(
    () => {
      journal.set('new', value(2));
      journal.flush();
    },
    {
      name: 'QuotaExceededError',
    },
  );
  disk.forEach(file => file.crash());
  journal = new ArtifactJournal(disk, 8192);
  assert.deepEqual(journal.get('old'), value(1));
  journal.set('new', value(2));
  journal.flush();
  assert.deepEqual(new ArtifactJournal(disk, 8192).get('new'), value(2));
});
