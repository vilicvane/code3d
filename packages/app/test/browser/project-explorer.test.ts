import assert from 'node:assert/strict';
import {after, before, test, type TestContext} from 'node:test';
import {chromium, type Browser, type Page} from 'playwright-core';

declare const window: Window & {
  explorerApp: {
    codeEditor: import('../../src/editor.ts').CodeEditor;
    projectFileSystem: import('../../src/project/filesystem.ts').ProjectFileSystem;
    agentProject: import('../../src/agent/project-session.ts').AgentProjectSession;
    projectDirectory: import('../../src/ui/project-tree.ts').ProjectTree;
    activateProjectFile(path: string): Promise<void>;
  };
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
    viewport: {width: 1440, height: 900},
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const files = [
    {
      path: '/model.ts',
      source:
        "import {box} from '@code3d/core';\nexport default box(10, 6, 8);\n",
    },
    {path: '/src/part.ts', source: 'export const size = 3;\n'},
    {path: '/README.md', source: '# Project\n'},
    {path: '/settings.json', source: '{"size": 3}\n'},
  ];
  await page.route('**/src/project/default-project.ts*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const defaultProject = ${JSON.stringify({files})};`,
    }),
  );
  await page.route('**/src/project/bundled-examples.ts*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export const bundledExamples = {directory:"/examples", revision:"explorer-test", files:[]};',
    }),
  );
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.explorerApp = {codeEditor, projectFileSystem, agentProject, projectDirectory, activateProjectFile};\n',
    });
  });
  await page.goto(process.env.CODE3D_TEST_URL!);
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
  await page.getByRole('treeitem', {name: 'model.ts', exact: true}).waitFor();
  return page;
}

const row = (page: Page, name: string) =>
  page.getByRole('treeitem', {name, exact: true});
async function active(page: Page, path: string | undefined): Promise<void> {
  await page.waitForFunction(
    path =>
      !!window.explorerApp &&
      window.explorerApp.codeEditor.currentFile() === path,
    path,
  );
}
async function create(
  page: Page,
  kind: 'file' | 'folder',
  name: string,
): Promise<void> {
  await page.getByRole('button', {name: `New ${kind}`, exact: true}).click();
  const dialog = page.getByRole('dialog', {name: `New ${kind}`, exact: true});
  await dialog.getByRole('textbox', {name: 'Name'}).fill(name);
  await dialog.getByRole('button', {name: 'Create', exact: true}).click();
  await row(page, name).waitFor();
}
async function menu(page: Page, name: string, command: string): Promise<void> {
  await row(page, name).click({button: 'right'});
  await page.getByRole('menuitem', {name: command, exact: true}).click();
}

test(
  'text files open with their language, save, and survive a routed reload and empty tabs',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await row(page, 'README.md').click();
    await active(page, '/README.md');
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.codeEditor.editor.getModel()!.getLanguageId(),
      ),
      'markdown',
    );
    await page.evaluate(async () => {
      const fs = window.explorerApp.projectFileSystem;
      await fs.writeFile('/external.txt', 'Visible after refresh');
      await fs.remove('/README.md');
    });
    await page
      .getByRole('button', {name: 'Refresh files', exact: true})
      .click();
    await row(page, 'external.txt').waitFor();
    assert.equal(await row(page, 'README.md').count(), 0);
    // The open document remains editable after external deletion; saving recreates it.
    await page.evaluate(async () => {
      const {codeEditor, agentProject} = window.explorerApp;
      codeEditor.editor.setPosition({lineNumber: 2, column: 1});
      codeEditor.editor.trigger('test', 'type', {text: 'Saved text\n'});
      await agentProject.flush();
    });
    await row(page, 'README.md').waitFor();
    await page.reload();
    await active(page, '/README.md');
    assert.equal(
      await page.evaluate(
        () => window.explorerApp.codeEditor.fileState('/README.md')!.content,
      ),
      '# Project\nSaved text\n',
    );
    await page
      .getByRole('button', {name: 'Close /README.md', exact: true})
      .click();
    await active(page, undefined);
    await row(page, 'README.md').click();
    await active(page, '/README.md');
    await row(page, 'settings.json').click();
    await active(page, '/settings.json');
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.codeEditor.editor.getModel()!.getLanguageId(),
      ),
      'json',
    );
    assert.equal(await page.locator('.viewport-canvas').isVisible(), false);
    await create(page, 'file', 'notes.txt');
    await active(page, '/notes.txt');
  },
);

