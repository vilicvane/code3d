import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

declare const window: Window & {
  presenceEditor: import('../../src/editor.ts').CodeEditor;
  presenceProject: import('../../src/agent/project-session.ts').AgentProjectSession;
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

test(
  'agent selections and empty carets survive automatic formatting, undo, redo and manual formatting',
  {timeout: 90_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1440, height: 900},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.presenceEditor = codeEditor; window.presenceProject = agentProject;\n',
      });
    });
    await page.clock.install();
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    const file = '/formatted-agent.ts';
    const source =
      '// 模型 😀\r\nimport{box}from"@code3d/core";const first=box(10,6,8);const second=box(10,6,8);const label="模型 😀";export default first;';
    const setup = await page.evaluate(
      async ({file, source}) => {
        const project = window.presenceProject;
        const results = [];
        results.push(
          await project.handle('alpha', 'Alpha', {
            operation: 'apply',
            input: {
              files: [{path: file, version: null, content: source}],
              cursor: {file, regex: 'const first=(box\\(10,6,8\\))'},
            },
          }),
        );
        for (const [id, regex] of [
          ['beta', 'const second=(box\\(10,6,8\\))'],
          ['caret', 'const second=()(?:box)'],
          ['string', 'const label=("模型 😀")'],
        ])
          results.push(
            await project.handle(id, id, {
              operation: 'apply',
              input: {cursor: {file, regex}},
            }),
          );
        const editor = window.presenceEditor;
        editor.switchFile(file);
        const model = editor.editor.getModel()!;
        editor.editor.setPosition(
          model.getPositionAt(source.indexOf('box(10')),
        );
        const start = source.indexOf('10,');
        const accepted = editor.applySourceEdits(
          editor.sourceVersion(),
          [
            {
              sourceRef: {file, start, end: start + 2},
              expectedText: '10',
              text: '12',
            },
          ],
          {undoGroup: 'format-agent-test'},
        );
        await editor.formatPendingToolEdits();
        return {responses: results.map(result => result.ok), accepted};
      },
      {file, source},
    );
    assert.deepEqual(setup, {
      responses: [true, true, true, true],
      accepted: true,
    });
    const state = () =>
      page.evaluate(file => {
        const editor = window.presenceEditor;
        const source = editor.fileState(file)!.content;
        const cursors = Object.fromEntries(
          ['alpha', 'beta', 'caret', 'string'].map(id => {
            const cursor = editor.agentCursor(id);
            return [
              id,
              {...cursor, text: cursor.ref && editor.readSource(cursor.ref)},
            ];
          }),
        );
        return {source, cursors, user: editor.cursorSource()};
      }, file);
    const formatted = await state();
    assert.ok(
      Object.values(formatted.cursors).every(cursor => !cursor.invalid),
    );
    assert.equal(formatted.cursors.alpha.text, 'box(12, 6, 8)');
    assert.equal(formatted.cursors.beta.text, 'box(10, 6, 8)');
    assert.equal(formatted.cursors.string.text, "'模型 😀'");
    assert.equal(formatted.cursors.caret.text, '');
    assert.equal(
      formatted.cursors.caret.ref!.start,
      formatted.source.indexOf('box(10'),
    );
    assert.equal(formatted.user!.offset, formatted.source.indexOf('box(12'));
    await page.evaluate(() => window.presenceEditor.runHistoryAction('undo'));
    const undone = await state();
    assert.equal(undone.source, source);
    assert.equal(undone.cursors.alpha.text, 'box(10,6,8)');
    assert.equal(undone.cursors.beta.text, 'box(10,6,8)');
    assert.equal(undone.cursors.caret.text, '');
    assert.equal(undone.cursors.string.text, '"模型 😀"');
    await page.evaluate(() => window.presenceEditor.runHistoryAction('redo'));
    const redone = await state();
    assert.equal(redone.source, formatted.source);
    assert.deepEqual(redone.cursors, formatted.cursors);
    // CLI follow-up observation must use the rebased cursor without a new regex.
    const observed = await page.evaluate(() =>
      window.presenceProject.handle('alpha', 'Alpha', {
        operation: 'apply',
        input: {type: true},
      }),
    );
    assert.equal(observed.ok, true);
    assert.match(JSON.stringify(observed), /Solid/);

    const manual = await page.evaluate(async () => {
      const file = '/manual-format-agent.ts';
      const source = 'import{box}from"@code3d/core";export default box(2,3,4);';
      const editor = window.presenceEditor;
      const response = await window.presenceProject.handle('manual', 'Manual', {
        operation: 'apply',
        input: {
          files: [{path: file, version: null, content: source}],
          cursor: {file, regex: '(box\\(2,3,4\\))'},
        },
      });
      editor.switchFile(file);
      await editor.editor.getAction('editor.action.formatDocument')!.run();
      const cursor = editor.agentCursor('manual');
      return {
        ok: response.ok,
        invalid: cursor.invalid,
        text: cursor.ref && editor.readSource(cursor.ref),
      };
    });
    assert.deepEqual(manual, {ok: true, invalid: false, text: 'box(2, 3, 4)'});

    // Relative activity ages on a timer, without changing the real cursor position.
    const now = new Date();
    await page.clock.setSystemTime(now);
    await page.evaluate(
      ({file, at}) => {
        window.presenceEditor.switchFile(file);
        window.presenceEditor.setAgentActivity('alpha', at);
      },
      {file, at: now.toISOString()},
    );
    const activity = page
      .locator('.agent-cursor-label')
      .filter({hasText: 'Alpha'})
      .locator('time');
    assert.equal(await activity.textContent(), 'just now');
    await page.clock.setSystemTime(new Date(now.getTime() + 120_000));
    await page.clock.fastForward(10_000);
    assert.equal(await activity.textContent(), '2m ago');
    assert.equal(await activity.getAttribute('datetime'), now.toISOString());
    assert.match((await activity.getAttribute('title'))!, /^Last active /);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await page.screenshot({path: '/tmp/code3d-agent-feedback-cursor.png'});
    assert.deepEqual((await state()).cursors, formatted.cursors);
    assert.deepEqual(errors, []);
  },
);
