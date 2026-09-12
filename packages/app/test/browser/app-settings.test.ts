import assert from 'node:assert/strict';
import {after, before, test, type TestContext} from 'node:test';
import {chromium, type Browser, type Page} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';
import type {CacheResult} from './persistent-cache.worker.ts';

let browser: Browser;
before(async () => {
  assert.ok(process.env.CODE3D_TEST_URL);
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

async function fixture(t: TestContext, realApp = false) {
  const context = await browser.newContext({
    viewport: {width: 1280, height: 900},
    deviceScaleFactor: 3,
  });
  t.after(() => context.close());
  const errors: string[] = [];
  context.on('page', page => {
    page.setDefaultTimeout(20_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/\[mobx\]/i.test(message.text())) errors.push(message.text());
    });
    page.on('dialog', async dialog => {
      errors.push(`Unexpected native dialog: ${dialog.message()}`);
      await dialog.dismiss();
    });
  });
  t.after(() => assert.deepEqual(errors, []));
  const url = new URL(
    realApp ? '/' : '/__settings-test__',
    process.env.CODE3D_TEST_URL,
  ).href;
  if (!realApp)
    await context.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<link rel="stylesheet" href="/src/style.css"><main>App settings test</main>',
      }),
    );
  const page = await context.newPage();
  await page.goto(url);
  return {page, context, url};
}

async function saved(page: Page) {
  return page.evaluate(async () => {
    const {appSettings} = await import('/test/browser/app-settings-host.ts');
    return appSettings.value;
  });
}

async function fillSetting(page: Page, key: string, value: string) {
  const input = page.locator(`[name=${key}]`);
  const panel = input.locator('xpath=ancestor::section[@role="tabpanel"]');
  const tab = await panel.getAttribute('aria-labelledby');
  await page.locator(`[id="${tab}"]`).click();
  await input.fill(value);
}

test(
  'App settings save unrestricted numbers, cancel drafts and restore full display resolution',
  {timeout: 90_000},
  async t => {
    const {page} = await fixture(t, true);
    await page.locator('.viewport-canvas').waitFor();
    const canvas = page.locator('.viewport-canvas');
    const ratio = () =>
      canvas.evaluate(
        (canvas: HTMLCanvasElement) => canvas.width / canvas.clientWidth,
      );
    assert.ok(Math.abs((await ratio()) - 3) < 0.02);
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    const dialog = page.getByRole('dialog', {
      name: 'App settings',
      exact: true,
    });
    const drafts = () =>
      dialog
        .locator('input')
        .evaluateAll((inputs: HTMLInputElement[]) =>
          Object.fromEntries(inputs.map(input => [input.name, input.value])),
        );
    const defaults = await drafts();
    assert.equal(
      await dialog.locator('[name=editDelayMs]').inputValue(),
      '400',
    );
    assert.equal(
      await dialog.locator('[name=completionDelayMs]').inputValue(),
      '200',
    );
    assert.equal(
      await dialog.locator('[name=pixelRatioLimit]').inputValue(),
      '',
    );
    assert.equal(await dialog.locator('[name=diskCacheGiB]').inputValue(), '2');
    for (const key of ['snapshotConcurrency', 'memoryCacheGiB', 'diskCacheGiB'])
      assert.equal(
        await dialog.locator(`[name=${key}]`).getAttribute('max'),
        null,
      );
    await dialog.locator('[name=editDelayMs]').fill('750');
    await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
    assert.equal((await saved(page)).editDelayMs, 400);
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    await fillSetting(page, 'snapshotConcurrency', '0');
    await dialog.getByRole('button', {name: 'Save', exact: true}).click();
    assert.ok(await dialog.isVisible());
    for (const [key, value] of Object.entries({
      editDelayMs: '750',
      completionDelayMs: '350',
      pixelRatioLimit: '1',
      snapshotConcurrency: '64',
      memoryCacheGiB: '128.5',
      diskCacheGiB: '256.5',
    }))
      await fillSetting(page, key, value);
    await dialog.getByRole('button', {name: 'Save', exact: true}).click();
    await dialog.waitFor({state: 'hidden'});
    assert.ok(Math.abs((await ratio()) - 1) < 0.02);
    await page.reload();
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    assert.equal(
      await dialog.locator('[name=diskCacheGiB]').inputValue(),
      '256.5',
    );
    assert.equal(
      await dialog.locator('[name=snapshotConcurrency]').inputValue(),
      '64',
    );
    await fillSetting(page, 'editDelayMs', '875');
    await fillSetting(page, 'diskCacheGiB', '512.5');
    const edited = await drafts();
    const reset = dialog.getByRole('button', {
      name: 'Reset defaults',
      exact: true,
    });
    const confirmation = page.getByRole('dialog', {
      name: 'Reset defaults?',
      exact: true,
    });
    for (const dismiss of ['cancel', 'escape']) {
      await reset.click();
      await confirmation.waitFor();
      assert.ok(
        await confirmation
          .getByRole('button', {name: 'Cancel', exact: true})
          .evaluate(button => button === document.activeElement),
      );
      if (dismiss === 'escape') await page.keyboard.press('Escape');
      else
        await confirmation
          .getByRole('button', {name: 'Cancel', exact: true})
          .click();
      await confirmation.waitFor({state: 'hidden'});
      assert.ok(await dialog.isVisible());
      assert.deepEqual(await drafts(), edited);
      assert.ok(
        await reset.evaluate(button => button === document.activeElement),
      );
      assert.equal((await saved(page)).diskCacheGiB, 256.5);
    }
    await reset.click();
    await confirmation
      .getByRole('button', {name: 'Reset defaults', exact: true})
      .click();
    await confirmation.waitFor({state: 'hidden'});
    assert.deepEqual(await drafts(), defaults);
    assert.equal((await saved(page)).diskCacheGiB, 256.5);
    await dialog.getByRole('button', {name: 'Save', exact: true}).click();
    assert.ok(Math.abs((await ratio()) - 3) < 0.02);
  },
);

