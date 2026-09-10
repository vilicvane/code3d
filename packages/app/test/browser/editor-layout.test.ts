import type {Browser, Page} from 'playwright-core';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium} from 'playwright-core';
declare const window: Window & {
  layoutEditor: import('../../src/editor.ts').CodeEditor;
  layoutFiles: import('../../src/project/filesystem.ts').ProjectFileSystem;
  layoutTree: import('../../src/ui/project-tree.ts').ProjectTree;
  pendingLayoutObservers: (() => void)[];
  pauseLayoutObserver: boolean;
  ResizeObserver: typeof ResizeObserver;
  layoutSnapshot: {
    model: import('monaco-editor/editor').editor.ITextModel | null;
    source: string;
    selection: import('monaco-editor/editor').Selection | null;
  };
};

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

async function fixture(t: TestContext, {controlledResize = false} = {}) {
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
        constructor(callback: ResizeObserverCallback) {
          super((entries, observer) => {
            if (
              window.pauseLayoutObserver &&
              entries.some(entry =>
                ['workspace', 'project-explorer'].includes(entry.target.id),
              )
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
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.layoutEditor = codeEditor; window.layoutFiles = projectFileSystem; window.layoutTree = projectDirectory;\n',
    });
  });
  await page.goto(process.env.CODE3D_TEST_URL!);
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
  return page;
}

async function width(page: Page, selector = '#editor-host') {
  return Math.round((await page.locator(selector).boundingBox())!.width);
}

async function waitWidth(
  page: Page,
  expected: number,
  selector = '#editor-host',
) {
  await page.waitForFunction(
    ({expected, selector}) => {
      const width = Math.round(
        document.querySelector(selector)!.getBoundingClientRect().width,
      );
      const codeWidth = document.querySelector('#editor-host')!.clientWidth;
      return (
        width === expected &&
        Math.abs(window.layoutEditor.editor.getLayoutInfo().width - codeWidth) <
          1
      );
    },
    {expected, selector},
  );
}

async function startDrag(
  page: Page,
  delta: number,
  selector = '#workspace-resizer',
) {
  const rect = await page.locator(selector).boundingBox();
  const x = rect!.x + rect!.width / 2;
  const y = rect!.y + rect!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, {steps: 5});
}

test(
  'file explorer width persists independently through toggles, window constraints and stacked layout',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t);
    const explorer = '#project-explorer';
    const separator = '#project-explorer-resizer';
    const codeWidth = await width(page);
    assert.equal(await width(page, explorer), 256);
    await startDrag(page, 100, separator);
    await page.mouse.up();
    await waitWidth(page, 356, explorer);
    await waitWidth(page, codeWidth);
    // The divider must leave the file tree's adjacent native scrollbar usable.
    await page.evaluate(async () => {
      for (let index = 0; index < 65; index++)
        await window.layoutFiles.writeFile(
          `/file-${index}.ts`,
          '// layout fixture',
        );
      await window.layoutTree.refresh();
    });
    const scroll = page.locator(
      '#project-tree [data-file-tree-virtualized-scroll]',
    );
    await scroll.evaluate(node => {
      node.scrollTop = 0;
    });
    const treeRect = (await scroll.boundingBox())!;
    const scrollX = treeRect.x + treeRect.width - 6;
    await page.mouse.move(scrollX, treeRect.y + 40);
    await page.mouse.down();
    await page.mouse.move(scrollX, treeRect.y + 160, {steps: 5});
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        document
          .querySelector('#project-tree')!
          .shadowRoot!.querySelector('[data-file-tree-virtualized-scroll]')!
          .scrollTop > 0,
    );
    await waitWidth(page, 356, explorer);
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem('code3d:project-explorer-width'),
      ),
      '356',
    );

    await page.locator('#project-explorer-toggle').click();
    assert.equal(await page.locator(separator).isVisible(), false);
    await waitWidth(page, codeWidth);
    await page.locator('#project-explorer-toggle').click();
    await waitWidth(page, 356, explorer);
    await waitWidth(page, codeWidth);
    await page.reload();
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await waitWidth(page, 356, explorer);
    await waitWidth(page, codeWidth);

    for (const windowWidth of [900, 851]) {
      await page.setViewportSize({width: windowWidth, height: 900});
      await waitWidth(page, windowWidth - 460 - 280 - 1, explorer);
      await waitWidth(page, 280);
      assert.equal(await width(page, '.preview-pane'), 460);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        windowWidth,
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem('code3d:project-explorer-width'),
        ),
        '356',
      );
    }

    await page.setViewportSize({width: 680, height: 800});
    await waitWidth(page, 356, explorer);
    assert.equal(await page.locator(separator).isVisible(), true);
    await startDrag(page, 32, separator);
    await page.mouse.up();
    await waitWidth(page, 388, explorer);
    await page.setViewportSize({width: 1440, height: 900});
    await waitWidth(page, 388, explorer);
    await waitWidth(page, codeWidth);
    await startDrag(page, 64);
    await page.mouse.up();
    await waitWidth(page, codeWidth + 64);
    await waitWidth(page, 388, explorer);
  },
);

