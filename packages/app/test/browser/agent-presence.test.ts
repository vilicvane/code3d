import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

declare const window: Window & {
  presenceEditor: import('../../src/editor.ts').CodeEditor;
};

test(
  'agent carets match user geometry and tree locations follow visible ancestors',
  {timeout: 90_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1440, height: 900},
      deviceScaleFactor: 1.25,
    });
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) + '\nwindow.presenceEditor = codeEditor;\n',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    const originalFile = await page.evaluate(() => {
      const editor = window.presenceEditor;
      const originalFile = editor.currentFile();
      const source =
        "import {box} from '@code3d/core';\nexport default box(10, 6, 8);\n";
      editor.createFile('/parts/rib.ts', source);
      editor.createFile('/parts/housing/body.ts', source);
      editor.editor.updateOptions({cursorBlinking: 'solid'});
      editor.editor.setPosition({lineNumber: 2, column: 20});
      editor.editor.focus();
      return originalFile;
    });
    const before = await page.evaluate(() => {
      const editor = window.presenceEditor.editor;
      return {
        selection: editor.getSelection(),
        position: editor.getScrolledVisiblePosition({
          lineNumber: 2,
          column: 16,
        }),
      };
    });
    await page.evaluate(() => {
      const editor = window.presenceEditor;
      const file = '/parts/housing/body.ts';
      const start = editor.editor.getModel()!.getValue().indexOf('box(10');
      editor.setAgentCursor('alice', 'Alice', {file, start, end: start + 13});
      editor.setAgentCursor('bob', 'Bob', {
        file: '/parts/rib.ts',
        start: 0,
        end: 0,
      });
    });
    const alice = page.locator('.agent-caret').filter({hasText: /^Alice$/});
    const label = alice.locator('.agent-cursor-label');
    await label.waitFor();
    const caretBox = (await alice.boundingBox())!;
    const labelBox = (await label.boundingBox())!;
    const userBox = (await page
      .locator('.monaco-editor .cursor')
      .first()
      .boundingBox())!;
    assert.ok(Math.abs(caretBox.width - userBox.width) < 0.1);
    assert.equal(caretBox.height, userBox.height);
    assert.equal(caretBox.height, 22);
    assert.ok(Math.abs(caretBox.y - userBox.y) < 0.1);
    assert.ok(Math.abs(labelBox.y + labelBox.height - caretBox.y) < 0.1);
    assert.ok(Math.abs(labelBox.x - caretBox.x) < 0.1);
    assert.deepEqual(
      await page.evaluate(() => {
        const editor = window.presenceEditor.editor;
        return {
          selection: editor.getSelection(),
          position: editor.getScrolledVisiblePosition({
            lineNumber: 2,
            column: 16,
          }),
        };
      }),
      before,
    );

    const row = (name: string) =>
      page.getByRole('treeitem', {name, exact: true});
    const marker = (name: string) =>
      page.getByRole('img', {name: new RegExp(`^${name}:`)});
    await marker('Alice').waitFor();
    assert.equal(
      await row('body.ts').locator('.project-tree-agent').count(),
      1,
    );
    assert.equal(
      await marker('Alice').evaluate(
        node => getComputedStyle(node).backgroundColor,
      ),
      await alice.evaluate(node => getComputedStyle(node).backgroundColor),
    );
    await page.screenshot({path: '/tmp/code3d-agent-presence.png'});
    await page.evaluate(
      file => window.presenceEditor.switchFile(file),
      originalFile,
    );
    await label.waitFor({state: 'hidden'});
    await row('parts').click();
    await row('housing').waitFor({state: 'detached'});
    assert.equal(await row('parts').locator('.project-tree-agent').count(), 2);
    assert.equal(await page.locator('.project-tree-agent').count(), 2);
    await page.screenshot({path: '/tmp/code3d-agent-presence-collapsed.png'});
    await row('parts').click();
    await row('housing').waitFor();
    await row('housing').click();
    await row('body.ts').waitFor({state: 'detached'});
    assert.equal(
      await row('housing').locator('.project-tree-agent').count(),
      1,
    );
    assert.equal(await row('rib.ts').locator('.project-tree-agent').count(), 1);
    await row('housing').click();
    await row('body.ts').waitFor();
    assert.equal(
      await row('housing').locator('.project-tree-agent').count(),
      0,
    );
    assert.equal(
      await row('body.ts').locator('.project-tree-agent').count(),
      1,
    );

    await row('parts').click();
    await page.evaluate(() => {
      const editor = window.presenceEditor;
      editor.setAgentCursor('alice', 'Alice renamed', {
        file: '/parts/rib.ts',
        start: 1,
        end: 1,
      });
    });
    await marker('Alice renamed').waitFor();
    assert.equal(await row('parts').getAttribute('aria-expanded'), 'false');
    assert.equal(
      await page.evaluate(() => window.presenceEditor.currentFile()),
      originalFile,
    );
    await row('parts').click();
    assert.equal(await row('rib.ts').locator('.project-tree-agent').count(), 2);
    await page.evaluate(() => window.presenceEditor.removeAgentCursor('bob'));
    await marker('Bob').waitFor({state: 'detached'});
    assert.equal(await row('rib.ts').locator('.project-tree-agent').count(), 1);
    await page.evaluate(() =>
      window.presenceEditor.deleteFile('/parts/rib.ts'),
    );
    await marker('Alice renamed').waitFor({state: 'detached'});
    assert.equal(await page.locator('.project-tree-agent').count(), 0);
    assert.deepEqual(errors, []);
  },
);