test(
  'preferences synchronize across tabs without replacing unrelated form drafts',
  {timeout: 30_000},
  async t => {
    const {page, context, url} = await fixture(t);
    const second = await context.newPage();
    await second.goto(url);
    await second.evaluate(async () => {
      const {appSettings} = await import('/test/browser/app-settings-host.ts');
      const {AppSettingsDialog} =
        await import('/test/browser/app-settings-host.ts');
      new AppSettingsDialog(appSettings).open();
    });
    const input = second.locator('[name=editDelayMs]');
    await input.fill('875');
    const node = await input.elementHandle();
    await page.evaluate(async () => {
      const {appSettings} = await import('/test/browser/app-settings-host.ts');
      appSettings.save({...appSettings.value, memoryCacheGiB: 4.5});
    });
    await second.waitForFunction(
      () =>
        (document.querySelector('[name=memoryCacheGiB]') as HTMLInputElement)
          .value === '4.5',
    );
    assert.equal(await input.inputValue(), '875');
    assert.ok(await input.evaluate((input, node) => input === node, node));
    await second.getByRole('button', {name: 'Save', exact: true}).click();
    await page.waitForFunction(async () => {
      const {appSettings} = await import('/test/browser/app-settings-host.ts');
      return appSettings.value.editDelayMs === 875;
    });
  },
);

test(
  'failed preference storage keeps committed values and allows retry',
  {timeout: 30_000},
  async t => {
    const {page} = await fixture(t);
    await page.evaluate(async () => {
      const {AppSettings} = await import('/test/browser/app-settings-host.ts');
      const {AppSettingsDialog} =
        await import('/test/browser/app-settings-host.ts');
      let fail = true;
      const settings = new AppSettings({
        getItem: () => null,
        setItem: () => {
          if (fail) {
            fail = false;
            throw new Error('Preference storage unavailable.');
          }
        },
      });
      new AppSettingsDialog(settings).open();
      Object.assign(window, {testSettings: settings});
    });
    await fillSetting(page, 'diskCacheGiB', '12.5');
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    await page
      .getByRole('alert')
      .getByText('Preference storage unavailable.')
      .waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          (window as unknown as {testSettings: {value: {diskCacheGiB: number}}})
            .testSettings.value.diskCacheGiB,
      ),
      2,
    );
    assert.equal(
      await page.locator('[name=diskCacheGiB]').inputValue(),
      '12.5',
    );
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    await page.getByRole('dialog').waitFor({state: 'hidden'});
  },
);

