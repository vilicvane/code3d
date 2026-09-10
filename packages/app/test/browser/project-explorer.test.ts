import assert from 'node:assert/strict';
import {after, before, test, type TestContext} from 'node:test';
import {chromium, type Browser, type Page} from 'playwright-core';

declare const window: Window & {
  explorerAccess: {lists: string[]; reads: string[]};
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
  'file and root menus stay inside the viewport, including after resizing',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page.setViewportSize({width: 1000, height: 360});
    await row(page, 'settings.json').click({button: 'right'});
    const popup = page.getByRole('menu');
    assert.equal(
      await page
        .getByRole('menuitem', {name: 'Rename', exact: true})
        .isEnabled(),
      true,
    );
    const assertMenuVisible = async () => {
      const bounds = await popup.boundingBox();
      assert.ok(bounds);
      const viewport = page.viewportSize()!;
      assert.ok(bounds.x >= 0 && bounds.y >= 0, JSON.stringify(bounds));
      assert.ok(
        bounds.x + bounds.width <= viewport.width,
        JSON.stringify(bounds),
      );
      assert.ok(
        bounds.y + bounds.height <= viewport.height,
        JSON.stringify(bounds),
      );
    };
    await assertMenuVisible();
    await page.setViewportSize({width: 1000, height: 200});
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await assertMenuVisible();
    await page.keyboard.press('End');
    await page.getByRole('menuitem', {name: 'Delete', exact: true}).waitFor();
    assert.ok(await popup.evaluate(element => element.scrollTop > 0));
    await page.keyboard.press('Escape');
    await popup.waitFor({state: 'hidden'});

    const scroll = page.locator('[data-file-tree-virtualized-scroll]');
    await scroll.evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    const bounds = await scroll.boundingBox();
    assert.ok(bounds);
    await page.mouse.click(bounds.x + 20, bounds.y + bounds.height - 12, {
      button: 'right',
    });
    await assertMenuVisible();
    assert.equal(
      await page
        .getByRole('menuitem', {name: 'Rename', exact: true})
        .isDisabled(),
      true,
    );
    await page.mouse.click(990, 90);
    await popup.waitFor({state: 'hidden'});
  },
);