test(
  'empty directories and binary copies persist, with non-destructive collision handling',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await create(page, 'folder', 'assets');
    await page.evaluate(async () => {
      const {projectFileSystem, projectDirectory} = window.explorerApp;
      await projectFileSystem.createDirectory('/assets/empty');
      await projectFileSystem.writeFile(
        '/assets/data.bin',
        new Uint8Array([0, 255, 1, 128]),
      );
      await projectDirectory.refresh();
    });
    await row(page, 'assets').click();
    await row(page, 'data.bin').click();
    await page
      .getByRole('status')
      .filter({hasText: 'UTF-8 text file'})
      .waitFor();
    await menu(page, 'assets', 'Copy');
    await menu(page, 'model.ts', 'Paste');
    await row(page, 'assets copy').waitFor();
    assert.deepEqual(
      await page.evaluate(async () => {
        const fs = window.explorerApp.projectFileSystem;
        return {
          bytes: [...(await fs.readFile('/assets copy/data.bin'))!],
          empty: (await fs.stat('/assets copy/empty'))?.kind,
        };
      }),
      {bytes: [0, 255, 1, 128], empty: 'directory'},
    );
    await page.reload();
    await row(page, 'assets copy').waitFor();
    await page.evaluate(async () => {
      const {agentProject, projectFileSystem} = window.explorerApp;
      try {
        await agentProject.changeEntries({
          kind: 'move',
          entries: [{from: '/README.md', to: '/settings.json'}],
        });
        throw new Error('Expected collision rejection');
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes('already exists')
        )
          throw error;
      }
      if (!(await projectFileSystem.stat('/README.md')))
        throw new Error('Source disappeared');
    });
  },
);

test(
  'folder rename, cut and drag keep open documents, tabs and agent locations aligned',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await row(page, 'src').click();
    await row(page, 'part.ts').click();
    await active(page, '/src/part.ts');
    await page.evaluate(() =>
      window.explorerApp.codeEditor.setAgentCursor(
        'test',
        'Test agent',
        {file: '/src/part.ts', start: 13, end: 13},
        0,
      ),
    );
    await row(page, 'src').click();
    await page.keyboard.press('F2');
    await page.locator('[data-item-rename-input]').fill('parts');
    await page.keyboard.press('Enter');
    await active(page, '/parts/part.ts');
    assert.equal(
      await page
        .getByRole('button', {name: 'Close /parts/part.ts', exact: true})
        .count(),
      1,
    );
    assert.equal(
      await page.evaluate(
        () => window.explorerApp.codeEditor.agentCursor('test').ref?.file,
      ),
      '/parts/part.ts',
    );
    await row(page, 'parts').click({button: 'right'});
    await page.getByRole('menuitem', {name: 'Cut', exact: true}).click();
    // Make the destination through the filesystem to keep this assertion about move semantics.
    await page.evaluate(async () => {
      await window.explorerApp.projectFileSystem.createDirectory('/target');
      await window.explorerApp.projectDirectory.refresh();
    });
    await menu(page, 'target', 'Paste');
    await active(page, '/target/parts/part.ts');
    await page.waitForFunction(
      () =>
        document.querySelector('#project-tree')!.getAttribute('aria-busy') !==
        'true',
    );
    await row(page, 'README.md').dragTo(row(page, 'target / parts'));
    await page.waitForFunction(
      () =>
        document.querySelector('#project-tree')!.getAttribute('aria-busy') !==
        'true',
    );
    assert.ok(
      await page.evaluate(
        async () =>
          await window.explorerApp.projectFileSystem.stat(
            '/target/parts/README.md',
          ),
      ),
    );
    await page.reload();
    await active(page, '/target/parts/part.ts');
    await row(page, 'README.md').waitFor();
  },
);

test(
  'failed moves restore the tree and a project may remain empty after deleting its files',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page.evaluate(() => {
      const fs = window.explorerApp.projectFileSystem;
      const rename = fs.rename.bind(fs);
      fs.rename = async (from, to) => {
        fs.rename = rename;
        throw new Error(`Write denied: ${from} to ${to}`);
      };
    });
    await row(page, 'model.ts').click();
    await page.keyboard.press('F2');
    await page.locator('[data-item-rename-input]').fill('renamed.ts');
    await page.keyboard.press('Enter');
    await page.getByRole('status').filter({hasText: 'Write denied'}).waitFor();
    await row(page, 'model.ts').waitFor();
    assert.equal(await row(page, 'renamed.ts').count(), 0);
    await active(page, '/model.ts');
    await page.evaluate(async () => {
      const {agentProject} = window.explorerApp;
      await agentProject.changeEntries({
        kind: 'remove',
        paths: ['/model.ts', '/src', '/README.md', '/settings.json'],
      });
    });
    await active(page, undefined);
    await page.reload();
    await page.locator('#editor-empty-state').waitFor();
    assert.equal(
      await page.locator('#project-tree').getByRole('treeitem').count(),
      0,
    );
    await create(page, 'file', 'main.ts');
    await active(page, '/main.ts');
  },
);

