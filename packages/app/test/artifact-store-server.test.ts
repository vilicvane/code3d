import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {ArtifactStoreServer as StoreServer} from '../src/model/artifact-store-server.ts';
import {createAppTestServer} from './vite-test-server.ts';
let app: Awaited<ReturnType<typeof createAppTestServer>>;
let ArtifactStoreServer: typeof import('../src/model/artifact-store-server.ts').ArtifactStoreServer;
before(async () => {
  app = await createAppTestServer();
  ({ArtifactStoreServer} = await app.ssrLoadModule<
    typeof import('../src/model/artifact-store-server.ts')
  >('/src/model/artifact-store-server.ts'));
});
after(async () => app?.close());
import {unpackArtifactValues} from '../src/model/artifact-store-protocol.ts';
import type {
  withPersistentArtifacts,
  PersistentArtifactStore,
} from '../src/model/persistent-artifacts.ts';

function fixture() {
  const data = new Map<string, Uint8Array>();
  let transactions = 0;
  let unavailable = false;
  let gate: Promise<void> = Promise.resolve();
  const scope = (namespace: string): PersistentArtifactStore => {
    const key = (id: string) => namespace + ':' + id;
    return {
      get: id => data.get(key(id)),
      getMany: ids => ids.map(id => data.get(key(id))),
      has: id => data.has(key(id)),
      set: (id, bytes) => {
        data.set(key(id), bytes);
      },
      touch: id => data.has(key(id)),
      touchMany: ids => ids.map(id => data.has(key(id))),
      delete: id => {
        data.delete(key(id));
      },
      clear: () => {
        for (const id of data.keys())
          if (id.startsWith(namespace + ':')) data.delete(id);
      },
      flush: () => {},
    };
  };
  const transaction: typeof withPersistentArtifacts = async (action, stats) => {
    transactions++;
    await gate;
    const result = await action(namespace =>
      unavailable ? undefined : scope(namespace),
    );
    stats(undefined);
    return result;
  };
  const server = new ArtifactStoreServer(transaction);
  return {
    server,
    data,
    get transactions() {
      return transactions;
    },
    unavailable() {
      unavailable = true;
    },
    block() {
      let release!: () => void;
      gate = new Promise<void>(resolve => {
        release = resolve;
      });
      return release;
    },
  };
}
const bytes = (...values: number[]) => new Uint8Array(values);
const set = (
  server: StoreServer,
  id: string,
  value = bytes(1),
  complete = () => {},
) => server.enqueue('model', {kind: 'set', id, bytes: value}, complete);

test('pending reads and touches finish while disk is blocked, without imposing a queue byte quota', async () => {
  const f = fixture();
  const release = f.block();
  let completed = 0;
  set(f.server, 'shape', bytes(1, 2, 3), () => completed++);
  const writing = f.server.drain();
  set(f.server, 'empty', bytes());
  assert.deepEqual(
    await f.server.request('model', {kind: 'get', id: 'shape'}),
    bytes(1, 2, 3),
  );
  const result = await f.server.request('model', {
    kind: 'get-many',
    ids: ['shape', 'empty'],
  });
  assert.deepEqual(unpackArtifactValues(result as Uint8Array), [
    bytes(1, 2, 3),
    bytes(),
  ]);
  assert.equal(
    await f.server.request('model', {kind: 'touch', id: 'shape'}),
    true,
  );
  assert.equal(completed, 0);
  assert.equal(f.server.stats.pendingBytes, 3);
  release();
  await writing;
  assert.equal(completed, 1);
  assert.equal(f.server.stats.pendingBytes, 0);
  assert.equal(f.server.stats.pendingOperations, 0);
});

test('writes share transactions across namespaces and preserve last-write/delete order', async () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) set(f.server, String(i));
  f.server.enqueue(
    'resources',
    {kind: 'set', id: 'font', bytes: bytes(8)},
    () => {},
  );
  set(f.server, 'x', bytes(1));
  f.server.enqueue('model', {kind: 'delete', id: 'x'}, () => {});
  assert.equal(
    await f.server.request('model', {kind: 'get', id: 'x'}),
    undefined,
  );
  set(f.server, 'x', bytes(2));
  await f.server.drain();
  assert.equal(f.transactions, 1);
  assert.deepEqual(f.data.get('model:x'), bytes(2));
  assert.deepEqual(f.data.get('resources:font'), bytes(8));
});

test('publication validates complete records and cannot overwrite a newer persisted pointer', async () => {
  const f = fixture();
  const publish = (stamp: number, required = ['shape']) =>
    f.server.enqueue(
      'model',
      {
        kind: 'publish',
        id: 'latest',
        stamp,
        required,
        bytes: new TextEncoder().encode(
          JSON.stringify({stamp, artifact: String(stamp)}),
        ),
      },
      () => {},
    );
  set(f.server, 'shape');
  publish(20);
  publish(10);
  await f.server.drain();
  assert.equal(
    JSON.parse(new TextDecoder().decode(f.data.get('model:latest'))).stamp,
    20,
  );
  publish(30, ['missing']);
  await f.server.drain();
  assert.equal(
    JSON.parse(new TextDecoder().decode(f.data.get('model:latest'))).stamp,
    20,
  );
});

test('unavailable persistence releases encoded buffers; clear drains older writes before removing the namespace', async () => {
  const f = fixture();
  set(f.server, 'shape');
  f.server.enqueue(
    'resources',
    {kind: 'set', id: 'font', bytes: bytes(2)},
    () => {},
  );
  assert.equal(await f.server.request('model', {kind: 'clear'}), true);
  assert.equal(f.data.has('model:shape'), false);
  assert.equal(f.data.has('resources:font'), true);
  f.unavailable();
  let complete = false;
  set(f.server, 'other', bytes(8, 9), () => {
    complete = true;
  });
  await f.server.drain();
  assert.equal(complete, true);
  assert.equal(f.server.stats.pendingBytes, 0);
});

test('transaction-open failures release the whole accepted queue without retrying indefinitely', async () => {
  const server = new ArtifactStoreServer(async () => {
    throw new Error('Disk denied');
  });
  let released = 0;
  for (let i = 0; i < 300; i++)
    set(server, String(i), bytes(1), () => released++);
  await server.drain();
  assert.equal(released, 300);
  assert.equal(server.stats.pendingBytes, 0);
  assert.equal(server.stats.pendingOperations, 0);
  assert.equal(server.stats.errors, 3);
});