test(
  'horizontal scrolling leaves the final virtual row fully visible',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    const names = Array.from(
      {length: 80},
      (_, index) =>
        `z-${String(index).padStart(3, '0')}-a-long-file-name-that-needs-horizontal-scrolling.json`,
    );
    await page.evaluate(async names => {
      const {projectFileSystem, projectDirectory} = window.explorerApp;
      await Promise.all(
        names.map(name => projectFileSystem.writeFile('/' + name, '{}')),
      );
      await projectDirectory.refresh();
    }, names);
    await page.evaluate(() => document.fonts.ready);
    const scroll = page.locator('[data-file-tree-virtualized-scroll]');
    const lastName = names.at(-1)!;
    const assertLastRowVisible = async () => {
      await row(page, lastName).waitFor();
      // Let Pierre process the scroll event and clamp its virtual window first.
      await page.evaluate(
        () =>
          new Promise<void>(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const bounds = await scroll.evaluate((element, lastName) => {
        const lastRow = element.querySelector<HTMLElement>(
          `[data-item-path="${lastName}"]`,
        )!;
        const rect = element.getBoundingClientRect();
        const rowRect = lastRow.getBoundingClientRect();
        return {
          top: rowRect.top,
          bottom: rowRect.bottom,
          visibleTop: rect.top + element.clientTop,
          visibleBottom: rect.top + element.clientTop + element.clientHeight,
        };
      }, lastName);
      assert.ok(bounds.top >= bounds.visibleTop - 1, JSON.stringify(bounds));
      assert.ok(
        bounds.bottom <= bounds.visibleBottom + 1,
        JSON.stringify(bounds),
      );
    };
    assert.ok(
      await scroll.evaluate(
        element => element.scrollWidth > element.clientWidth,
      ),
    );
    await scroll.evaluate(element => {
      element.scrollLeft = element.scrollWidth;
      element.scrollTop = element.scrollHeight;
    });
    await assertLastRowVisible();
    await row(page, lastName).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    await assertLastRowVisible();
    await row(page, lastName).click();
    await active(page, '/' + lastName);
    const search = page.locator('[data-file-tree-search-input]');
    await search.fill('README.md');
    await row(page, 'README.md').waitFor();
    assert.equal(
      await scroll.evaluate(
        element => element.scrollWidth > element.clientWidth,
      ),
      false,
    );
    await search.fill('');
    await scroll.evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    await assertLastRowVisible();
    await page.setViewportSize({width: 780, height: 700});
    await scroll.evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    await assertLastRowVisible();
    await search.press('Escape');
    await scroll.evaluate(element => {
      element.scrollTop = 0;
    });
    await row(page, 'src').click();
    await row(page, 'part.ts').click();
    await active(page, '/src/part.ts');
    await scroll.evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    await assertLastRowVisible();
    const blank = await scroll.evaluate((element, lastName) => {
      const lastRow = element.querySelector<HTMLElement>(
        `[data-item-path="${lastName}"]`,
      )!;
      const rect = element.getBoundingClientRect();
      const rowRect = lastRow.getBoundingClientRect();
      return {
        height:
          rect.top + element.clientTop + element.clientHeight - rowRect.bottom,
        rowHeight: rowRect.height,
        x: rect.left + 20,
        y: rowRect.bottom + rowRect.height / 2,
      };
    }, lastName);
    assert.ok(
      Math.abs(blank.height - blank.rowHeight) <= 1,
      JSON.stringify(blank),
    );
    await page.mouse.click(blank.x, blank.y, {button: 'right'});
    assert.equal(
      await page
        .getByRole('menuitem', {name: 'Rename', exact: true})
        .isDisabled(),
      true,
    );
    await page.getByRole('menuitem', {name: 'New file', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'New file', exact: true});
    await dialog.getByRole('textbox', {name: 'Name'}).fill('root-note.txt');
    await dialog.getByRole('button', {name: 'Create', exact: true}).click();
    await active(page, '/root-note.txt');
    assert.equal(
      await page.evaluate(
        async () =>
          await window.explorerApp.projectFileSystem.stat('/src/root-note.txt'),
      ),
      undefined,
    );
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
      await fs.initialize(async () => {});
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

test(
  'directory names load on expansion and search finds files in unopened folders',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page.evaluate(async () => {
      const {projectFileSystem: fs, projectDirectory} = window.explorerApp;
      await fs.writeFile(
        '/unopened/deep/needle.ts',
        'export const needle = 1;',
      );
      await fs.writeFile('/unrelated/deep/other.ts', 'export const other = 2;');
      const access = (window.explorerAccess = {
        lists: [] as string[],
        reads: [] as string[],
      });
      const list = fs.list.bind(fs),
        read = fs.readFile.bind(fs);
      fs.list = path => {
        access.lists.push(path);
        return list(path);
      };
      fs.readFile = path => {
        access.reads.push(path);
        return read(path);
      };
      await projectDirectory.refresh();
    });
    assert.deepEqual(await page.evaluate(() => window.explorerAccess.lists), [
      '/',
    ]);
    assert.deepEqual(
      await page.evaluate(() =>
        window.explorerApp.codeEditor.project().files.map(file => file.path),
      ),
      ['/model.ts'],
    );
    await row(page, 'unopened').click();
    // Compact chains can include already expanded ancestors in one row.
    await page.getByRole('treeitem', {name: /deep/}).waitFor();
    assert.equal(
      await page.evaluate(() =>
        window.explorerAccess.lists.some(path => path.startsWith('/unrelated')),
      ),
      false,
    );
    assert.equal(
      await page.evaluate(() =>
        window.explorerAccess.reads.some(path => path.startsWith('/unopened')),
      ),
      false,
    );
    await page.getByRole('button', {name: 'Search files', exact: true}).click();
    await page.locator('[data-file-tree-search-input]').fill('other.ts');
    await row(page, 'other.ts').waitFor();
    assert.equal(
      await page.evaluate(() =>
        window.explorerAccess.reads.includes('/unrelated/deep/other.ts'),
      ),
      false,
    );
    await row(page, 'other.ts').click();
    await active(page, '/unrelated/deep/other.ts');
  },
);

test(
  'VS Code default excludes keep npm sources and workspace metadata visible and read-only',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page.evaluate(async () => {
      const {projectFileSystem: fs, projectDirectory} = window.explorerApp;
      for (const name of ['.git', '.svn', '.hg'])
        await fs.createDirectory('/' + name);
      for (const name of ['.DS_Store', 'Thumbs.db', 'model.ts.crswap'])
        await fs.writeFile('/' + name, 'hidden');
      await fs.writeFile('/.vscode/settings.json', '{}');
      await fs.writeFile('/.code3d/state.json', '{}');
      await fs.writeFile(
        '/node_modules/demo/index.ts',
        'export const answer = 42;',
      );
      await fs.writeFile('/node_modules/demo/.DS_Store', 'hidden');
      await fs.writeFile('/.gitignore', 'node_modules\n.vscode\n');
      await projectDirectory.refresh();
    });
    for (const name of [
      '.git',
      '.svn',
      '.hg',
      '.DS_Store',
      'Thumbs.db',
      'model.ts.crswap',
    ]) {
      assert.equal(await row(page, name).count(), 0, name);
    }
    await row(page, '.gitignore').waitFor();
    await row(page, '.vscode').waitFor();
    await row(page, 'node_modules').click();
    await page.getByRole('treeitem', {name: /demo/}).click();
    await row(page, 'index.ts').click();
    await active(page, '/node_modules/demo/index.ts');
    assert.equal(await row(page, '.DS_Store').count(), 0);
    assert.equal(
      await page.evaluate(
        () => window.explorerApp.codeEditor.editor.getRawOptions().readOnly,
      ),
      true,
    );
    await row(page, 'index.ts').click({button: 'right'});
    assert.equal(
      await page
        .getByRole('menuitem', {name: 'Delete', exact: true})
        .isDisabled(),
      true,
    );
    await page.keyboard.press('Escape');
    await row(page, '.code3d').click();
    await row(page, 'state.json').click();
    await active(page, '/.code3d/state.json');
    assert.equal(
      await page.evaluate(
        () => window.explorerApp.codeEditor.editor.getRawOptions().readOnly,
      ),
      true,
    );
  },
);

test(
  'compiled dependencies stay unopened until a source interaction needs their document',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page.evaluate(async () => {
      const {codeEditor, agentProject} = window.explorerApp;
      codeEditor.applyFiles([
        {
          path: '/model.ts',
          content:
            "import {box} from '@code3d/core';\nimport {size} from './src/part.ts';\nexport default box(size, 2, 3);\n",
        },
      ]);
      await agentProject.flush();
    });
    await page.waitForFunction(() =>
      window.explorerApp.codeEditor
        .readSource({file: '/model.ts', start: 0, end: 1000})
        .includes('./src/part.ts'),
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    await page.waitForFunction(() => {
      const editor = window.explorerApp.codeEditor;
      return (
        editor.editor.getValue().includes('./src/part.ts') &&
        document
          .querySelector('#viewport-status')
          ?.getAttribute('data-state') === 'ready'
      );
    });
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.codeEditor.fileState('/src/part.ts'),
      ),
      undefined,
    );
    const result = await page.evaluate(async () => {
      const {codeEditor, agentProject} = window.explorerApp;
      const ref = {file: '/src/part.ts', start: 20, end: 21};
      const before = codeEditor.readSource(ref);
      const edited = codeEditor.applySourceEdits(codeEditor.sourceVersion(), [
        {sourceRef: ref, expectedText: '3', text: '6'},
      ]);
      codeEditor.revealSource(ref);
      await agentProject.flush();
      return {
        before,
        edited,
        contents: codeEditor.fileState(ref.file)?.content,
      };
    });
    assert.deepEqual(result, {
      before: '3',
      edited: true,
      contents: 'export const size = 6;\n',
    });
    await active(page, '/src/part.ts');
  },
);

