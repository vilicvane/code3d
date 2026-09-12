import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

for (const mode of ['poll', 'events'])
  test(
    `local directory ${mode} synchronizes opened buffers and unopened dependencies`,
    {timeout: 90_000},
    async t => {
      const browser = await chromium.connectOverCDP(
        process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
      );
      t.after(() => browser.close());
      const context = await browser.newContext();
      t.after(() => context.close());
      await context.addInitScript(() =>
        Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 2}),
      );
      await context.addInitScript(mode => {
        window.externalObserverActive = false;
        window.FileSystemObserver =
          mode === 'poll'
            ? undefined
            : class {
                constructor(callback) {
                  window.externalDirectoryCallback = callback;
                }
                async observe() {
                  window.externalObserverActive = true;
                }
                disconnect() {
                  window.externalObserverActive = false;
                }
              };
      }, mode);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const base = process.env.CODE3D_TEST_URL;
      assert.ok(base);
      await page.route('**/__external-files__', route =>
        route.fulfill({
          contentType: 'text/html',
          headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
          },
          body: '<main>Directory fixture</main>',
        }),
      );
      await page.goto(new URL('/__external-files__', base).href);
      const workspace = await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle('external-fixture', {
          create: true,
        });
        for (const [name, source] of [
          [
            'model.ts',
            "import {box} from '@code3d/core'; import {size} from './size.ts'; export default box(size, 2, 3);",
          ],
          ['size.ts', 'export const size = 4;'],
        ]) {
          const writer = await (
            await directory.getFileHandle(name, {create: true})
          ).createWritable();
          await writer.write(source);
          await writer.close();
        }
        return 'external-fixture';
      });
      await page.route('**/src/main.ts*', async route => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()).replace(
              'await storedProjectDirectory(directoryWorkspaceId)',
              "await (await navigator.storage.getDirectory()).getDirectoryHandle('external-fixture')",
            ) + '\nwindow.externalApp = {codeEditor, previewState};',
        });
      });
      await page.goto(
        new URL(`/?workspace=${workspace}#/file/model.ts`, base).href,
      );
      await page.waitForFunction(
        () =>
          window.externalApp?.previewState.module?.objects.size > 0 &&
          !window.externalApp.previewState.busy,
        {},
        {timeout: 60_000},
      );
      async function write(name, source) {
        await page.evaluate(
          async ({name, source}) => {
            const directory = await (
              await navigator.storage.getDirectory()
            ).getDirectoryHandle('external-fixture');
            if (source === null) {
              await directory.removeEntry(name);
              return;
            }
            const writer = await (
              await directory.getFileHandle(name)
            ).createWritable();
            await writer.write(source);
            await writer.close();
          },
          {name, source},
        );
        if (mode === 'events')
          await page.evaluate(
            ({name, source}) => {
              if (window.externalObserverActive)
                window.externalDirectoryCallback([
                  {
                    type: source === null ? 'disappeared' : 'modified',
                    relativePathComponents: [name],
                  },
                ]);
            },
            {name, source},
          );
      }
      // This dependency has never been opened in Monaco.
      await write(
        'size.ts',
        "throw new Error('external dependency update'); export const size = 7;",
      );
      await page.waitForFunction(
        () =>
          window.externalApp.previewState.diagnostic?.summary.includes(
            'external dependency update',
          ),
        {},
        {timeout: 15_000},
      );
      await write('size.ts', 'export const size = 7;');
      await page.waitForFunction(
        () =>
          !window.externalApp.previewState.busy &&
          window.externalApp.previewState.status === 'ready',
        {},
        {timeout: 15_000},
      );
      // Opened source must stop shadowing the real file, including on manual refresh.
      const source =
        "import {box} from '@code3d/core'; export default box(12, 2, 3);";
      await write('model.ts', source);
      await page
        .getByRole('button', {
          name: 'Refresh files and dependencies',
          exact: true,
        })
        .click();
      await page.waitForFunction(
        source =>
          window.externalApp.codeEditor.fileState('/model.ts')?.content ===
            source && !window.externalApp.previewState.busy,
        source,
        {timeout: 15_000},
      );
      if (mode === 'events')
        await page.evaluate(() => {
          window.externalDirectoryCallback([
            {type: 'errored', relativePathComponents: []},
          ]);
        });
      await write('model.ts', null);
      await page.waitForFunction(
        () => !window.externalApp.codeEditor.fileState('/model.ts'),
        {},
        {timeout: 15_000},
      );
      assert.deepEqual(errors, []);
    },
  );
