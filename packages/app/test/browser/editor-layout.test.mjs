import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium} from 'playwright-core';

let browser;
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

async function fixture(t, {controlledResize = false} = {}) {
  const context = await browser.newContext({
    viewport: {width: 1440, height: 900},
  });
  t.after(() => context.close());
  const page = await context.newPage();
  if (controlledResize) {
    // Allow pointerup before the asynchronous layout notification, even when
    // the media query has already hidden the separator.
    await page.addInitScript(() => {
      const Observer = ResizeObserver;
      window.pendingLayoutObservers = [];
      window.ResizeObserver = class extends Observer {
        constructor(callback) {
          super((entries, observer) => {
            if (
              window.pauseLayoutObserver &&
              entries.some(entry => entry.target.id === 'workspace')
            ) {
              window.pendingLayoutObservers.push(() =>
                callback(entries, observer),
              );
            } else {
              callback(entries, observer);
            }
          });
        }
      };
    });
  }
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()) + '\nwindow.layoutEditor = codeEditor;\n',
    });
  });
  await page.goto(process.env.CODE3D_TEST_URL);
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
  return page;
}

async function width(page, selector = '#editor-host') {
  return Math.round((await page.locator(selector).boundingBox()).width);
}

async function waitWidth(page, expected) {
  await page.waitForFunction(value => {
    const width = document.querySelector('#editor-host').clientWidth;
    return (
      width === value &&
      Math.abs(window.layoutEditor.editor.getLayoutInfo().width - width) < 1
    );
  }, expected);
}

async function startDrag(page, delta) {
  const rect = await page.locator('#workspace-resizer').boundingBox();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, {steps: 5});
}

test(
  'dragged code width survives window resizing, explorer toggles and refresh',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const initialWidth = await width(page);
    await page.evaluate(() => {
      const editor = window.layoutEditor.editor;
      editor.setSelection({
        startLineNumber: 3,
        startColumn: 7,
        endLineNumber: 3,
        endColumn: 11,
      });
      window.layoutSnapshot = {
        model: editor.getModel(),
        source: editor.getValue(),
        selection: editor.getSelection(),
      };
    });

    await startDrag(page, 96);
    await page.mouse.up();
    const preferredWidth = initialWidth + 96;
    await waitWidth(page, preferredWidth);
    await page.setViewportSize({width: 1920, height: 900});
    await waitWidth(page, preferredWidth);
    await page.setViewportSize({width: 1000, height: 900});
    await page.waitForFunction(
      preferred =>
        document.querySelector('#editor-host').clientWidth < preferred,
      preferredWidth,
    );
    assert.ok((await width(page)) > 0);
    assert.ok((await width(page, '.preview-pane')) >= 460);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      1000,
    );
    await page.setViewportSize({width: 1440, height: 900});
    await waitWidth(page, preferredWidth);

    const paneWidth = await width(page, '.editor-pane');
    const explorerWidth = await width(page, '#project-explorer');
    await page.locator('#project-explorer-toggle').click();
    await page.waitForFunction(
      expected =>
        document.querySelector('.editor-pane').clientWidth + 1 === expected,
      paneWidth - explorerWidth,
    );
    await waitWidth(page, preferredWidth);
    await page.locator('#project-explorer-toggle').click();
    await page.waitForFunction(
      expected =>
        document.querySelector('.editor-pane').clientWidth + 1 === expected,
      paneWidth,
    );
    await waitWidth(page, preferredWidth);

    assert.deepEqual(
      await page.evaluate(() => {
        const editor = window.layoutEditor.editor;
        const snapshot = window.layoutSnapshot;
        return {
          model: editor.getModel() === snapshot.model,
          source: editor.getValue() === snapshot.source,
          selection:
            JSON.stringify(editor.getSelection()) ===
            JSON.stringify(snapshot.selection),
        };
      }),
      {model: true, source: true, selection: true},
    );
    await page.setViewportSize({width: 680, height: 800});
    assert.equal(await page.locator('#workspace-resizer').isVisible(), false);
    await page.setViewportSize({width: 1440, height: 900});
    await waitWidth(page, preferredWidth);
    await page.reload();
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await waitWidth(page, preferredWidth);
  },
);

test(
  'separator supports keyboard sizing and cancels interrupted drags without saving them',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t, {controlledResize: true});
    const separator = page.getByRole('separator', {name: 'Resize code editor'});
    const initialWidth = await width(page);
    await separator.focus();
    await page.keyboard.press('ArrowRight');
    await waitWidth(page, initialWidth + 16);
    await page.keyboard.press('Shift+ArrowLeft');
    const savedWidth = initialWidth - 48;
    await waitWidth(page, savedWidth);
    assert.equal(
      await separator.getAttribute('aria-valuenow'),
      String(savedWidth),
    );

    await startDrag(page, 120);
    await waitWidth(page, savedWidth + 120);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await waitWidth(page, savedWidth);
    assert.equal(
      await page.locator('#workspace').getAttribute('data-resizing'),
      null,
    );

    await startDrag(page, -80);
    await waitWidth(page, savedWidth - 80);
    await separator.dispatchEvent('pointercancel', {pointerId: 1});
    await page.mouse.up();
    await waitWidth(page, savedWidth);

    await startDrag(page, 80);
    await page.evaluate(() => {
      window.pauseLayoutObserver = true;
    });
    await page.setViewportSize({width: 680, height: 800});
    await page.mouse.up();
    await page.setViewportSize({width: 1440, height: 900});
    await page.evaluate(() => {
      window.pauseLayoutObserver = false;
      for (const callback of window.pendingLayoutObservers.splice(0))
        callback();
    });
    await waitWidth(page, savedWidth);
    await page.reload();
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await waitWidth(page, savedWidth);

    await separator.focus();
    await page.keyboard.press('Home');
    await waitWidth(
      page,
      Number(await separator.getAttribute('aria-valuemin')),
    );
    assert.ok((await width(page)) < savedWidth);
    await page.keyboard.press('End');
    await waitWidth(
      page,
      Number(await separator.getAttribute('aria-valuemax')),
    );
    assert.equal(await width(page, '.preview-pane'), 460);
    await startDrag(page, 200);
    await page.mouse.up();
    assert.equal(await width(page, '.preview-pane'), 460);
  },
);
