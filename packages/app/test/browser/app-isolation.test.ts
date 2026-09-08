import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {preview as previewApp} from 'vite';
import {preview as previewWebsite} from 'astro';
import {chromium} from 'playwright-core';
import {appIsolationHeaders, appIsolationRules} from '../../build/isolation.ts';

for (const target of ['app', 'website'] as const) {
  test(
    `built ${target} serves isolated documents and compiles in its real Worker`,
    {timeout: 120_000},
    async t => {
      const browser = await chromium.connectOverCDP(
        process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
      );
      t.after(() => browser.close());
      const context = await browser.newContext();
      t.after(() => context.close());
      let url: string;
      if (target === 'app') {
        assert.equal(
          await readFile(
            new URL('../../dist/_headers', import.meta.url),
            'utf8',
          ),
          appIsolationRules('/*'),
        );
        const server = await previewApp({
          root: fileURLToPath(new URL('../..', import.meta.url)),
          preview: {host: '127.0.0.1', port: 0, strictPort: true},
          logLevel: 'error',
        });
        t.after(() => server.close());
        const address = server.httpServer.address();
        assert.ok(address && typeof address === 'object');
        url = `http://127.0.0.1:${address.port}/`;
      } else {
        assert.equal(
          await readFile(
            new URL('../../../web/dist/www/_headers', import.meta.url),
            'utf8',
          ),
          appIsolationRules('/app/*'),
        );
        const server = await previewWebsite({
          root: fileURLToPath(new URL('../../../web/', import.meta.url)),
          server: {host: '127.0.0.1', port: 0},
          logLevel: 'error',
        });
        t.after(() => server.stop());
        url = `http://127.0.0.1:${server.port}/app/`;
      }
      const page = await context.newPage();
      const response = await page.goto(url);
      assert.ok(response);
      assert.ok(response.ok());
      for (const [name, value] of Object.entries(appIsolationHeaders)) {
        assert.equal(response.headers()[name.toLowerCase()], value);
      }
      assert.equal(await page.evaluate(() => crossOriginIsolated), true);
      await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    },
  );
}
