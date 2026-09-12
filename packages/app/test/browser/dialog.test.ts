import assert from 'node:assert/strict';
import {after, before, test, type TestContext} from 'node:test';
import {chromium, type Browser, type Page} from 'playwright-core';

declare const window: Window & {
  testDialogs: import('../../src/ui/dialog.ts').AppDialogs;
  results: unknown[];
  keyboardEvents: number;
  exportDialog: import('../../src/ui/export-dialog.ts').ExportDialog;
  completeExport(error?: string): void;
  downloads: number;
};

let browser: Browser;
before(async () => {
  assert.ok(process.env.CODE3D_TEST_URL);
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

async function open(t: TestContext): Promise<Page> {
  const context = await browser.newContext({
    viewport: {width: 1280, height: 800},
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/\[mobx\]/i.test(message.text())) errors.push(message.text());
  });
  page.on('dialog', async dialog => {
    errors.push(`Unexpected native dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/src/main.ts*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `import '/src/style.css';
      import {AppDialogs} from '/src/ui/dialog.ts';
      document.querySelector('#app').innerHTML = '<button id="opener">Open dialog</button>';
      window.testDialogs = new AppDialogs();
      window.results = [];
      window.keyboardEvents = 0;
      document.addEventListener('keydown', () => window.keyboardEvents++);`,
    }),
  );
  await page.goto(process.env.CODE3D_TEST_URL!);
  await page.waitForFunction(() => !!window.testDialogs);
  await page.locator('#opener').focus();
  return page;
}

test(
  'confirm and alert requests queue, cancel safely and restore focus',
  {timeout: 30_000},
  async t => {
    const page = await open(t);
    await page.evaluate(() => {
      void window.testDialogs
        .confirm({
          title: 'Delete files',
          message: 'Delete <model.ts>?',
          danger: true,
          submit: 'Delete',
        })
        .then(value => window.results.push(value));
      void window.testDialogs
        .alert({title: 'Notice', message: 'Second request'})
        .then(() => window.results.push('acknowledged'));
    });
    const confirm = page.getByRole('dialog', {
      name: 'Delete files',
      exact: true,
    });
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.equal(
      await confirm.locator('header p').innerText(),
      'Delete <model.ts>?',
    );
    assert.equal(await page.locator(':focus').innerText(), 'Cancel');
    await page.keyboard.press('Enter');
    const alert = page.getByRole('dialog', {name: 'Notice', exact: true});
    await alert.waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.results.length === 2);
    assert.deepEqual(await page.evaluate(() => window.results), [
      false,
      'acknowledged',
    ]);
    assert.equal(await page.locator(':focus').getAttribute('id'), 'opener');
    assert.equal(await page.locator('dialog').count(), 0);
    assert.equal(await page.evaluate(() => window.keyboardEvents), 0);
  },
);

test(
  'prompt validates inline, preserves its input node and returns accepted text',
  {timeout: 30_000},
  async t => {
    const page = await open(t);
    await page.evaluate(() => {
      void window.testDialogs
        .prompt({
          title: 'New file',
          label: 'Name',
          value: 'untitled.ts',
          trim: true,
          message: 'In /src',
          submit: 'Create',
          validate: value => {
            if (value.includes('/')) throw new Error('Use a file name.');
          },
        })
        .then(value => window.results.push(value));
    });
    const dialog = page.getByRole('dialog', {name: 'New file', exact: true});
    const input = dialog.getByRole('textbox', {name: 'Name'});
    const node = await input.elementHandle();
    assert.deepEqual(
      await input.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
      [0, 11],
    );
    await input.fill('  ');
    await page.keyboard.press('Enter');
    assert.equal(await dialog.getByRole('alert').innerText(), 'Enter name.');
    await input.fill('bad/name.ts');
    await page.keyboard.press('Enter');
    assert.equal(
      await dialog.getByRole('alert').innerText(),
      'Use a file name.',
    );
    assert.equal(await input.inputValue(), 'bad/name.ts');
    assert.ok(await input.evaluate((input, node) => input === node, node));
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    await input.fill('  model.ts  ');
    assert.equal(await dialog.getByRole('alert').count(), 0);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results), ['model.ts']);
    assert.equal(await page.locator(':focus').getAttribute('id'), 'opener');
  },
);

test(
  'backdrop cancels and disposal settles active and queued requests',
  {timeout: 30_000},
  async t => {
    const page = await open(t);
    await page.evaluate(() => {
      void window.testDialogs
        .prompt({title: 'Name', label: 'Name'})
        .then(value => window.results.push(value ?? 'cancelled'));
    });
    await page.getByRole('dialog', {name: 'Name', exact: true}).waitFor();
    await page.mouse.click(2, 2);
    await page.waitForFunction(() => window.results.length === 1);
    assert.deepEqual(await page.evaluate(() => window.results), ['cancelled']);
    await page.evaluate(() => {
      void window.testDialogs
        .confirm({title: 'First'})
        .then(value => window.results.push(value));
      void window.testDialogs
        .prompt({title: 'Second', label: 'Name'})
        .then(value => window.results.push(value ?? 'cancelled'));
      window.testDialogs.dispose();
      void window.testDialogs
        .confirm({title: 'After disposal'})
        .then(value => window.results.push(value));
    });
    await page.waitForFunction(() => window.results.length === 4);
    assert.deepEqual(await page.evaluate(() => window.results), [
      'cancelled',
      false,
      'cancelled',
      false,
    ]);
    assert.equal(await page.locator('dialog').count(), 0);
  },
);

test(
  'export keeps its modal busy, allows retry and ignores completion after disposal',
  {timeout: 30_000},
  async t => {
    const page = await open(t);
    await page.evaluate(async () => {
      const {ExportDialog} = await import('/src/ui/export-dialog.ts');
      window.downloads = 0;
      document.addEventListener('click', event => {
        if (
          event.target instanceof HTMLAnchorElement &&
          event.target.download
        ) {
          event.preventDefault();
          window.downloads++;
        }
      });
      window.exportDialog = new ExportDialog(document.body, {
        title: 'Export model',
        description: 'Test model',
        busyLabel: 'Exporting…',
        export: () =>
          new Promise((resolve, reject) => {
            window.completeExport = error =>
              error
                ? reject(new Error(error))
                : resolve({blob: new Blob(['model']), fileName: 'model.stl'});
          }),
      });
      const input = document.createElement('input');
      input.setAttribute('aria-label', 'File name');
      window.exportDialog.append(input);
      window.exportDialog.open(input);
    });
    const dialog = page.getByRole('dialog', {
      name: 'Export model',
      exact: true,
    });
    await dialog.getByRole('button', {name: 'Export', exact: true}).click();
    assert.ok(
      await dialog
        .getByRole('button', {name: 'Cancel', exact: true})
        .isDisabled(),
    );
    await page.keyboard.press('Escape');
    await page.mouse.click(2, 2);
    assert.ok(await dialog.isVisible());
    await page.evaluate(() => window.completeExport('Export failed.'));
    await dialog.getByText('Export failed.', {exact: true}).waitFor();
    await dialog.getByRole('button', {name: 'Export', exact: true}).click();
    await page.evaluate(() => {
      window.exportDialog.dispose();
      window.completeExport();
    });
    assert.equal(await page.locator('dialog').count(), 0);
    assert.equal(await page.evaluate(() => window.downloads), 0);
  },
);