test(
  'package success notices expire independently without hiding newer work or other errors',
  {timeout: 60_000},
  async t => {
    const page = await open(t);
    const time = new Date('2026-01-01T00:00:00Z');
    await page.clock.install({time});
    await page.clock.pauseAt(time.getTime() + 60_000);
    const status = page.getByRole('status', {name: 'Package installation'});
    await page.evaluate(() =>
      window.explorerApp.projectDirectory.setPackageProgress({
        directory: '/a',
        state: 'ready',
        message: 'Packages installed',
      }),
    );
    assert.equal(await status.isVisible(), true);
    await page.clock.runFor(2000);
    await page.evaluate(() => {
      const tree = window.explorerApp.projectDirectory;
      tree.setPackageProgress({
        directory: '/a',
        state: 'busy',
        message: 'Downloading newer package',
      });
      tree.setPackageProgress({
        directory: '/b',
        state: 'error',
        message: 'Package not found',
      });
      tree.setPackageProgress({
        directory: '/c',
        state: 'ready',
        message: 'Dependencies updated',
      });
    });
    await page.clock.runFor(2000);
    assert.match(await status.innerText(), /Downloading newer package/);
    assert.match(await status.innerText(), /Package not found/);
    assert.match(await status.innerText(), /Dependencies updated/);
    assert.equal(await status.getAttribute('aria-busy'), 'true');
    await page.clock.runFor(1100);
    assert.doesNotMatch(await status.innerText(), /Dependencies updated/);
    assert.match(await status.innerText(), /Downloading newer package/);
    assert.match(await status.innerText(), /Package not found/);
    await page.evaluate(() =>
      window.explorerApp.projectDirectory.setPackageProgress({
        directory: '/a',
        state: 'ready',
        message: 'Packages installed',
      }),
    );
    await page.clock.runFor(3100);
    assert.equal(await status.getAttribute('aria-busy'), 'false');
    assert.match(await status.innerText(), /Package not found/);
    assert.doesNotMatch(await status.innerText(), /Packages installed/);
    await page.evaluate(() =>
      window.explorerApp.projectDirectory.setPackageProgress({
        directory: '/b',
        state: 'ready',
        message: 'Packages ready',
      }),
    );
    await page.clock.runFor(3100);
    assert.equal(await status.isVisible(), false);
  },
);
