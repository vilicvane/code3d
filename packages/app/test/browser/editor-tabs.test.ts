import assert from 'node:assert/strict';
import {after, before, test, type TestContext} from 'node:test';
import {chromium, type Browser, type Page} from 'playwright-core';

declare const window: Window & {
  tabsApp: {
    codeEditor: import('../../src/editor.ts').CodeEditor;
    viewport: import('../../src/viewport.ts').ModelViewport;
    agentProject: import('../../src/agent/project-session.ts').AgentProjectSession;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
    runModel: () => Promise<void>;
  };
  tabModel: import('monaco-editor/editor').editor.ITextModel;
  resumeCompile?: () => void;
  pendingCompile?: Promise<void>;
};

const source =
  "import {box} from '@code3d/core';\nexport default box(10, 6, 8);\n";
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
    viewport: {width: 1440, height: 900},
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/src/project/default-project.ts*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const defaultProject = ${JSON.stringify({files: [{path: '/model.ts', source}]})};`,
    }),
  );
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.tabsApp = {codeEditor, viewport, agentProject, compiler, runModel};\n',
    });
  });
  await page.goto(process.env.CODE3D_TEST_URL!);
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
  return page;
}

async function expectEmpty(page: Page): Promise<void> {
  await page.locator('#editor-empty-state').waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('#viewport-status')?.getAttribute('data-state') ===
      'ready',
  );
  assert.deepEqual(
    await page.evaluate(() => {
      const {codeEditor, viewport} = window.tabsApp;
      return {
        file: codeEditor.currentFile(),
        tabs: codeEditor.openedFiles(),
        model: codeEditor.editor.getModel(),
        cursor: codeEditor.cursorSource(),
        selection: codeEditor.selectedSource(),
        geometry: viewport.hasRenderableGeometry(),
      };
    }),
    {
      file: undefined,
      tabs: [],
      model: null,
      cursor: undefined,
      selection: undefined,
      geometry: false,
    },
  );
  assert.equal(await page.locator('.editor-tab').count(), 0);
  assert.equal(
    await page.locator('#project-tree [aria-selected="true"]').count(),
    0,
  );
  assert.equal(await page.locator('.viewport-canvas').isVisible(), false);
  assert.equal(await page.locator('#error-bar').isVisible(), false);
  assert.equal(new URL(page.url()).hash, '#/');
}

test(
  'the last tab closes and reopening preserves edits, selection and undo history',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page.evaluate(() => {
      const {codeEditor} = window.tabsApp;
      window.tabModel = codeEditor.editor.getModel()!;
      codeEditor.editor.setPosition({lineNumber: 2, column: 20});
      codeEditor.editor.trigger('test', 'type', {text: '2'});
    });
    const selection = await page.evaluate(() =>
      window.tabsApp.codeEditor.editor.getSelection(),
    );
    await page
      .getByRole('button', {name: 'Close /model.ts', exact: true})
      .click();
    await expectEmpty(page);
    assert.deepEqual(
      await page.evaluate(async () => {
        const {codeEditor, agentProject} = window.tabsApp;
        codeEditor.runHistoryAction('undo');
        codeEditor.runHistoryAction('redo');
        await agentProject.flush();
        return {
          content: codeEditor.fileState('/model.ts')!.content,
          disposed: window.tabModel.isDisposed(),
          context: await agentProject.handle('test', 'Test', {
            operation: 'context',
          }),
        };
      }),
      {
        content: source.replace('box(10', 'box(210'),
        disposed: false,
        context: {ok: true, data: {file: null, cursor: null, revision: 2}},
      },
    );
    await page.getByRole('treeitem', {name: 'model.ts', exact: true}).click();
    assert.equal(await page.locator('#editor-empty-state').isVisible(), false);
    assert.equal(
      await page.evaluate(
        () => window.tabsApp.codeEditor.editor.getModel() === window.tabModel,
      ),
      true,
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.tabsApp.codeEditor.editor.getSelection(),
      ),
      selection,
    );
    await page.evaluate(() =>
      window.tabsApp.codeEditor.runHistoryAction('undo'),
    );
    assert.equal(
      await page.evaluate(
        () => window.tabsApp.codeEditor.fileState('/model.ts')!.content,
      ),
      source,
    );
    await page.locator('.viewport-canvas').waitFor();
  },
);

test(
  'empty tabs survive refresh and history, and project operations do not require an active file',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page
      .getByRole('button', {name: 'Close /model.ts', exact: true})
      .click();
    await expectEmpty(page);
    await page.reload();
    await expectEmpty(page);
    await page.getByRole('treeitem', {name: 'model.ts', exact: true}).click();
    // Reopening after reload reads the file asynchronously before pushing its route.
    await page.waitForURL('**/#/file/model.ts');
    await page.goBack();
    await expectEmpty(page);
    await page.goForward();
    await page
      .getByRole('button', {name: 'Close /model.ts', exact: true})
      .click();
    await page.evaluate(() => {
      const {codeEditor} = window.tabsApp;
      codeEditor.renameFile('/model.ts', '/renamed.ts');
      codeEditor.applyFiles([
        {path: '/parts/item.ts', content: 'export const size = 3;'},
      ]);
      codeEditor.replaceDirectory(
        {files: [{path: '/parts/new.ts', source: 'export const size = 4;'}]},
        '/parts',
      );
      codeEditor.deleteFile('/renamed.ts');
    });
    await expectEmpty(page);
    await page
      .getByRole('button', {name: 'New file', exact: true})
      .click({trial: true});
    await page.getByRole('button', {name: 'New file', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'New file', exact: true});
    const directory = (await dialog.locator('p').textContent())!.slice(3);
    const newPath = directory === '/' ? '/new.ts' : directory + '/new.ts';
    await dialog.getByRole('textbox', {name: 'Name'}).fill('new.ts');
    await dialog.getByRole('button', {name: 'Create', exact: true}).click();
    await page.waitForFunction(
      path => window.tabsApp.codeEditor.currentFile() === path,
      newPath,
    );
    assert.equal(await page.locator('#editor-empty-state').isVisible(), false);
  },
);

test(
  'closing inactive and neighboring tabs keeps the active model and deletion opens its replacement',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page.evaluate(() => {
      const {codeEditor} = window.tabsApp;
      codeEditor.createFile('/one.ts', '// one');
      codeEditor.createFile('/two.ts', '// two');
    });
    await page
      .getByRole('button', {name: 'Close /one.ts', exact: true})
      .click();
    assert.equal(
      await page.evaluate(() => window.tabsApp.codeEditor.currentFile()),
      '/two.ts',
    );
    await page
      .getByRole('button', {name: 'Close /two.ts', exact: true})
      .click();
    assert.equal(
      await page.evaluate(() => window.tabsApp.codeEditor.currentFile()),
      '/model.ts',
    );
    await page.evaluate(() =>
      window.tabsApp.codeEditor.deleteFile('/model.ts'),
    );
    const replacement = await page.evaluate(() => ({
      active: window.tabsApp.codeEditor.currentFile(),
      opened: window.tabsApp.codeEditor.openedFiles(),
      files: window.tabsApp.codeEditor.filePaths(),
    }));
    assert.ok(
      replacement.active && replacement.files.includes(replacement.active),
    );
    assert.deepEqual(replacement.opened, [replacement.active]);
    await page
      .getByRole('button', {name: `Close ${replacement.active}`, exact: true})
      .click();
    await expectEmpty(page);
  },
);

test(
  'a compilation finishing after the last tab closes cannot restore its preview',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page.evaluate(() => {
      const {compiler, runModel} = window.tabsApp;
      const compile = compiler.compile.bind(compiler);
      compiler.compile = async (...args) => {
        const module = await compile(...args);
        await new Promise<void>(resolve => {
          window.resumeCompile = resolve;
        });
        return module;
      };
      window.pendingCompile = runModel();
    });
    await page.waitForFunction(() => !!window.resumeCompile);
    await page
      .getByRole('button', {name: 'Close /model.ts', exact: true})
      .click();
    await page.evaluate(async () => {
      window.resumeCompile!();
      await window.pendingCompile;
    });
    await expectEmpty(page);
  },
);

for (const outcome of ['success', 'error'] as const) {
  test(
    `a delayed ${outcome} from another file cannot replace the active empty preview`,
    {timeout: 90_000},
    async t => {
      const page = await open(t);
      await page.evaluate(outcome => {
        const {compiler, runModel} = window.tabsApp;
        const compile = compiler.compile.bind(compiler);
        compiler.compile = async (...args) => {
          // Only delay this run; the next file must compile independently.
          compiler.compile = compile;
          const module = await compile(...args);
          await new Promise<void>(resolve => {
            window.resumeCompile = resolve;
          });
          if (outcome === 'error') throw new Error('Old file failed');
          return module;
        };
        window.pendingCompile = runModel();
      }, outcome);
      await page.waitForFunction(() => !!window.resumeCompile);
      await page.evaluate(() =>
        window.tabsApp.codeEditor.createFile('/empty.ts', ''),
      );
      await page.locator('#viewport-status[data-state=ready]').waitFor();
      await page.evaluate(async () => {
        window.resumeCompile!();
        await window.pendingCompile;
      });
      assert.equal(
        await page.evaluate(() => window.tabsApp.codeEditor.currentFile()),
        '/empty.ts',
      );
      assert.equal(
        await page.evaluate(() =>
          window.tabsApp.viewport.hasRenderableGeometry(),
        ),
        false,
      );
      assert.equal(
        await page.locator('#viewport-status').getAttribute('data-state'),
        'ready',
      );
      assert.equal(await page.locator('#error-bar').isVisible(), false);
      assert.equal(
        await page.locator('#viewport-empty-state').isVisible(),
        true,
      );
    },
  );
}
