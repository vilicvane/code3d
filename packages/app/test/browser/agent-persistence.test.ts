import {appIsolationHeaders} from '../../build/isolation.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {createAgentConfig} from '@code3d/agent';

for (const legacyVersion of [1, 2])
  for (const blocked of [false, true])
    test(
      `v${legacyVersion} agent storage assigns persistent colors and retains grants/receipts${blocked ? ' after a blocked upgrade' : ''}`,
      {timeout: 30_000},
      async t => {
        assert.ok(process.env.CODE3D_TEST_URL);
        const browser = await chromium.connectOverCDP(
          process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
        );
        t.after(() => browser.close());
        const context = await browser.newContext();
        t.after(() => context.close());
        const page = await context.newPage();
        const url = new URL(
          '/__agent-migration-test__',
          process.env.CODE3D_TEST_URL,
        ).href;
        await page.route(url, route =>
          route.fulfill({
            contentType: 'text/html',
            headers: appIsolationHeaders,
            body: '<main>Agent migration</main>',
          }),
        );
        await page.goto(url);
        const identity = {
          sessionId: crypto.randomUUID(),
          token: 'old-host-token',
        };
        const config = createAgentConfig({
          port: 54321,
          origin: new URL(process.env.CODE3D_TEST_URL!).origin,
          sessionId: identity.sessionId,
          name: 'Euler',
        });
        const result = await page.evaluate(
          async ({identity, config, blocked, legacyVersion}) => {
            const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open('code3d-agents-v1', legacyVersion);
              request.onupgradeneeded = () => {
                request.result.createObjectStore('sessions');
                request.result.createObjectStore('receipts');
              };
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            const session = {
              identity,
              relay: 'http://127.0.0.1:3134',
              grants: [
                {
                  config: {
                    version: 1,
                    relay: 'http://127.0.0.1:3134',
                    sessionId: config.sessionId,
                    agentId: config.agentId,
                    name: config.name,
                    key: config.key,
                  },
                  ...(legacyVersion >= 2 ? {color: 3} : {}),
                  lastSeen: '2026-09-08T12:00:00.000Z',
                },
              ],
            };
            const receipt = {
              requestId: 'r1',
              fingerprint: 'fingerprint',
              response: {ok: true, data: {saved: true}},
            };
            await new Promise<void>((resolve, reject) => {
              const transaction = legacy.transaction(
                ['sessions', 'receipts'],
                'readwrite',
              );
              for (const workspace of ['first', 'second']) {
                transaction.objectStore('sessions').put(session, workspace);
                transaction
                  .objectStore('receipts')
                  .put(receipt, [workspace, config.agentId, 'r1']);
              }
              transaction.oncomplete = () => resolve();
              transaction.onerror = () => reject(transaction.error);
            });
            const {AgentPersistence} =
              await import('/src/agent/persistence.ts');
            let error: string | undefined;
            if (blocked) {
              try {
                await AgentPersistence.open('first');
              } catch (caught) {
                error = (caught as Error).message;
              }
            }
            legacy.close();
            const projects = [];
            for (const workspace of ['first', 'second']) {
              const persistence = await AgentPersistence.open(workspace);
              const saved = (await persistence.load())!;
              const receipts = await persistence.journal(config).load();
              await persistence.close();
              const reopened = await AgentPersistence.open(workspace);
              const restored = await reopened.load();
              await reopened.close();
              projects.push({saved, restored, receipts});
            }
            return {error, projects};
          },
          {identity, config, blocked, legacyVersion},
        );
        assert.equal(
          result.error,
          blocked
            ? 'Close other Code3D tabs and reload this page to upgrade agent storage.'
            : undefined,
        );
        for (const project of result.projects) {
          assert.deepEqual(project.saved, project.restored);
          assert.equal(project.saved.sessionId, identity.sessionId);
          assert.equal('identity' in project.saved, false);
          assert.equal('relay' in project.saved, false);
          const grant = project.saved.grants[0];
          assert.equal(grant.config.version, 2);
          assert.equal(grant.config.agentId, config.agentId);
          assert.equal(grant.config.key, config.key);
          assert.equal(grant.config.origin, config.origin);
          assert.ok(grant.config.port >= 49152 && grant.config.port <= 65535);
          assert.equal('relay' in grant.config, false);
          assert.equal(grant.lastSeen, '2026-09-08T12:00:00.000Z');
          if (legacyVersion >= 2) assert.equal(grant.color, 3);
          assert.ok(
            Number.isInteger(grant.color) &&
              grant.color >= 0 &&
              grant.color < 6,
          );
          assert.equal(project.receipts[0].requestId, 'r1');
          assert.deepEqual(project.receipts[0].response, {
            ok: true,
            data: {saved: true},
          });
        }
      },
    );