test(
  'directory handles preserve binary data and empty folders through copy and rename',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    const result = await page.evaluate(async () => {
      const filesystemUrl = '/src/project/filesystem.ts';
      const operationsUrl = '/src/project/file-operations.ts';
      const {openDirectoryProjectFileSystem} = (await import(
        filesystemUrl
      )) as typeof import('../../src/project/filesystem.ts');
      const {copyProjectEntry} = (await import(
        operationsUrl
      )) as typeof import('../../src/project/file-operations.ts');
      const fs = await openDirectoryProjectFileSystem(
        await navigator.storage.getDirectory(),
      );
      await fs.initialize({files: []});
      await fs.createDirectory('/assets/empty');
      await fs.writeFile('/assets/data.bin', new Uint8Array([0, 255, 128, 42]));
      await fs.rename('/assets', '/renamed');
      await copyProjectEntry(fs, '/renamed', '/copied');
      const result = {
        old: await fs.stat('/assets'),
        renamed: [...(await fs.readFile('/renamed/data.bin'))!],
        copied: [...(await fs.readFile('/copied/data.bin'))!],
        empty: (await fs.stat('/copied/empty'))?.kind,
      };
      await fs.remove('/renamed');
      await fs.remove('/copied');
      return result;
    });
    assert.deepEqual(result, {
      old: undefined,
      renamed: [0, 255, 128, 42],
      copied: [0, 255, 128, 42],
      empty: 'directory',
    });
  },
);

test(
  'copying and deleting an unopened dependency rebuilds the active model',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page.evaluate(async () => {
      const {codeEditor, agentProject} = window.explorerApp;
      codeEditor.applyFiles([
        {
          path: '/model.ts',
          content:
            "import {box} from '@code3d/core';\nimport {size} from './src/part copy.ts';\nexport default box(size, 2, 3);\n",
        },
      ]);
      await agentProject.flush();
    });
    await page.locator('#viewport-status[data-state="error"]').waitFor();
    await row(page, 'src').click();
    await menu(page, 'part.ts', 'Copy');
    await menu(page, 'src', 'Paste');
    await page.getByText('Ready', {exact: true}).waitFor();
    await active(page, '/model.ts');
    assert.equal(await page.locator('#error-bar').isVisible(), false);
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.codeEditor.fileState('/src/part copy.ts'),
      ),
      undefined,
    );
    // Other CDP clients attached to host Chrome can dismiss native dialogs.
    // Supply the user's answer explicitly while exercising the real menu operation.
    await page.evaluate(() => {
      window.confirm = () => false;
    });
    await menu(page, 'part copy.ts', 'Delete');
    assert.equal(
      await page.evaluate(
        async () =>
          (await window.explorerApp.projectFileSystem.stat('/src/part copy.ts'))
            ?.kind,
      ),
      'file',
    );
    await page.evaluate(() => {
      window.confirm = message => {
        if (!message?.includes('part copy.ts'))
          throw new Error(
            'Expected the delete confirmation to name the selected file.',
          );
        return true;
      };
    });
    await menu(page, 'part copy.ts', 'Delete');
    await page.locator('#viewport-status[data-state="error"]').waitFor();
  },
);

test(
  'search and keyboard clipboard preserve a multi-file selection',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await row(page, 'model.ts').click();
    await page.keyboard.press('Control+f');
    const search = page.locator('#project-tree').getByRole('textbox');
    await search.fill('README');
    await row(page, 'README.md').waitFor();
    assert.equal(await row(page, 'model.ts').count(), 0);
    await page.keyboard.press('Escape');
    await row(page, 'model.ts').waitFor();
    await row(page, 'README.md').click();
    await active(page, '/README.md');
    await row(page, 'settings.json').click({modifiers: ['Control']});
    for (const name of ['README.md', 'settings.json'])
      assert.equal(await row(page, name).getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Control+c');
    await create(page, 'folder', 'copies');
    await row(page, 'copies').click();
    await page.keyboard.press('Control+v');
    await page.waitForFunction(
      () => !document.querySelector('#project-tree')!.hasAttribute('aria-busy'),
    );
    assert.deepEqual(
      await page.evaluate(async () => {
        const fs = window.explorerApp.projectFileSystem;
        const contents = await Promise.all(
          ['/copies/README.md', '/copies/settings.json'].map(path =>
            fs.readFile(path),
          ),
        );
        return contents.map(bytes => bytes && new TextDecoder().decode(bytes));
      }),
      ['# Project\n', '{"size": 3}\n'],
    );
  },
);
