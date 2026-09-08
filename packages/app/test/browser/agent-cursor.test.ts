import {appIsolationHeaders} from '../../build/isolation.ts';
import assert from 'node:assert/strict';
import {after, before, test, type TestContext} from 'node:test';
import {chromium, type Browser} from 'playwright-core';

let browser: Browser;
before(async () => {
  assert.ok(
    process.env.CODE3D_TEST_URL,
    'Set CODE3D_TEST_URL to the task server',
  );
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

async function fixture(t: TestContext) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const url = new URL('/__agent-cursor-test__', process.env.CODE3D_TEST_URL)
    .href;
  await page.route(url, route =>
    route.fulfill({
      contentType: 'text/html',
      headers: appIsolationHeaders,
      body: '<main>Agent cursor</main>',
    }),
  );
  await page.goto(url);
  return page;
}

test(
  'actual cursor Workers resolve selections and preserve preflight error codes',
  {timeout: 15_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const {inspectAgentCursor} =
        await import('/src/agent/cursor-resolver.ts');
      const cursor = await inspectAgentCursor('return model;', {
        file: '/model.ts',
        regex: 'return (model);',
      });
      let errorCode: string | undefined;
      try {
        await inspectAgentCursor('model model', {
          file: '/model.ts',
          regex: '(model)',
        });
      } catch (error) {
        errorCode = (error as {code: string}).code;
      }
      return {cursor, errorCode};
    });
    assert.equal(result.cursor.text, 'model');
    assert.equal(result.cursor.range.startColumn, 8);
    assert.equal(result.errorCode, 'cursor_ambiguous');
  },
);

test(
  'pathological regex times out without blocking the page or subsequent agents',
  {timeout: 15_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const {inspectAgentCursor} =
        await import('/src/agent/cursor-resolver.ts');
      let pageTicks = 0;
      const timer = setInterval(() => {
        pageTicks++;
      }, 10);
      let errorCode: string | undefined;
      const started = performance.now();
      try {
        await inspectAgentCursor('a'.repeat(100_000) + '!', {
          file: '/model.ts',
          regex: '^(a+)+$',
        });
      } catch (error) {
        errorCode = (error as {code: string}).code;
      } finally {
        clearInterval(timer);
      }
      const elapsed = performance.now() - started;
      const next = await inspectAgentCursor('next', {
        file: '/model.ts',
        regex: '(next)',
      });
      return {pageTicks, errorCode, elapsed, recovered: next.text};
    });
    assert.equal(result.errorCode, 'cursor_timeout');
    assert.ok(result.pageTicks > 0);
    assert.ok(result.elapsed < 5000);
    assert.equal(result.recovered, 'next');
  },
);

test(
  'loading the cursor Worker does not consume the regex execution deadline',
  {timeout: 15_000},
  async t => {
    const page = await fixture(t);
    await page.route('**/src/agent/cursor.worker.ts*', async route => {
      await new Promise(resolve => setTimeout(resolve, 1_200));
      await route.continue();
    });
    const text = await page.evaluate(async () => {
      const {inspectAgentCursor} =
        await import('/src/agent/cursor-resolver.ts');
      return (
        await inspectAgentCursor('model', {file: '/model.ts', regex: '(model)'})
      ).text;
    });
    assert.equal(text, 'model');
  },
);

test(
  'cancellation terminates an active cursor Worker and leaves no shared request state',
  {timeout: 15_000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const {inspectAgentCursor} =
        await import('/src/agent/cursor-resolver.ts');
      const controller = new AbortController();
      const pending = inspectAgentCursor(
        'a'.repeat(100_000) + '!',
        {file: '/model.ts', regex: '^(a+)+$'},
        controller.signal,
      );
      setTimeout(() => controller.abort(), 30);
      let errorName: string | undefined;
      try {
        await pending;
      } catch (error) {
        errorName = (error as Error).name;
      }
      const next = await inspectAgentCursor('next', {
        file: '/model.ts',
        regex: '(next)',
      });
      return {errorName, recovered: next.text};
    });
    assert.equal(result.errorName, 'AbortError');
    assert.equal(result.recovered, 'next');
  },
);