test(
  'file explorer separator supports keyboard bounds and restores cancelled or hidden drags',
  {timeout: 120_000},
  async t => {
    const page = await fixture(t, {controlledResize: true});
    const explorer = '#project-explorer';
    const selector = '#project-explorer-resizer';
    const separator = page.getByRole('separator', {
      name: 'Resize file explorer',
      includeHidden: true,
    });
    await separator.focus();
    await page.keyboard.press('ArrowRight');
    await waitWidth(page, 272, explorer);
    await page.keyboard.press('Shift+ArrowRight');
    await waitWidth(page, 336, explorer);
    await page.keyboard.press('Home');
    await waitWidth(page, 140, explorer);
    await page.keyboard.press('End');
    await waitWidth(page, 420, explorer);
    assert.equal(await separator.getAttribute('aria-valuenow'), '420');
    await page.keyboard.press('Shift+ArrowLeft');
    await waitWidth(page, 356, explorer);

    for (const cancel of ['escape', 'pointercancel', 'blur'] as const) {
      await startDrag(page, -80, selector);
      await waitWidth(page, 276, explorer);
      if (cancel === 'escape') await page.keyboard.press('Escape');
      else if (cancel === 'pointercancel')
        await separator.dispatchEvent('pointercancel', {pointerId: 1});
      else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.mouse.up();
      await waitWidth(page, 356, explorer);
      assert.equal(
        await page.locator('#workspace').getAttribute('data-resizing'),
        null,
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem('code3d:project-explorer-width'),
        ),
        '356',
      );
    }

    await startDrag(page, -80, selector);
    await waitWidth(page, 276, explorer);
    await page.evaluate(() => {
      window.pauseLayoutObserver = true;
      document.querySelector<HTMLElement>('#project-explorer')!.hidden = true;
    });
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        !document.querySelector('#workspace')!.hasAttribute('data-resizing'),
    );
    assert.equal(await separator.getAttribute('aria-valuenow'), '356');
    assert.equal(
      await page.evaluate(() =>
        document
          .querySelector<HTMLElement>('#workspace')!
          .style.getPropertyValue('--project-explorer-width'),
      ),
      '356px',
    );
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#project-explorer')!.hidden = false;
      window.pauseLayoutObserver = false;
      for (const callback of window.pendingLayoutObservers.splice(0))
        callback();
    });
    await waitWidth(page, 356, explorer);
    await page.reload();
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await waitWidth(page, 356, explorer);
  },
);

test('hidden cancellation restores the saved width before any workspace resize notification', async t => {
  const page = await fixture(t, {controlledResize: true});
  const separator = page.locator('#workspace-resizer');
  const savedWidth = (await width(page)) + 16;
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await waitWidth(page, savedWidth);
  const savedStyle = await page.evaluate(() =>
    document
      .querySelector<HTMLElement>('#workspace')!
      .style.getPropertyValue('--editor-pane-width'),
  );
  await startDrag(page, 80);
  await waitWidth(page, savedWidth + 80);
  await page.evaluate(() => {
    window.pauseLayoutObserver = true;
  });
  await page.setViewportSize({width: 680, height: 800});
  await page.mouse.up();
  await page.waitForFunction(
    () => !document.querySelector('#workspace')!.hasAttribute('data-resizing'),
  );
  // Cancellation must update the CSS even while stacked layout ignores it.
  assert.equal(
    await page.evaluate(() =>
      document
        .querySelector<HTMLElement>('#workspace')!
        .style.getPropertyValue('--editor-pane-width'),
    ),
    savedStyle,
  );
  assert.equal(
    await separator.getAttribute('aria-valuenow'),
    String(savedWidth),
  );
  await page.setViewportSize({width: 1440, height: 900});
  await waitWidth(page, savedWidth);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('code3d:editor-width')),
    String(savedWidth),
  );
  await page.evaluate(() => {
    window.pauseLayoutObserver = false;
    for (const callback of window.pendingLayoutObservers.splice(0)) callback();
  });
  await page.reload();
  await page.getByText('Ready', {exact: true}).waitFor();
  await waitWidth(page, savedWidth);
});

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
        document.querySelector('#editor-host')!.clientWidth < preferred,
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
        document.querySelector('.editor-pane')!.clientWidth + 1 === expected,
      paneWidth - explorerWidth,
    );
    await waitWidth(page, preferredWidth);
    await page.locator('#project-explorer-toggle').click();
    await page.waitForFunction(
      expected =>
        document.querySelector('.editor-pane')!.clientWidth + 1 === expected,
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
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('#workspace-resizer')!)
          .display === 'none',
    );
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        !document.querySelector('#workspace')!.hasAttribute('data-resizing'),
    );
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