test(
  'execution and persistence Workers use changed budgets without reloading the page',
  {timeout: 120_000},
  async t => {
    const {page} = await fixture(t);
    const diskBudgets = await page.evaluate(async () => {
      const {appSettings, ModelCompilerClient, CacheWorker} =
        await import('/test/browser/app-settings-host.ts');
      const client = new ModelCompilerClient({
        readFile: async () => undefined,
        stat: async () => undefined,
      });
      const cacheWorker = new CacheWorker();
      const budgets: number[] = [];
      try {
        for (const [index, budget] of [0.5, 4.5].entries()) {
          appSettings.save({
            ...appSettings.value,
            snapshotConcurrency: index ? 8 : 1,
            memoryCacheGiB: budget,
            diskCacheGiB: budget,
          });
          const source = `import {box} from '@code3d/core';
          import {kernelOperationCacheStats} from '@code3d/core/tooling';
          if (kernelOperationCacheStats().maximumBytes !== ${budget * 1024 ** 3}) throw new Error('Memory budget was not applied: ' + kernelOperationCacheStats().maximumBytes + ', expected ${budget * 1024 ** 3}');
          export default box(${3 + index}, 4, 5);`;
          const module = await client.compile(
            {files: [{path: '/model.ts', source}]},
            '/model.ts',
          );
          if (module.diagnostic) throw new Error(module.diagnostic.summary);
          const result = await new Promise<CacheResult>((resolve, reject) => {
            cacheWorker.onerror = event => reject(new Error(event.message));
            cacheWorker.onmessage = ({data}) => {
              if (!data.phase) resolve(data);
            };
            cacheWorker.postMessage({
              source: `import {box} from '@code3d/core'; export default box(${8 + index}, 4, 5);`,
              concurrency: 1,
            });
          });
          if (result.error || result.diagnostic)
            throw new Error(JSON.stringify(result));
          budgets.push(result.stats.disk!.maximumBytes);
        }
        return budgets;
      } finally {
        client.dispose();
        cacheWorker.terminate();
      }
    });
    assert.deepEqual(diskBudgets, [0.5 * 1024 ** 3, 4.5 * 1024 ** 3]);
  },
);

test(
  'category navigation preserves drafts and reveals invalid fields before saving all panels',
  {timeout: 30_000},
  async t => {
    const {page} = await fixture(t);
    await page.evaluate(async () => {
      const {appSettings} = await import('/test/browser/app-settings-host.ts');
      const {AppSettingsDialog} =
        await import('/test/browser/app-settings-host.ts');
      new AppSettingsDialog(appSettings).open();
    });
    const categories = page.getByRole('tablist', {name: 'Settings categories'});
    assert.equal(await categories.getAttribute('aria-orientation'), 'vertical');
    assert.equal(await page.getByRole('tabpanel').count(), 1);
    const edit = page.locator('[name=editDelayMs]');
    await edit.fill('735');
    const original = await edit.elementHandle();
    await page.getByRole('tab', {name: 'Preview', exact: true}).focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').innerText(), 'Rendering');
    assert.equal(
      await page
        .getByRole('tab', {name: 'Rendering'})
        .getAttribute('aria-selected'),
      'true',
    );
    await page.locator('[name=snapshotConcurrency]').fill('');
    await page.getByRole('tab', {name: 'Cache', exact: true}).click();
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    assert.equal(
      await page.locator(':focus').getAttribute('name'),
      'snapshotConcurrency',
    );
    assert.equal(
      await page.getByRole('tabpanel').getAttribute('id'),
      'settings-panel-rendering',
    );
    await page.locator('[name=snapshotConcurrency]').fill('8');
    await fillSetting(page, 'diskCacheGiB', '0');
    await page.getByRole('tab', {name: 'Preview', exact: true}).click();
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    assert.equal(
      await page.getByRole('tabpanel').getAttribute('id'),
      'settings-panel-cache',
    );
    assert.equal(
      await page.locator(':focus').getAttribute('name'),
      'diskCacheGiB',
    );
    await page.locator('[name=diskCacheGiB]').fill('6');
    await page.getByRole('tab', {name: 'Cache', exact: true}).focus();
    await page.keyboard.press('Home');
    assert.equal(await page.locator(':focus').innerText(), 'Preview');
    assert.equal(await edit.inputValue(), '735');
    assert.ok(await edit.evaluate((input, node) => input === node, original));
    await page.setViewportSize({width: 390, height: 740});
    await page.waitForFunction(
      () =>
        document
          .querySelector('[role=tablist]')
          ?.getAttribute('aria-orientation') === 'horizontal',
    );
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator(':focus').innerText(), 'Rendering');
    await page.keyboard.press('End');
    assert.equal(await page.locator(':focus').innerText(), 'Cache');
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    const value = await saved(page);
    assert.equal(value.editDelayMs, 735);
    assert.equal(value.snapshotConcurrency, 8);
    assert.equal(value.diskCacheGiB, 6);
  },
);