test(
  'project storage retains receipts, isolates projects and cannot revive revoked grants',
  {timeout: 30_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL(
      '/__agent-persistence-test__',
      process.env.CODE3D_TEST_URL,
    ).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main>Agent persistence</main>',
      }),
    );
    await page.goto(url);
    const identity = {sessionId: crypto.randomUUID(), token: 'old-host-token'};
    const config = createAgentConfig({
      port: 54321,
      origin: new URL(process.env.CODE3D_TEST_URL!).origin,
      sessionId: identity.sessionId,
      name: 'Alice',
    });
    const result = await page.evaluate(
      async ({identity, config}) => {
        const {AgentPersistence} = await import('/src/agent/persistence.ts');
        const {rememberProjectDirectory} =
          await import('/src/project/directory-access.ts');
        const root = await navigator.storage.getDirectory();
        const folder = await root.getDirectoryHandle('models', {create: true});
        const workspaceId = await rememberProjectDirectory(folder);
        const reopenedId = await rememberProjectDirectory(
          await root.getDirectoryHandle('models'),
        );
        const otherId = await rememberProjectDirectory(
          await root.getDirectoryHandle('other', {create: true}),
        );
        const first = await AgentPersistence.open('first');
        await first.save({
          sessionId: identity.sessionId,
          grants: [{config, color: 0}],
        });
        await first.recordActivity(config, '2026-09-08T12:00:00.000Z');
        const journal = first.journal(config);
        await journal.write({
          requestId: 'r1',
          fingerprint: 'fingerprint',
          response: {ok: true, data: {saved: true}},
        });
        const second = await AgentPersistence.open('second');
        const isolated = await second.load();
        const isolatedReceipts = await second.journal(config).load();
        await second.close();
        await first.close();
        const reopened = await AgentPersistence.open('first');
        const session = await reopened.load();
        const receipts = await reopened.journal(config).load();
        await reopened.save({...session!, grants: []});
        let activityBlocked = false;
        try {
          await reopened.recordActivity(config, '2026-09-08T12:01:00.000Z');
        } catch {
          activityBlocked = true;
        }
        let blocked = false;
        try {
          await reopened
            .journal(config)
            .write({requestId: 'late', fingerprint: 'fingerprint'});
        } catch {
          blocked = true;
        }
        const removed = await reopened.journal(config).load();
        await reopened.save();
        const ended = await reopened.load();
        await reopened.close();
        return {
          session,
          receipts,
          isolated,
          isolatedReceipts,
          blocked,
          activityBlocked,
          removed,
          ended,
          workspaceId,
          reopenedId,
          otherId,
        };
      },
      {identity, config},
    );
    assert.deepEqual(result.session, {
      sessionId: identity.sessionId,
      grants: [{config, color: 0, lastSeen: '2026-09-08T12:00:00.000Z'}],
    });
    assert.equal(result.receipts.length, 1);
    assert.deepEqual(result.receipts[0].response, {
      ok: true,
      data: {saved: true},
    });
    assert.equal(result.isolated, undefined);
    assert.deepEqual(result.isolatedReceipts, []);
    assert.equal(result.blocked, true);
    assert.equal(result.activityBlocked, true);
    assert.deepEqual(result.removed, []);
    assert.equal(result.ended, undefined);
    assert.equal(result.workspaceId, result.reopenedId);
    assert.notEqual(result.workspaceId, result.otherId);
  },
);
