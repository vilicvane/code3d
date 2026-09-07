import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {createAgentConfig, createHostIdentity} from '@code3d/agent';

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
        body: '<main>Agent persistence</main>',
      }),
    );
    await page.goto(url);
    const identity = await createHostIdentity();
    const config = createAgentConfig({
      relay: 'http://127.0.0.1:3134',
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
        await first.save({identity, relay: config.relay, grants: [{config}]});
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
      identity,
      relay: config.relay,
      grants: [{config}],
    });
    assert.equal(result.receipts.length, 1);
    assert.deepEqual(result.receipts[0].response, {
      ok: true,
      data: {saved: true},
    });
    assert.equal(result.isolated, undefined);
    assert.deepEqual(result.isolatedReceipts, []);
    assert.equal(result.blocked, true);
    assert.deepEqual(result.removed, []);
    assert.equal(result.ended, undefined);
    assert.equal(result.workspaceId, result.reopenedId);
    assert.notEqual(result.workspaceId, result.otherId);
  },
);
