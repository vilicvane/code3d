import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium, type Browser} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';

let browser: Browser;
before(async () => {
  assert.ok(process.env.CODE3D_TEST_URL);
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

test(
  'background writes/read-your-writes survive an executor termination while OPFS is locked',
  {timeout: 30_000},
  async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL('/__artifact-store-test__', process.env.CODE3D_TEST_URL)
      .href;
    await context.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main>Artifact store</main>',
      }),
    );
    await page.goto(url);
    const result = await page.evaluate(async () => {
      const {ArtifactStoreHost} =
        await import('/src/model/artifact-store-host.ts');
      const {default: Client} =
        await import('/test/browser/artifact-store-client.worker.ts?worker');
      const storage = new ArtifactStoreHost();
      let worker = new Client();
      storage.connect(worker);
      const request = (data: unknown) =>
        new Promise<any>((resolve, reject) => {
          worker.onmessage = ({data}) => resolve(data);
          worker.onerror = event => reject(new Error(event.message));
          worker.postMessage(data);
        });
      const namespace = 'async-test:' + crypto.randomUUID();
      const command = (operation: unknown) =>
        request({kind: 'command', namespace, operation});
      let release!: () => void;
      let acquired!: () => void;
      const ready = new Promise<void>(resolve => {
        acquired = resolve;
      });
      const held = navigator.locks.request(
        'code3d-kernel-artifacts',
        async () => {
          acquired();
          await new Promise<void>(resolve => {
            release = resolve;
          });
        },
      );
      await ready;
      try {
        const written = await request({
          kind: 'write',
          namespace,
          count: 64,
          size: 256 * 1024,
        });
        worker.terminate();
        storage.disconnect(worker);
        worker = new Client();
        storage.connect(worker);
        const pending = await command({kind: 'get', id: '63'});
        release();
        await held;
        await command({kind: 'drain'});
        const stats = await command({kind: 'stats'});
        worker.terminate();
        storage.disconnect(worker);
        storage.dispose();
        const fresh = new ArtifactStoreHost();
        worker = new Client();
        fresh.connect(worker);
        try {
          const restored = await command({kind: 'get', id: '63'});
          return {written, pending, restored, stats};
        } finally {
          worker.terminate();
          fresh.disconnect(worker);
          fresh.dispose();
        }
      } finally {
        release();
        worker.terminate();
        storage.disconnect(worker);
        storage.dispose();
      }
    });
    assert.equal(result.written.value.pendingBytes, 16 * 1024 ** 2);
    assert.equal(
      result.written.value.first,
      0,
      'transferred writes must not detach or alias the original input',
    );
    assert.equal(result.written.value.last, 63);
    assert.ok(result.written.milliseconds < 2000, JSON.stringify(result));
    assert.equal(result.pending.value.first, 63);
    assert.ok(result.pending.milliseconds < 2000);
    assert.equal(result.restored.value.first, 63);
    assert.equal(result.stats.value.pendingBytes, 0);
    assert.equal(result.stats.value.errors, 0);
    assert.ok(
      result.stats.value.batches < 16,
      JSON.stringify(result.stats.value),
    );
    t.diagnostic(JSON.stringify(result));
  },
);

test(
  'project shutdown drains accepted writes and cross-host publication keeps the newest complete pointer',
  {timeout: 30_000},
  async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL(
      '/__artifact-publication-test__',
      process.env.CODE3D_TEST_URL,
    ).href;
    await context.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main>Publication</main>',
      }),
    );
    await page.goto(url);
    const result = await page.evaluate(async () => {
      const {ArtifactStoreHost} =
        await import('/src/model/artifact-store-host.ts');
      const {default: Client} =
        await import('/test/browser/artifact-store-client.worker.ts?worker');
      const namespace = 'publication-test:' + crypto.randomUUID();
      const connect = (host = new ArtifactStoreHost()) => {
        const worker = new Client();
        host.connect(worker);
        const send = (message: unknown) =>
          new Promise<any>((resolve, reject) => {
            worker.onmessage = ({data}) => resolve(data);
            worker.onerror = event => reject(new Error(event.message));
            worker.postMessage(message);
          });
        return {
          host,
          worker,
          request: (operation: unknown) =>
            send({kind: 'command', namespace, operation}),
          interruptPost: () => send({kind: 'interrupt-post', namespace}),
          close() {
            worker.terminate();
            host.disconnect(worker);
            return host.dispose();
          },
        };
      };
      const publish = (stamp: number, required = ['shape']) => ({
        kind: 'publish',
        id: 'latest',
        stamp,
        required,
        bytes: new TextEncoder().encode(
          JSON.stringify({stamp, artifact: 'shape'}),
        ),
      });
      const a = connect();
      const b = connect();
      try {
        await a.request({kind: 'set', id: 'shape', bytes: new Uint8Array([9])});
        await a.request(publish(20));
        const interrupted = await a.interruptPost();
        await a.close();
        await b.request(publish(10));
        await b.request({kind: 'drain'});
        const newer = await b.request({kind: 'get', id: 'latest'});
        await b.request(publish(30, ['missing']));
        await b.request({kind: 'drain'});
        const complete = await b.request({kind: 'get', id: 'latest'});
        // A new producer clears only after the retired producer's writes drain.
        let release!: () => void;
        let acquired!: () => void;
        const ready = new Promise<void>(resolve => {
          acquired = resolve;
        });
        const held = navigator.locks.request(
          'code3d-kernel-artifacts',
          async () => {
            acquired();
            await new Promise<void>(resolve => {
              release = resolve;
            });
          },
        );
        await ready;
        const old = connect(b.host);
        await old.request({
          kind: 'set',
          id: 'old',
          bytes: new Uint8Array(4 * 1024 ** 2),
        });
        old.worker.terminate();
        old.host.disconnect(old.worker);
        const clearing = b.request({kind: 'clear'});
        release();
        await held;
        await clearing;
        const cleared = await b.request({kind: 'get', id: 'old'});
        return {newer, complete, cleared, interrupted};
      } finally {
        await a.close();
        await b.close();
      }
    });
    assert.equal(JSON.parse(result.newer.value.json).stamp, 20);
    assert.equal(JSON.parse(result.complete.value.json).stamp, 20);
    assert.equal(result.cleared.value, undefined);
    assert.equal(result.interrupted.value, 'interrupted');
  },
);
