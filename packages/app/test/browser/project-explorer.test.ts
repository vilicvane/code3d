import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {after, before, test, type TestContext} from 'node:test';
import {
  chromium,
  type Browser,
  type Locator,
  type Page,
} from './browser-connection.ts';

declare const window: Window & {
  clearCachePhases: string[];
  releaseExportRead?: () => void;
  restoreProjectWrites?: () => void;
  explorerAccess: {lists: string[]; reads: string[]};
  explorerApp: {
    codeEditor: import('../../src/editor.ts').CodeEditor;
    projectFileSystem: import('../../src/project/filesystem.ts').ProjectFileSystem;
    agentProject: import('../../src/agent/project-session.ts').AgentProjectSession;
    projectDirectory: import('../../src/ui/project-tree.ts').ProjectTree;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
    browserProject: {id: string; name: string} | undefined;
    browserProjects: import('../../src/project/browser-projects.ts').BrowserProjects;
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

async function open(
  t: TestContext,
  examples: {path: string; source: string}[] = [],
): Promise<Page> {
  const context = await browser.newContext({
    viewport: {width: 1440, height: 900},
  });
  t.after(() => context.close());
  context.setDefaultTimeout(15_000);
  const errors: string[] = [];
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (
        ['warning', 'error'].includes(message.type()) &&
        /mobx/i.test(message.text())
      )
        errors.push(message.text());
    });
  });
  const page = await context.newPage();
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
  await context.route('**/src/project/default-project.ts*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const defaultProject = ${JSON.stringify({files})};`,
    }),
  );
  await context.route('**/src/project/bundled-examples.ts*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const bundledExamples = ${JSON.stringify({directory: '/examples', revision: 'explorer-test', files: examples})};`,
    }),
  );
  await context.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.explorerApp = {codeEditor, projectFileSystem, agentProject, projectDirectory, compiler, browserProject, browserProjects, activateProjectFile};\n',
    });
  });
  await page.goto(process.env.CODE3D_TEST_URL!);
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
  await page.getByRole('treeitem', {name: 'model.ts', exact: true}).waitFor();
  return page;
}

const row = (page: Page, name: string) =>
  page.getByRole('treeitem', {name, exact: true});

async function browserProjectReady(page: Page, name: string): Promise<void> {
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
  assert.equal(await page.locator('#project-location').innerText(), name);
  assert.equal(
    new URL(page.url()).searchParams.get('project'),
    await page.evaluate(() => window.explorerApp.browserProject!.id),
  );
}

function compilerProjectIdentity(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (window.explorerApp.compiler as unknown as {projectIdentity: string})
        .projectIdentity,
  );
}

const emptyProjectExamplesMessage =
  'This project is empty. Create bundled examples in /examples?';

async function beginBrowserProject(page: Page, name: string): Promise<void> {
  await page.locator('#project-location').click();
  await page.locator('#new-browser-project-button').click();
  const dialog = page.getByRole('dialog', {
    name: 'New browser project',
    exact: true,
  });
  await dialog
    .getByRole('textbox', {name: 'Project name', exact: true})
    .fill(name);
  assert.equal(
    await dialog
      .getByRole('checkbox', {name: 'Create examples', exact: true})
      .isChecked(),
    true,
  );
}

async function answerExamplesPrompt(
  page: Page,
  create: boolean,
): Promise<void> {
  await page
    .getByRole('dialog', {name: 'Create examples', exact: true})
    .getByRole('button', {
      name: create ? 'Create examples' : 'Cancel',
      exact: true,
    })
    .click();
}

async function newBrowserProject(
  page: Page,
  name: string,
  createExamples = true,
): Promise<void> {
  await beginBrowserProject(page, name);
  const dialog = page.getByRole('dialog', {
    name: 'New browser project',
    exact: true,
  });
  await dialog
    .getByRole('checkbox', {name: 'Create examples', exact: true})
    .setChecked(createExamples);
  await Promise.all([
    page.waitForEvent('load'),
    dialog.getByRole('button', {name: 'Create project', exact: true}).click(),
  ]);
  await browserProjectReady(page, name);
  assert.equal(
    await page
      .getByRole('dialog', {name: 'Create examples', exact: true})
      .count(),
    0,
  );
}

async function selectBrowserProject(page: Page, name: string): Promise<void> {
  await page.locator('#project-location').click();
  await Promise.all([
    page.waitForEvent('load'),
    page
      .locator('#browser-project-list')
      .getByRole('menuitem', {name, exact: true})
      .click(),
  ]);
  await browserProjectReady(page, name);
}

async function openBrowserProjectMenu(
  page: Page,
  name?: string,
): Promise<Locator> {
  await page.locator('#project-location').click();
  const project = name
    ? page.locator('.browser-project-row').filter({
        has: page.getByRole('menuitem', {name, exact: true}),
      })
    : page.locator('.browser-project-row[data-current="true"]');
  await project.locator('.browser-project-manage').click();
  const menu = project.locator('.project-storage-submenu');
  await menu.waitFor();
  return menu;
}

test(
  'new browser projects can skip examples, remember the choice and create examples from the menu',
  {timeout: 150_000},
  async t => {
    const example = {
      path: '/examples/demo.ts',
      source: 'export const size = 5;\n',
    };
    const page = await open(t, [example]);
    await newBrowserProject(page, 'Empty project', false);
    const assertEmpty = async () => {
      await active(page, undefined);
      assert.deepEqual(
        await page.evaluate(async () => {
          const files = window.explorerApp.projectFileSystem;
          return {
            entries: await files.list('/'),
            model: await files.stat('/model.ts'),
            examples: await files.stat('/examples'),
          };
        }),
        {entries: [], model: undefined, examples: undefined},
      );
      assert.equal(
        await page
          .getByRole('dialog', {name: 'Create examples', exact: true})
          .count(),
        0,
      );
    };
    await assertEmpty();
    await page.reload();
    await browserProjectReady(page, 'Empty project');
    await assertEmpty();
    await selectBrowserProject(page, 'Default project');
    await selectBrowserProject(page, 'Empty project');
    await assertEmpty();

    await page
      .locator('#project-tree')
      .dispatchEvent('contextmenu', {clientX: 50, clientY: 240, button: 2});
    await page
      .getByRole('menuitem', {name: 'Create examples', exact: true})
      .click();
    await answerExamplesPrompt(page, true);
    await row(page, 'examples').waitFor();
    assert.equal(
      await page.evaluate(async () =>
        new TextDecoder().decode(
          await window.explorerApp.projectFileSystem.readFile(
            '/examples/demo.ts',
          ),
        ),
      ),
      example.source,
    );
    // Explicit example creation preserves the user's decision to start empty.
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.projectFileSystem.stat('/model.ts'),
      ),
      undefined,
    );
    await page.reload();
    await browserProjectReady(page, 'Empty project');
    await active(page, undefined);
    await row(page, 'examples').waitFor();
    assert.equal(
      await page
        .getByRole('dialog', {name: 'Create examples', exact: true})
        .count(),
      0,
    );
  },
);

test(
  'new browser projects create examples and the starter model from the creation form',
  {timeout: 120_000},
  async t => {
    const example = {
      path: '/examples/demo.ts',
      source: 'export const size = 5;\n',
    };
    const page = await open(t, [example]);
    await newBrowserProject(page, 'Example project');
    await active(page, '/model.ts');
    assert.deepEqual(
      await page.evaluate(async () => {
        const files = window.explorerApp.projectFileSystem;
        return {
          model: (await files.stat('/model.ts'))?.kind,
          example: new TextDecoder().decode(
            await files.readFile('/examples/demo.ts'),
          ),
        };
      }),
      {model: 'file', example: example.source},
    );
    await page.reload();
    await browserProjectReady(page, 'Example project');
    await active(page, '/model.ts');
    await row(page, 'examples').waitFor();
    assert.equal(
      await page
        .getByRole('dialog', {name: 'Create examples', exact: true})
        .count(),
      0,
    );
  },
);

test(
  'new browser project forms validate names, preserve options and cancel without creating a project',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    const projectUrl = page.url();
    await beginBrowserProject(page, '   ');
    const dialog = page.getByRole('dialog', {
      name: 'New browser project',
      exact: true,
    });
    const name = dialog.getByRole('textbox', {
      name: 'Project name',
      exact: true,
    });
    const examples = dialog.getByRole('checkbox', {
      name: 'Create examples',
      exact: true,
    });
    await examples.uncheck();
    await dialog
      .getByRole('button', {name: 'Create project', exact: true})
      .click();
    await dialog.getByRole('alert').waitFor();
    assert.equal((await name.inputValue()).trim(), '');
    assert.equal(await examples.isChecked(), false);
    assert.equal(page.url(), projectUrl);
    await name.fill('Cancelled project');
    await name.press('Escape');
    await dialog.waitFor({state: 'hidden'});
    assert.deepEqual(
      await page.evaluate(() =>
        window.explorerApp.browserProjects.projects.map(
          project => project.name,
        ),
      ),
      ['Default project'],
    );
    await active(page, '/model.ts');
    assert.equal(page.url(), projectUrl);
  },
);

test(
  'browser projects save before switching and isolate source, dependencies and binary files',
  {timeout: 180_000},
  async t => {
    const page = await open(t);
    await browserProjectReady(page, 'Default project');
    const firstId = new URL(page.url()).searchParams.get('project');
    assert.equal(firstId, 'browser');
    assert.equal(await compilerProjectIdentity(page), 'browser');
    await page.evaluate(async () => {
      const {projectFileSystem: files, codeEditor} = window.explorerApp;
      await files.writeFile('/asset.bin', new Uint8Array([0, 255, 3]));
      await files.writeFile(
        '/node_modules/custom/index.js',
        "export default 'first';",
      );
      codeEditor.applyFiles([
        {
          path: '/model.ts',
          content:
            "import {box} from '@code3d/core';\nexport default box(21, 6, 8);\n",
        },
      ]);
    });
    await newBrowserProject(page, 'Second project');
    const secondId = new URL(page.url()).searchParams.get('project');
    assert.notEqual(secondId, firstId);
    assert.equal(await compilerProjectIdentity(page), `browser:${secondId}`);
    assert.deepEqual(
      await page.evaluate(async () => {
        const files = window.explorerApp.projectFileSystem;
        return [
          await files.stat('/asset.bin'),
          await files.stat('/node_modules/custom/index.js'),
        ];
      }),
      [undefined, undefined],
    );
    assert.match(
      await page.evaluate(async () =>
        new TextDecoder().decode(
          await window.explorerApp.projectFileSystem.readFile('/model.ts'),
        ),
      ),
      /box\(10, 6, 8\)/,
    );
    await page.evaluate(async () => {
      const {
        projectFileSystem: files,
        codeEditor,
        agentProject,
      } = window.explorerApp;
      await files.writeFile('/asset.bin', new Uint8Array([128, 4, 0, 17]));
      await files.writeFile(
        '/node_modules/custom/index.js',
        "export default 'second';",
      );
      codeEditor.applyFiles([
        {
          path: '/model.ts',
          content:
            "import {box} from '@code3d/core';\nexport default box(32, 6, 8);\n",
        },
      ]);
      await agentProject.flush();
    });
    const contents = () =>
      page.evaluate(async () => {
        const files = window.explorerApp.projectFileSystem;
        return {
          model: new TextDecoder().decode(await files.readFile('/model.ts')),
          dependency: new TextDecoder().decode(
            await files.readFile('/node_modules/custom/index.js'),
          ),
          binary: [...(await files.readFile('/asset.bin'))!],
        };
      });
    await page.reload();
    await browserProjectReady(page, 'Second project');
    const second = await contents();
    assert.match(second.model, /box\(32, 6, 8\)/);
    assert.equal(second.dependency, "export default 'second';");
    assert.deepEqual(second.binary, [128, 4, 0, 17]);
    await selectBrowserProject(page, 'Default project');
    assert.equal(await compilerProjectIdentity(page), 'browser');
    const first = await contents();
    assert.match(first.model, /box\(21, 6, 8\)/);
    assert.equal(first.dependency, "export default 'first';");
    assert.deepEqual(first.binary, [0, 255, 3]);
    await selectBrowserProject(page, 'Second project');
    assert.deepEqual(await contents(), second);
    assert.equal(new URL(page.url()).searchParams.get('project'), secondId);
  },
);

test(
  'browser project tabs keep their identity, react to the catalog and scope reset and deletion',
  {timeout: 180_000},
  async t => {
    const page = await open(t);
    await page.locator('#project-location').click();
    await page.locator('#new-browser-project-button').click();
    const creation = page.getByRole('dialog', {
      name: 'New browser project',
      exact: true,
    });
    await creation
      .getByRole('textbox', {name: 'Project name', exact: true})
      .fill('Cancelled project');
    await creation.getByRole('button', {name: 'Cancel', exact: true}).click();
    assert.equal(
      await page.evaluate(
        () => window.explorerApp.browserProjects.projects.length,
      ),
      1,
    );

    const other = await page.context().newPage();
    await other.goto(page.url());
    await browserProjectReady(other, 'Default project');
    const firstUrl = other.url();
    await other.locator('#project-location').click();
    await newBrowserProject(page, 'Second project');
    const projectIdentities = [
      await compilerProjectIdentity(other),
      await compilerProjectIdentity(page),
    ];
    assert.notEqual(projectIdentities[0], projectIdentities[1]);
    await other
      .locator('#browser-project-list')
      .getByRole('menuitem', {
        name: 'Second project',
        exact: true,
      })
      .waitFor();
    assert.equal(other.url(), firstUrl);
    assert.equal(
      await other.locator('#project-location').innerText(),
      'Default project',
    );
    await other.keyboard.press('Escape');
    await page.evaluate(() =>
      window.explorerApp.projectFileSystem.writeFile('/tab.txt', 'second tab'),
    );
    await other.evaluate(() =>
      window.explorerApp.projectFileSystem.writeFile('/tab.txt', 'first tab'),
    );
    await other.reload();
    await browserProjectReady(other, 'Default project');
    assert.equal(other.url(), firstUrl);
    const tabFile = (target: Page) =>
      target.evaluate(async () =>
        new TextDecoder().decode(
          await window.explorerApp.projectFileSystem.readFile('/tab.txt'),
        ),
      );
    assert.equal(await tabFile(other), 'first tab');
    assert.equal(await tabFile(page), 'second tab');

    await (
      await openBrowserProjectMenu(page)
    )
      .locator('[data-action="reset"]')
      .click();
    await Promise.all([
      page.waitForEvent('load'),
      page
        .getByRole('dialog', {name: 'Reset project', exact: true})
        .getByRole('button', {name: 'Reset project', exact: true})
        .click(),
    ]);
    await browserProjectReady(page, 'Second project');
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.projectFileSystem.stat('/tab.txt'),
      ),
      undefined,
    );
    assert.equal(await tabFile(other), 'first tab');
    await page.evaluate(() =>
      window.explorerApp.projectFileSystem.writeFile(
        '/keep-until-deleted.txt',
        'keep',
      ),
    );
    const deletion = async () => {
      await (
        await openBrowserProjectMenu(page)
      )
        .locator('[data-action="delete"]')
        .click();
      return page.getByRole('dialog', {
        name: 'Delete project',
        exact: true,
      });
    };
    await (
      await deletion()
    )
      .getByRole('button', {name: 'Cancel', exact: true})
      .click();
    assert.equal(
      await page.evaluate(
        async () =>
          (
            await window.explorerApp.projectFileSystem.stat(
              '/keep-until-deleted.txt',
            )
          )?.kind,
      ),
      'file',
    );
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('code3d-delete-browser-project'),
      ),
      null,
    );
    // Valid empty sessions let us verify authorization storage ownership
    // without creating network connections or fabricating agent credentials.
    await page.evaluate(async identities => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('code3d-agents');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction('sessions', 'readwrite');
          for (const identity of identities)
            transaction.objectStore('sessions').put(
              {
                sessionId: `session:${identity}`,
                grants: [],
              },
              identity,
            );
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    }, projectIdentities);
    await other.locator('#project-location').click();
    const confirmation = await deletion();
    assert.match(await confirmation.innerText(), /Second project/);
    await Promise.all([
      page.waitForEvent('load'),
      confirmation
        .getByRole('button', {name: 'Delete project', exact: true})
        .click(),
    ]);
    await browserProjectReady(page, 'Default project');
    await other
      .locator('#browser-project-list')
      .getByRole('menuitem', {
        name: 'Second project',
        exact: true,
      })
      .waitFor({state: 'detached'});
    assert.equal(await tabFile(page), 'first tab');
    assert.deepEqual(
      await page.evaluate(async identities => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('code3d-agents');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const sessions = database
            .transaction('sessions')
            .objectStore('sessions');
          return await Promise.all(
            identities.map(
              identity =>
                new Promise((resolve, reject) => {
                  const request = sessions.get(identity);
                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                }),
            ),
          );
        } finally {
          database.close();
        }
      }, projectIdentities),
      [{sessionId: `session:${projectIdentities[0]}`, grants: []}, undefined],
    );

    // The last project's real connection in the other tab blocks deletion.
    await (
      await deletion()
    )
      .getByRole('button', {name: 'Delete project', exact: true})
      .click();
    const blocked = page.getByRole('dialog', {
      name: 'Deleting project',
      exact: true,
    });
    await blocked
      .getByText('Close other Code3D tabs', {exact: false})
      .waitFor();
    await page.reload({waitUntil: 'commit'});
    await blocked
      .getByText('Close other Code3D tabs', {exact: false})
      .waitFor();
    assert.equal(await tabFile(other), 'first tab');
    await other.close();
    await browserProjectReady(page, 'Default project');
    await active(page, undefined);
    assert.deepEqual(
      await page.evaluate(() => window.explorerApp.projectFileSystem.list('/')),
      [],
    );
    assert.equal(
      await page
        .getByRole('dialog', {name: 'Create examples', exact: true})
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.projectFileSystem.stat('/tab.txt'),
      ),
      undefined,
    );
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('code3d-delete-browser-project'),
      ),
      null,
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.explorerApp.browserProjects.projects.map(
          project => project.name,
        ),
      ),
      ['Default project'],
    );
  },
);

test(
  'unopened browser projects reset and delete without disturbing the active browser or local workspace',
  {timeout: 180_000},
  async t => {
    const example = {
      path: '/examples/demo.ts',
      source: 'export const restoredExample = 1;',
    };
    const page = await open(t, [example]);
    await newBrowserProject(page, 'Background project', false);
    const targetURL = page.url();
    await page.evaluate(async () => {
      const files = window.explorerApp.projectFileSystem;
      await files.writeFile('/discard.txt', 'belongs to background project');
      await files.writeFile('/examples/demo.ts', 'changed');
    });
    await selectBrowserProject(page, 'Default project');
    const activeURL = page.url();
    await page.evaluate(async () => {
      document.body.dataset.backgroundOperation = 'same document';
      const {projectFileSystem, codeEditor, agentProject} = window.explorerApp;
      const write = projectFileSystem.writeFile.bind(projectFileSystem);
      window.restoreProjectWrites = () => {
        projectFileSystem.writeFile = write;
      };
      projectFileSystem.writeFile = async () => {
        throw new Error('Keep the active project draft unsaved');
      };
      codeEditor.editor.setValue(
        "import {box} from '@code3d/core';\nexport default box(23, 6, 8);\n",
      );
      await agentProject.flush().catch(() => {});
    });
    const assertActiveDraft = async () => {
      assert.equal(page.url(), activeURL);
      assert.deepEqual(
        await page.evaluate(() => ({
          document: document.body.dataset.backgroundOperation,
          project: window.explorerApp.browserProject!.name,
          source: window.explorerApp.codeEditor.editor.getValue(),
          unsaved: window.explorerApp.agentProject.hasUnsaved,
        })),
        {
          document: 'same document',
          project: 'Default project',
          source:
            "import {box} from '@code3d/core';\nexport default box(23, 6, 8);\n",
          unsaved: true,
        },
      );
    };

    // The unopened target can still be held by another tab. Reset waits for
    // that tab's lease without reloading or saving the active workspace.
    const other = await page.context().newPage();
    await other.goto(targetURL);
    await browserProjectReady(other, 'Background project');
    await (
      await openBrowserProjectMenu(page, 'Background project')
    )
      .locator('[data-action="reset"]')
      .click();
    const reset = page.getByRole('dialog', {
      name: 'Reset project',
      exact: true,
    });
    assert.match(await reset.innerText(), /Background project/);
    await reset
      .getByRole('button', {name: 'Reset project', exact: true})
      .click();
    await page
      .getByRole('dialog', {name: 'Resetting project', exact: true})
      .getByText('Close other Code3D tabs', {exact: false})
      .waitFor();
    await assertActiveDraft();
    assert.equal(
      await page.evaluate(() => {
        const event = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
      true,
      'A pending operation on another project must preserve active draft protection',
    );
    await other.close();
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>('#project-location')!
          .disabled,
    );
    await assertActiveDraft();

    const resetProject = await page.context().newPage();
    await resetProject.goto(targetURL);
    await browserProjectReady(resetProject, 'Background project');
    assert.deepEqual(
      await resetProject.evaluate(async () => {
        const files = window.explorerApp.projectFileSystem;
        return {
          model: new TextDecoder().decode(await files.readFile('/model.ts')),
          example: new TextDecoder().decode(
            await files.readFile('/examples/demo.ts'),
          ),
          discarded: await files.stat('/discard.txt'),
        };
      }),
      {
        model:
          "import {box} from '@code3d/core';\nexport default box(10, 6, 8);\n",
        example: example.source,
        discarded: undefined,
      },
    );
    await resetProject.close();

    await (
      await openBrowserProjectMenu(page, 'Background project')
    )
      .locator('[data-action="delete"]')
      .click();
    const deletion = page.getByRole('dialog', {
      name: 'Delete project',
      exact: true,
    });
    assert.match(await deletion.innerText(), /Background project/);
    await deletion
      .getByRole('button', {name: 'Delete project', exact: true})
      .click();
    await page.waitForFunction(() =>
      window.explorerApp.browserProjects.projects.every(
        project => project.name !== 'Background project',
      ),
    );
    await assertActiveDraft();
    await page.evaluate(async () => {
      window.restoreProjectWrites!();
      await window.explorerApp.agentProject.retrySaves();
    });
    assert.deepEqual(
      await page.evaluate(async () => ({
        unsaved: window.explorerApp.agentProject.hasUnsaved,
        source: new TextDecoder().decode(
          await window.explorerApp.projectFileSystem.readFile('/model.ts'),
        ),
      })),
      {
        unsaved: false,
        source:
          "import {box} from '@code3d/core';\nexport default box(23, 6, 8);\n",
      },
    );

    await mockLocalDirectories(page);
    const localURL = new URL(process.env.CODE3D_TEST_URL!);
    localURL.searchParams.set('workspace', 'background-local');
    await page.goto(localURL.href);
    await answerExamplesPrompt(page, false);
    await active(page, undefined);
    await page.evaluate(async () => {
      document.body.dataset.localOperation = 'same local document';
      await window.explorerApp.projectFileSystem.writeFile(
        '/keep.txt',
        'local content',
      );
      await window.explorerApp.browserProjects.create(
        'Local-managed project',
        false,
      );
    });
    await (
      await openBrowserProjectMenu(page, 'Local-managed project')
    )
      .locator('[data-action="delete"]')
      .click();
    const localDeletion = page.getByRole('dialog', {
      name: 'Delete project',
      exact: true,
    });
    assert.match(await localDeletion.innerText(), /Local-managed project/);
    await localDeletion
      .getByRole('button', {name: 'Delete project', exact: true})
      .click();
    await page.waitForFunction(() =>
      window.explorerApp.browserProjects.projects.every(
        project => project.name !== 'Local-managed project',
      ),
    );
    assert.equal(
      new URL(page.url()).searchParams.get('workspace'),
      'background-local',
    );
    assert.deepEqual(
      await page.evaluate(async () => ({
        document: document.body.dataset.localOperation,
        content: new TextDecoder().decode(
          await window.explorerApp.projectFileSystem.readFile('/keep.txt'),
        ),
      })),
      {document: 'same local document', content: 'local content'},
    );
  },
);

test(
  'a pending background reset resumes after refresh and returns to the original local workspace',
  {timeout: 150_000},
  async t => {
    const example = {
      path: '/examples/resumed.ts',
      source: 'export const resumed = true;',
    };
    const page = await open(t, [example]);
    await newBrowserProject(page, 'Reset after refresh', false);
    const targetURL = page.url();
    const targetId = new URL(targetURL).searchParams.get('project');
    await page.evaluate(() =>
      window.explorerApp.projectFileSystem.writeFile(
        '/discard.txt',
        'old target data',
      ),
    );
    const other = await page.context().newPage();
    await other.goto(targetURL);
    await browserProjectReady(other, 'Reset after refresh');

    await mockLocalDirectories(page);
    const localURL = new URL(process.env.CODE3D_TEST_URL!);
    localURL.searchParams.set('workspace', 'resume-background-reset');
    await page.goto(localURL.href);
    await answerExamplesPrompt(page, false);
    await active(page, undefined);
    await page.evaluate(async () => {
      await window.explorerApp.projectFileSystem.writeFile(
        '/keep.txt',
        'keep local data',
      );
      await window.explorerApp.agentProject.flush();
    });
    const workspaceURL = page.url();
    await (
      await openBrowserProjectMenu(page, 'Reset after refresh')
    )
      .locator('[data-action="reset"]')
      .click();
    await page
      .getByRole('dialog', {name: 'Reset project', exact: true})
      .getByRole('button', {name: 'Reset project', exact: true})
      .click();
    const blocked = page
      .getByRole('dialog', {name: 'Resetting project', exact: true})
      .getByText('Close other Code3D tabs', {exact: false});
    await blocked.waitFor();
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('code3d-reset-browser-project'),
      ),
      targetId,
    );
    await page.reload({waitUntil: 'commit'});
    await blocked.waitFor();
    assert.equal(page.url(), workspaceURL);
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('code3d-reset-browser-project'),
      ),
      targetId,
    );
    await other.close();
    await page.locator('#project-location[data-kind="local"]').waitFor();
    await page.waitForFunction(() => !!window.explorerApp);
    assert.equal(page.url(), workspaceURL);
    assert.equal(
      await page.locator('#project-location').innerText(),
      'resume-background-reset',
    );
    assert.deepEqual(
      await page.evaluate(async () => ({
        pending: sessionStorage.getItem('code3d-reset-browser-project'),
        content: new TextDecoder().decode(
          await window.explorerApp.projectFileSystem.readFile('/keep.txt'),
        ),
        model: await window.explorerApp.projectFileSystem.stat('/model.ts'),
        examples: await window.explorerApp.projectFileSystem.stat('/examples'),
      })),
      {
        pending: null,
        content: 'keep local data',
        model: undefined,
        examples: undefined,
      },
    );

    const restored = await page.context().newPage();
    await restored.goto(targetURL);
    await browserProjectReady(restored, 'Reset after refresh');
    assert.deepEqual(
      await restored.evaluate(async () => {
        const files = window.explorerApp.projectFileSystem;
        return {
          model: new TextDecoder().decode(await files.readFile('/model.ts')),
          example: new TextDecoder().decode(
            await files.readFile('/examples/resumed.ts'),
          ),
          discarded: await files.stat('/discard.txt'),
        };
      }),
      {
        model:
          "import {box} from '@code3d/core';\nexport default box(10, 6, 8);\n",
        example: example.source,
        discarded: undefined,
      },
    );
  },
);

test(
  'failed saves prevent creating or switching browser projects',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await newBrowserProject(page, 'Second project');
    const url = page.url();
    await page.evaluate(async () => {
      const {projectFileSystem, codeEditor, agentProject} = window.explorerApp;
      projectFileSystem.writeFile = async () => {
        throw new Error('Test project switch save failure');
      };
      codeEditor.applyFiles([
        {
          path: '/model.ts',
          content:
            "import {box} from '@code3d/core';\nexport default box(43, 6, 8);\n",
        },
      ]);
      await agentProject.flush().catch(() => {});
    });
    await page.locator('#project-location').click();
    await page.locator('#new-browser-project-button').click();
    const dialog = page.getByRole('dialog', {
      name: 'New browser project',
      exact: true,
    });
    await dialog
      .getByRole('textbox', {name: 'Project name', exact: true})
      .fill('Must not be created');
    await dialog
      .getByRole('checkbox', {name: 'Create examples', exact: true})
      .uncheck();
    await dialog
      .getByRole('button', {name: 'Create project', exact: true})
      .click();
    await dialog
      .getByRole('alert')
      .filter({hasText: 'unsaved changes'})
      .waitFor();
    assert.equal(
      await dialog
        .getByRole('textbox', {name: 'Project name', exact: true})
        .inputValue(),
      'Must not be created',
    );
    assert.equal(
      await dialog
        .getByRole('checkbox', {name: 'Create examples', exact: true})
        .isChecked(),
      false,
    );
    assert.equal(page.url(), url);
    assert.deepEqual(
      await page.evaluate(() =>
        window.explorerApp.browserProjects.projects.map(
          project => project.name,
        ),
      ),
      ['Default project', 'Second project'],
    );
    assert.equal(
      await dialog
        .getByRole('button', {name: 'Create project', exact: true})
        .isEnabled(),
      true,
    );
    await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
    await dialog.waitFor({state: 'hidden'});
    await page.locator('#project-location').click();
    await page
      .locator('#browser-project-list')
      .getByRole('menuitem', {name: 'Default project', exact: true})
      .click();
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>('#project-location')!
          .disabled,
    );
    await page
      .getByText(
        'Project files have unsaved changes. Retry saving before leaving this project.',
        {exact: true},
      )
      .waitFor();
    assert.equal(page.url(), url);
    assert.equal(
      await page.locator('#project-location').innerText(),
      'Second project',
    );
    assert.equal(
      await page.evaluate(() => window.explorerApp.agentProject.hasUnsaved),
      true,
    );
  },
);

test(
  'browser storage reset confirms deletion and restores the initial project',
  {timeout: 120_000},
  async t => {
    const page = await open(t, [
      {path: '/examples/sample.ts', source: 'export const sample = 1;'},
    ]);
    await page.evaluate(async () => {
      const {projectFileSystem, codeEditor, agentProject} = window.explorerApp;
      await projectFileSystem.writeFile(
        '/extra.bin',
        new Uint8Array([0, 255, 3]),
      );
      await projectFileSystem.writeFile(
        '/node_modules/custom/index.js',
        'export default 1;',
      );
      await projectFileSystem.writeFile('/code3d-lock.json', '{}');
      await projectFileSystem.writeFile('/examples/sample.ts', 'changed');
      codeEditor.applyFiles([
        {
          path: '/model.ts',
          content:
            "import {box} from '@code3d/core';\nexport default box(14, 6, 8);\n",
        },
      ]);
      await agentProject.flush();
      localStorage.setItem('code3d-reset-test-preference', 'keep');
    });
    const reset = async () => {
      await (
        await openBrowserProjectMenu(page)
      )
        .locator('[data-action="reset"]')
        .click();
      return page.getByRole('dialog', {
        name: 'Reset project',
        exact: true,
      });
    };
    const confirmation = await reset();
    await confirmation
      .getByRole('button', {name: 'Cancel', exact: true})
      .click();
    assert.equal(
      await page.evaluate(
        async () =>
          (await window.explorerApp.projectFileSystem.stat('/extra.bin'))?.kind,
      ),
      'file',
    );
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('code3d-reset-browser-project'),
      ),
      null,
    );

    // Reset also recovers a workspace whose current drafts cannot be saved.
    await page.evaluate(async () => {
      const {projectFileSystem, codeEditor, agentProject} = window.explorerApp;
      projectFileSystem.writeFile = async () => {
        throw new Error('Test save failure');
      };
      codeEditor.applyFiles([
        {
          path: '/model.ts',
          content: "export const unsaved = 'discard on reset';",
        },
      ]);
      await agentProject.flush().catch(() => {});
    });
    assert.equal(
      await page.evaluate(() => window.explorerApp.agentProject.hasUnsaved),
      true,
    );
    const approved = await reset();
    await Promise.all([
      page.waitForEvent('load'),
      approved
        .getByRole('button', {name: 'Reset project', exact: true})
        .click(),
    ]);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    const state = await page.evaluate(async () => {
      const files = window.explorerApp.projectFileSystem;
      const text = async (path: string) =>
        new TextDecoder().decode(await files.readFile(path));
      return {
        model: await text('/model.ts'),
        example: await text('/examples/sample.ts'),
        extra: await files.stat('/extra.bin'),
        dependency: await files.stat('/node_modules/custom/index.js'),
        lock: await files.stat('/code3d-lock.json'),
        preference: localStorage.getItem('code3d-reset-test-preference'),
        command: sessionStorage.getItem('code3d-reset-browser-project'),
      };
    });
    assert.match(state.model, /box\(10, 6, 8\)/);
    assert.equal(state.example, 'export const sample = 1;');
    assert.equal(state.extra, undefined);
    assert.equal(state.dependency, undefined);
    assert.equal(state.lock, undefined);
    assert.equal(state.preference, 'keep');
    assert.equal(state.command, null);
    await page.evaluate(() =>
      window.explorerApp.projectFileSystem.writeFile(
        '/after-reset.txt',
        'keep after reload',
      ),
    );
    await page.reload();
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    assert.equal(
      await page.evaluate(
        async () =>
          (await window.explorerApp.projectFileSystem.stat('/after-reset.txt'))
            ?.kind,
      ),
      'file',
    );
  },
);

test(
  'browser storage reset waits for other storage connections to close',
  {timeout: 120_000},
  async t => {
    const page = await open(t);
    const other = await page.context().newPage();
    await other.goto(
      new URL('/favicon.svg', process.env.CODE3D_TEST_URL!).href,
    );
    await other.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('code3d-project-v1');
        request.onsuccess = () => {
          // Retain the connection until this test-owned page closes.
          (window as Window & {resetBlocker?: IDBDatabase}).resetBlocker =
            request.result;
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    });
    await (
      await openBrowserProjectMenu(page)
    )
      .locator('[data-action="reset"]')
      .click();
    await page
      .getByRole('dialog', {name: 'Reset project', exact: true})
      .getByRole('button', {name: 'Reset project', exact: true})
      .click();
    const blocked = page.getByText(
      'Close other Code3D tabs using this browser storage',
      {exact: false},
    );
    await blocked.waitFor();
    // A reload during the wait must not silently abandon the confirmed reset.
    await page.reload({waitUntil: 'commit'});
    await blocked.waitFor();
    await other.close();
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('code3d-reset-browser-project'),
      ),
      null,
    );
  },
);

test(
  'browser storage reset reports deletion errors without removing the project',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page.evaluate(() =>
      window.explorerApp.projectFileSystem.writeFile('/keep.txt', 'keep'),
    );
    await page.addInitScript(() => {
      const original = indexedDB.deleteDatabase.bind(indexedDB);
      indexedDB.deleteDatabase = name => {
        if (name === 'code3d-project-v1')
          throw new DOMException(
            'Test storage deletion denied',
            'UnknownError',
          );
        return original(name);
      };
    });
    await (
      await openBrowserProjectMenu(page)
    )
      .locator('[data-action="reset"]')
      .click();
    await page
      .getByRole('dialog', {name: 'Reset project', exact: true})
      .getByRole('button', {name: 'Reset project', exact: true})
      .click();
    const error = page.getByRole('dialog', {
      name: 'Could not reset browser storage',
      exact: true,
    });
    await error
      .getByText('Test storage deletion denied', {exact: true})
      .waitFor();
    await error.getByRole('button', {name: 'OK', exact: true}).click();
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    assert.equal(
      await page.evaluate(async () =>
        new TextDecoder().decode(
          await window.explorerApp.projectFileSystem.readFile('/keep.txt'),
        ),
      ),
      'keep',
    );
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('code3d-reset-browser-project'),
      ),
      null,
    );
  },
);

test(
  'the workspace root menu clears build caches and rebuilds the active model',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await row(page, 'src').click({button: 'right'});
    assert.equal(
      await page
        .getByRole('menuitem', {name: 'Clear build cache', exact: true})
        .count(),
      0,
    );
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      const {compiler} = window.explorerApp;
      const mobxUrl = '/node_modules/.vite/deps/mobx.js';
      const {reaction}: typeof import('mobx') = await import(mobxUrl);
      const phases: string[] = [];
      window.clearCachePhases = phases;
      reaction(
        () => compiler.phase,
        phase => {
          if (phase) phases.push(phase);
        },
      );
    });
    await page
      .locator('#project-tree')
      .dispatchEvent('contextmenu', {clientX: 50, clientY: 240, button: 2});
    await page
      .getByRole('menuitem', {name: 'Clear build cache', exact: true})
      .click();
    await page.waitForFunction(() =>
      window.clearCachePhases.includes('evaluating-model'),
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    const result = await page.evaluate(async () => ({
      phases: window.clearCachePhases,
      file: window.explorerApp.codeEditor.currentFile(),
      source: new TextDecoder().decode(
        await window.explorerApp.projectFileSystem.readFile('/model.ts'),
      ),
    }));
    assert.ok(result.phases.includes('loading-compiler'));
    assert.ok(result.phases.includes('loading-runtime'));
    assert.equal(result.file, '/model.ts');
    assert.match(result.source!, /box\(10, 6, 8\)/);
  },
);

test(
  'Clear build cache preserves runtime fonts and no dedicated refresh is exposed',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    const font = await readFile(
      new URL('../../../core/test/fonts/DejaVuSans.ttf', import.meta.url),
    );
    const fontUrl = 'https://fonts.gstatic.com/code3d-test/menu.ttf';
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'max-age=3600',
    };
    let cssRequests = 0,
      fontRequests = 0;
    await page.context().route('https://fonts.googleapis.com/css2?*', route => {
      cssRequests++;
      return route.fulfill({
        contentType: 'text/css',
        headers,
        body: `@font-face {src: url(${fontUrl}); unicode-range: U+0000-00FF;}`,
      });
    });
    await page.context().route(fontUrl, route => {
      fontRequests++;
      return route.fulfill({contentType: 'font/ttf', headers, body: font});
    });
    const source =
      "import {googleFont, text, extrude, group} from '@code3d/core';\nexport default group(extrude(text('Code3D', await googleFont('Play'), 10), 1));";
    const downloaded = page.waitForResponse(fontUrl);
    await page.evaluate(
      source =>
        window.explorerApp.codeEditor.applyFiles([
          {path: '/model.ts', content: source},
        ]),
      source,
    );
    await downloaded;
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.equal(cssRequests, 1);
    assert.equal(fontRequests, 1);
    const command = async (name: string) => {
      await page
        .locator('#project-tree')
        .dispatchEvent('contextmenu', {clientX: 50, clientY: 240, button: 2});
      await page.getByRole('menuitem', {name, exact: true}).click();
      await page.getByText('Ready', {exact: true}).waitFor({state: 'hidden'});
      await page.getByText('Ready', {exact: true}).waitFor();
    };
    await command('Clear build cache');
    assert.equal(cssRequests, 1);
    assert.equal(fontRequests, 1);
    await page
      .locator('#project-tree')
      .dispatchEvent('contextmenu', {clientX: 50, clientY: 240, button: 2});
    assert.equal(
      await page
        .getByRole('menuitem', {name: 'Refresh fonts', exact: true})
        .count(),
      0,
    );
    await page.keyboard.press('Escape');
    assert.equal(
      await page.evaluate(() => window.explorerApp.codeEditor.currentFile()),
      '/model.ts',
    );
  },
);

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
  const input = page.getByRole('textbox', {
    name: `New ${kind} name`,
    exact: true,
  });
  await input.fill(name);
  await input.press('Enter');
  await row(page, name).waitFor();
}
async function menu(page: Page, name: string, command: string): Promise<void> {
  await row(page, name).click({button: 'right'});
  await page.getByRole('menuitem', {name: command, exact: true}).click();
}

// Keep real OPFS reads/writes, but supply live handles: this Chrome build can
// crash when deserializing OPFS handles from IndexedDB in temporary contexts.
async function mockLocalDirectories(page: Page): Promise<void> {
  await page.route('**/src/project/directory-access.ts*', route => {
    if (
      new URL(route.request().url()).searchParams.has('local-fixture-original')
    )
      return route.continue();
    return route.fulfill({
      contentType: 'text/javascript',
      body: `
        export * from '/src/project/directory-access.ts?local-fixture-original';
        export async function storedProjectDirectory(workspaceId) {
          return (await navigator.storage.getDirectory()).getDirectoryHandle(workspaceId, {create: true});
        }
        export async function rememberProjectDirectory(handle) { return handle.name; }
      `,
    });
  });
  const picker = () => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle(
          sessionStorage.getItem('nextFolder')!,
          {create: true},
        ),
    });
  };
  await page.addInitScript(picker);
  await page.evaluate(picker);
}

test(
  'inline creation selects the stem, accepts unchanged names, and cancels without files',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    const start = async (kind: 'file' | 'directory') => {
      // Rows appear during refresh, before the create command releases its UI lock.
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>('#new-file-button')!
            .disabled,
      );
      await page.evaluate(kind => {
        void window.explorerApp.projectDirectory.create(kind, '/');
      }, kind);
      return page.getByRole('textbox', {
        name: kind === 'file' ? 'New file name' : 'New folder name',
        exact: true,
      });
    };
    let input = await start('file');
    await input.waitFor();
    assert.deepEqual(
      await input.evaluate((input: HTMLInputElement) => [
        input.value,
        input.selectionStart,
        input.selectionEnd,
      ]),
      ['untitled.ts', 0, 8],
    );
    await input.press('Escape');
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.projectFileSystem.stat('/untitled.ts'),
      ),
      undefined,
    );
    assert.equal(
      await page.locator('[data-item-path="untitled.ts"]').count(),
      0,
    );
    input = await start('file');
    await input.press('Enter');
    await active(page, '/untitled.ts');
    assert.ok(
      await page.evaluate(() =>
        window.explorerApp.projectFileSystem.stat('/untitled.ts'),
      ),
    );
    input = await start('file');
    await input.waitFor();
    assert.equal(await input.inputValue(), 'untitled-2.ts');
    await input.press('Escape');
    input = await start('directory');
    await input.waitFor();
    assert.deepEqual(
      await input.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
      [0, 10],
    );
    await input.press('Enter');
    await row(page, 'new-folder').waitFor();
    input = await start('file');
    await input.fill('blur-created.ts');
    await page.locator('[data-file-tree-search-input]').click();
    await active(page, '/blur-created.ts');
  },
);

test(
  'header creation escapes read-only directories and creates nested paths',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await page.evaluate(async () => {
      const {projectFileSystem: fs, projectDirectory} = window.explorerApp;
      await fs.writeFile('/node_modules/demo/index.ts', 'export {};');
      await fs.writeFile('/src/.code3d/state.json', '{}');
      await projectDirectory.refresh();
    });
    await row(page, 'node_modules').click();
    await page.getByRole('button', {name: 'New file', exact: true}).click();
    const fileName = page.getByRole('textbox', {
      name: 'New file name',
      exact: true,
    });
    assert.deepEqual(
      await fileName.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
        input.value,
      ]),
      [0, 8, 'untitled.ts'],
    );
    await fileName.fill('lib/utils/新文件.ts');
    await fileName.press('Enter');
    await active(page, '/lib/utils/新文件.ts');
    await row(page, '新文件.ts').waitFor();

    await row(page, 'src').click();
    await page
      .locator('[role="treeitem"][data-item-path="src/.code3d/"]')
      .click();
    await page.getByRole('button', {name: 'New folder', exact: true}).click();
    const folderName = page.getByRole('textbox', {
      name: 'New folder name',
      exact: true,
    });
    await folderName.fill('nested/empty');
    await folderName.press('Enter');
    await page
      .locator('[role="treeitem"][data-item-path="src/nested/empty/"]')
      .waitFor();
    assert.deepEqual(
      await page.evaluate(async () => {
        const fs = window.explorerApp.projectFileSystem;
        return [
          (await fs.stat('/lib/utils/新文件.ts'))?.kind,
          (await fs.stat('/src/nested/empty'))?.kind,
          await fs.list('/src/nested/empty'),
        ];
      }),
      ['file', 'directory', []],
    );
  },
);

test(
  'package prompts validate inline and cancellation leaves the project unchanged',
  {timeout: 60_000},
  async t => {
    const page = await open(t);
    await row(page, 'src').click({button: 'right'});
    await page
      .getByRole('menuitem', {name: 'Install package', exact: true})
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Install package',
      exact: true,
    });
    assert.equal(await dialog.locator('header p').innerText(), 'In /src');
    const input = dialog.getByRole('textbox', {name: 'Package', exact: true});
    await input.fill('bad package name');
    await dialog.getByRole('button', {name: 'Install', exact: true}).click();
    assert.ok(await dialog.getByRole('alert').isVisible());
    assert.equal(await input.inputValue(), 'bad package name');
    await input.fill('just-range@4.2.0');
    await page.keyboard.press('Escape');
    await dialog.waitFor({state: 'detached'});
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.projectFileSystem.stat('/src/package.json'),
      ),
      undefined,
    );
  },
);

test(
  'nested creation validates paths and preserves existing files in a local folder',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await mockLocalDirectories(page);
    await page.reload();
    await active(page, '/model.ts');
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      await root.getDirectoryHandle('create-local', {create: true});
      sessionStorage.setItem('nextFolder', 'create-local');
    });
    await page.locator('#project-location').click();
    await page
      .getByRole('menuitem', {name: 'Open folder', exact: true})
      .click();
    await page
      .getByRole('dialog', {name: 'Create examples', exact: true})
      .getByRole('button', {name: 'Cancel', exact: true})
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector('#project-location')?.textContent ===
        'create-local',
    );
    await page.getByRole('button', {name: 'New file', exact: true}).click();
    const name = page.getByRole('textbox', {
      name: 'New file name',
      exact: true,
    });
    for (const invalid of [
      '../escape.ts',
      '/absolute.ts',
      'a//b.ts',
      'a/./b.ts',
      'a/../b.ts',
      'node_modules/entry.ts',
    ]) {
      await name.fill(invalid);
      await name.press('Enter');
      assert.ok(await name.isVisible(), invalid);
      assert.equal(
        await name.evaluate((input: HTMLInputElement) => input.validity.valid),
        false,
        invalid,
      );
    }
    await name.fill('src/utils/model.ts');
    await name.press('Enter');
    await active(page, '/src/utils/model.ts');
    await page.evaluate(async () => {
      const {agentProject, projectFileSystem: fs} = window.explorerApp;
      await fs.writeFile('/unopened/keep.ts', '// keep existing file');
      await agentProject.changeEntries({
        kind: 'create',
        entry: {kind: 'directory', path: '/assets/icons/empty'},
      });
    });
    // The target is absent from the lazy tree index, so disk preflight must reject it.
    await page.evaluate(() => {
      void window.explorerApp.projectDirectory.create('file', '/');
    });
    await name.fill('unopened/keep.ts');
    await name.press('Enter');
    await page
      .getByText('Destination already exists: /unopened/keep.ts', {exact: true})
      .waitFor();
    // The failed operation still refreshes the disk view before accepting commands.
    await page
      .locator('#project-tree[aria-busy="true"]')
      .waitFor({state: 'detached'});
    await page.evaluate(() => {
      void window.explorerApp.projectDirectory.create('file', '/');
    });
    await name.fill('unopened/keep.ts/child.ts');
    await name.press('Enter');
    await page
      .locator('.project-status:not(.package-status)')
      .filter({visible: true})
      .waitFor();
    assert.deepEqual(
      await page.evaluate(async () => {
        const root = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('create-local');
        const utils = await (
          await root.getDirectoryHandle('src')
        ).getDirectoryHandle('utils');
        const unopened = await root.getDirectoryHandle('unopened');
        const icons = await (
          await root.getDirectoryHandle('assets')
        ).getDirectoryHandle('icons');
        return [
          (await utils.getFileHandle('model.ts')).kind,
          await (
            await (await unopened.getFileHandle('keep.ts')).getFile()
          ).text(),
          (await icons.getDirectoryHandle('empty')).kind,
        ];
      }),
      ['file', '// keep existing file', 'directory'],
    );
  },
);

test(
  'project storage controls stay in the explorer and preserve folder switching',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    const explorer = page.getByRole('complementary', {name: 'Project files'});
    const location = explorer.locator('#project-location');
    const actions = page.getByRole('menu', {
      name: 'Project storage',
      exact: true,
    });
    const currentRow = actions.locator(
      '.browser-project-row[data-current="true"]',
    );
    const currentProject = currentRow.locator('.browser-project-select');
    const currentManage = currentRow.locator('.browser-project-manage');
    const projectActions = currentRow.locator('.project-storage-submenu');
    assert.equal(await location.innerText(), 'Default project');
    assert.equal(
      await page
        .getByRole('button', {name: 'Search files', exact: true})
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator('.topbar #open-folder-button, .topbar #project-location')
        .count(),
      0,
    );
    await location.focus();
    await location.press('Enter');
    const current = actions
      .locator('#browser-project-list')
      .getByRole('menuitem', {name: 'Default project', exact: true});
    assert.equal(await current.getAttribute('aria-current'), 'true');
    assert.equal(await current.isEnabled(), true);
    assert.equal(
      await current.evaluate(element => element === document.activeElement),
      true,
    );
    await page.keyboard.press('Tab');
    await actions.waitFor({state: 'hidden'});
    await location.focus();
    await location.press('ArrowDown');
    assert.equal(
      await current.evaluate(element => element === document.activeElement),
      true,
    );
    await page.keyboard.press('ArrowDown');
    assert.equal(
      await actions
        .locator('#open-folder-button')
        .evaluate(element => element === document.activeElement),
      true,
    );
    await page.keyboard.press('End');
    assert.equal(
      await actions
        .locator('#new-browser-project-button')
        .evaluate(element => element === document.activeElement),
      true,
    );
    assert.equal(await projectActions.isHidden(), true);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await projectActions
        .getByRole('menuitem', {name: 'Open', exact: true})
        .evaluate(element => element === document.activeElement),
      true,
    );
    await page.keyboard.press('ArrowDown');
    assert.equal(
      await projectActions
        .locator('[data-action="copy"]')
        .evaluate(element => element === document.activeElement),
      true,
    );
    await page.keyboard.press('ArrowDown');
    assert.equal(
      await projectActions
        .locator('[data-action="reset"]')
        .evaluate(element => element === document.activeElement),
      true,
    );
    await page.keyboard.press('ArrowDown');
    assert.equal(
      await projectActions
        .locator('[data-action="delete"]')
        .evaluate(element => element === document.activeElement),
      true,
    );
    await page.keyboard.press('Escape');
    await projectActions.waitFor({state: 'hidden'});
    assert.equal(await actions.isVisible(), true);
    assert.equal(
      await currentProject.evaluate(
        element => element === document.activeElement,
      ),
      true,
    );
    await page.keyboard.press('ArrowRight');
    await projectActions.waitFor();
    await page.keyboard.press('ArrowLeft');
    await projectActions.waitFor({state: 'hidden'});
    assert.equal(
      await currentProject.evaluate(
        element => element === document.activeElement,
      ),
      true,
    );
    await page.keyboard.press('Home');
    assert.equal(
      await current.evaluate(element => element === document.activeElement),
      true,
    );
    await currentProject.hover();
    await projectActions.waitFor();
    await currentManage.click();
    assert.equal(await projectActions.isVisible(), true);
    await projectActions.locator('[data-action="reset"]').hover();
    await projectActions.locator('[data-action="delete"]').hover();
    assert.equal(await projectActions.isVisible(), true);
    await actions.locator('#new-browser-project-button').hover();
    await projectActions.waitFor({state: 'hidden'});
    assert.equal(await actions.isVisible(), true);
    assert.equal(
      await page
        .getByRole('dialog', {name: 'Delete project', exact: true})
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('code3d-delete-browser-project'),
      ),
      null,
    );
    await page.evaluate(() => {
      document.body.dataset.projectSelection = 'unchanged';
    });
    await current.click();
    await projectActions.waitFor({state: 'hidden'});
    await actions.waitFor({state: 'hidden'});
    assert.equal(
      await page.evaluate(() => document.body.dataset.projectSelection),
      'unchanged',
    );
    await location.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await projectActions.waitFor();
    await page.keyboard.press('Tab');
    await projectActions.waitFor({state: 'hidden'});
    await actions.waitFor({state: 'hidden'});
    await page.evaluate(() => {
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async () => {
          document.body.dataset.folderPickerCalled = 'true';
          throw new DOMException('Cancelled', 'AbortError');
        },
      });
    });
    assert.equal(
      await explorer.locator('.project-actions #open-folder-button').count(),
      0,
    );
    await location.click();
    await actions
      .getByRole('menuitem', {name: 'Open folder', exact: true})
      .click();
    await page.waitForFunction(
      () => document.body.dataset.folderPickerCalled === 'true',
    );
    const separator = page.getByRole('separator', {
      name: 'Resize file explorer',
    });
    await separator.press('Home');
    await page.waitForFunction(
      () =>
        Math.abs(
          document.getElementById('project-explorer')!.getBoundingClientRect()
            .width -
            Number(
              document
                .getElementById('project-explorer-resizer')!
                .getAttribute('aria-valuenow'),
            ),
        ) < 0.5,
    );
    const bounds = (await explorer.boundingBox())!;
    for (const name of [
      'New file',
      'New folder',
      'Refresh files and dependencies',
    ]) {
      const button = (await explorer
        .getByRole('button', {name, exact: true})
        .boundingBox())!;
      assert.ok(
        button.x >= bounds.x &&
          button.x + button.width <= bounds.x + bounds.width,
      );
    }
    assert.ok(await location.isEnabled());
    await openBrowserProjectMenu(page);
    await projectActions.locator('[data-action="copy"]').waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await separator.press('End');
    await mockLocalDirectories(page);
    const localURL = new URL(process.env.CODE3D_TEST_URL!);
    localURL.searchParams.set('workspace', 'explorer-folder');
    await page.goto(localURL.href);
    await page
      .getByRole('dialog', {name: 'Create examples', exact: true})
      .getByRole('button', {name: 'Create examples', exact: true})
      .click();
    await active(page, undefined);
    assert.equal(await location.innerText(), 'explorer-folder');
    await location.click();
    assert.equal(await currentProject.isHidden(), true);
    assert.equal(await projectActions.isHidden(), true);
    const storedProject = actions.locator('.browser-project-row').filter({
      has: page.getByRole('menuitem', {
        name: 'Default project',
        exact: true,
      }),
    });
    await storedProject.locator('.browser-project-manage').click();
    const storedActions = storedProject.locator('.project-storage-submenu');
    await storedActions.locator('[data-action="reset"]').waitFor();
    await page.keyboard.press('Escape');
    await storedActions.waitFor({state: 'hidden'});
    await actions
      .getByRole('menuitem', {name: 'Change folder', exact: true})
      .waitFor();
    assert.equal(
      await explorer.locator('.project-actions #open-folder-button').count(),
      0,
    );
    await actions
      .getByRole('menuitem', {name: 'Reload folder', exact: true})
      .waitFor();
    assert.equal(
      await actions
        .getByRole('menuitem', {name: 'Reset examples', exact: true})
        .count(),
      0,
    );
    await page.keyboard.press('Escape');
    await actions.waitFor({state: 'hidden'});
    await location.click();
    await actions
      .locator('#browser-project-list')
      .getByRole('menuitem', {name: 'Default project', exact: true})
      .click();
    await page.waitForURL(url => !url.searchParams.has('workspace'));
    await location.click();
    await actions
      .getByRole('menuitem', {name: 'Open folder', exact: true})
      .waitFor();
    await currentManage.click();
    await projectActions.locator('[data-action="reset"]').waitFor();
    await page.keyboard.press('Escape');
    await projectActions.waitFor({state: 'hidden'});
    assert.equal(await actions.isVisible(), true);
    await page.keyboard.press('Escape');
    await actions.waitFor({state: 'hidden'});
    assert.equal(
      await location.evaluate(element => element === document.activeElement),
      true,
    );
    assert.equal(await location.innerText(), 'Default project');

    const lastProject = await page.evaluate(async () => {
      for (let index = 1; index <= 12; index++)
        await window.explorerApp.browserProjects.create(
          `Project ${index}`,
          false,
        );
      return window.explorerApp.browserProjects.projects.at(-1)!.name;
    });
    const lastProjectActions = await openBrowserProjectMenu(page, lastProject);
    await Promise.all([
      page.waitForEvent('load'),
      lastProjectActions
        .getByRole('menuitem', {name: 'Open', exact: true})
        .click(),
    ]);
    await browserProjectReady(page, lastProject);
    await location.click();
    const projectList = actions.locator('#browser-project-list');
    assert.equal(
      await currentProject.evaluate(element => {
        const item = element.getBoundingClientRect();
        const list = document
          .getElementById('browser-project-list')!
          .getBoundingClientRect();
        return item.top >= list.top && item.bottom <= list.bottom;
      }),
      true,
    );
    await currentManage.click();
    await projectActions.waitFor();
    await projectList.evaluate(element => {
      element.scrollTop = 0;
    });
    await projectActions.waitFor({state: 'hidden'});
    assert.equal(await actions.isVisible(), true);
    assert.equal(
      await currentProject.evaluate(
        element => element === document.activeElement,
      ),
      true,
    );
    await page.keyboard.press('ArrowDown');
    assert.equal(
      await actions
        .locator('#open-folder-button')
        .evaluate(element => element === document.activeElement),
      true,
    );
    await page.keyboard.press('Escape');
    await actions.waitFor({state: 'hidden'});
  },
);

test(
  'opening empty and existing local folders keeps each workspace separate',
  {timeout: 120_000},
  async t => {
    const example = {
      path: '/examples/demo.ts',
      source: 'export const size = 5;\n',
    };
    const page = await open(t, [example]);
    await mockLocalDirectories(page);
    // Reload once so the currently running App also uses the handle fixture.
    await page.reload();
    await active(page, '/model.ts');
    await page.evaluate(async () => {
      await window.explorerApp.projectFileSystem.writeFile(
        '/browser-only.txt',
        'browser',
      );
    });
    const selectFolder = async (name: string, createExamples = false) => {
      await page.evaluate(
        name => sessionStorage.setItem('nextFolder', name),
        name,
      );
      await page.locator('#project-location').click();
      await page.locator('#open-folder-button').click();
      if (createExamples)
        await page
          .getByRole('dialog', {name: 'Create examples', exact: true})
          .getByRole('button', {name: 'Create examples', exact: true})
          .click();
      await page.waitForURL(url => url.searchParams.get('workspace') === name);
      await page.waitForFunction(() => !!window.explorerApp);
      assert.equal(await page.locator('#project-location').innerText(), name);
      assert.equal(await page.locator('.project-status:visible').count(), 0);
    };
    await selectFolder('explorer-first', true);
    await active(page, undefined);
    assert.deepEqual(
      await page.evaluate(async () =>
        (await window.explorerApp.projectFileSystem.list('/'))
          .map(entry => entry.name)
          .sort(),
      ),
      ['.code3d', 'examples'],
    );
    await page.evaluate(async () => {
      const fs = window.explorerApp.projectFileSystem;
      await fs.writeFile('/first.ts', 'export const first = 1;');
      await fs.writeFile('/unopened/data.bin', new Uint8Array([0, 255, 128]));
      await window.explorerApp.activateProjectFile('/first.ts');
    });
    await active(page, '/first.ts');
    await selectFolder('explorer-second', true);
    await active(page, undefined);
    assert.deepEqual(
      await page.evaluate(async () =>
        (await window.explorerApp.projectFileSystem.list('/'))
          .map(entry => entry.name)
          .sort(),
      ),
      ['.code3d', 'examples'],
    );
    await page.evaluate(async () => {
      await window.explorerApp.projectFileSystem.writeFile(
        '/second.ts',
        'export const second = 2;',
      );
      await window.explorerApp.activateProjectFile('/second.ts');
    });
    await selectFolder('explorer-first');
    await active(page, '/first.ts');
    assert.deepEqual(
      await page.evaluate(async () => {
        const fs = window.explorerApp.projectFileSystem;
        return {
          binary: [...(await fs.readFile('/unopened/data.bin'))!],
          names: (await fs.list('/')).map(entry => entry.name).sort(),
        };
      }),
      {
        binary: [0, 255, 128],
        names: ['.code3d', 'examples', 'first.ts', 'unopened'],
      },
    );
    await page.locator('#project-location').click();
    await page
      .locator('#browser-project-list')
      .getByRole('menuitem', {name: 'Default project', exact: true})
      .click();
    await page.waitForURL(url => !url.searchParams.has('workspace'));
    await active(page, '/model.ts');
    assert.equal(
      await page.evaluate(async () =>
        new TextDecoder().decode(
          await window.explorerApp.projectFileSystem.readFile(
            '/browser-only.txt',
          ),
        ),
      ),
      'browser',
    );
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.projectFileSystem.stat('/first.ts'),
      ),
      undefined,
    );
  },
);

test(
  'only empty local folders ask to create examples and skipping preserves user files',
  {timeout: 150_000},
  async t => {
    const example = {
      path: '/examples/demo.ts',
      source: 'export const size = 5;\n',
    };
    const page = await open(t, [example]);
    await mockLocalDirectories(page);
    const prompts: string[] = [];
    const answer = async (accept: boolean) => {
      const dialog = page.getByRole('dialog', {
        name: 'Create examples',
        exact: true,
      });
      prompts.push(await dialog.locator('header p').innerText());
      await dialog
        .getByRole('button', {
          name: accept ? 'Create examples' : 'Cancel',
          exact: true,
        })
        .click();
    };
    const visit = async (name: string, accept?: boolean) => {
      const url = new URL(process.env.CODE3D_TEST_URL!);
      url.searchParams.set('workspace', name);
      await page.goto(url.href);
      if (accept !== undefined) await answer(accept);
      await active(page, undefined);
    };
    await visit('examples-skipped', false);
    assert.deepEqual(prompts, [emptyProjectExamplesMessage]);
    assert.deepEqual(
      await page.evaluate(async () =>
        (await window.explorerApp.projectFileSystem.list('/')).map(
          entry => entry.name,
        ),
      ),
      ['.code3d'],
    );
    await page.reload();
    await active(page, undefined);
    assert.equal(prompts.length, 1);
    assert.equal(await row(page, 'examples').count(), 0);

    // A skipped project can opt in explicitly from the root context menu.
    const scroll = page.locator('[data-file-tree-virtualized-scroll]');
    const bounds = (await scroll.boundingBox())!;
    await page.mouse.click(bounds.x + 20, bounds.y + bounds.height - 12, {
      button: 'right',
    });
    await page
      .getByRole('menuitem', {name: 'Create examples', exact: true})
      .click();
    await answer(true);
    await row(page, 'examples').waitFor();
    assert.equal(prompts.length, 2);
    await page.reload();
    await active(page, undefined);
    await row(page, 'examples').waitFor();
    assert.equal(prompts.length, 2);

    // Nonempty roots and existing user examples are never implicitly seeded.
    await page.evaluate(async () => {
      const {openDirectoryProjectFileSystem} =
        await import('/src/project/filesystem.ts');
      const root = await navigator.storage.getDirectory();
      for (const name of [
        'existing-readme',
        'existing-examples',
        'existing-hidden',
      ]) {
        const fs = await openDirectoryProjectFileSystem(
          await root.getDirectoryHandle(name, {create: true}),
        );
        if (name === 'existing-hidden') await fs.createDirectory('/.git');
        else await fs.writeFile('/README.md', 'user project');
        if (name === 'existing-examples')
          await fs.writeFile('/examples/keep.txt', 'user example');
      }
    });
    for (const name of [
      'existing-readme',
      'existing-examples',
      'existing-hidden',
    ]) {
      await visit(name);
      assert.equal(prompts.length, 2, name);
      assert.equal(
        await page.evaluate(() =>
          window.explorerApp.projectFileSystem.stat('/examples/demo.ts'),
        ),
        undefined,
      );
      if (name === 'existing-examples') {
        assert.equal(
          await page.evaluate(async () =>
            new TextDecoder().decode(
              await window.explorerApp.projectFileSystem.readFile(
                '/examples/keep.txt',
              ),
            ),
          ),
          'user example',
        );
      }
    }
  },
);

test(
  'Reset examples is scoped to the examples folder and confirms before replacing it',
  {timeout: 90_000},
  async t => {
    const example = {
      path: '/examples/demo.ts',
      source: 'export const size = 5;\n',
    };
    const page = await open(t, [example]);
    await page.evaluate(async () => {
      const fs = window.explorerApp.projectFileSystem;
      await fs.writeFile('/examples/demo.ts', 'export const edited = true;');
      await fs.writeFile('/examples/custom.txt', 'remove me');
      await fs.writeFile('/keep.txt', 'keep me');
      await window.explorerApp.projectDirectory.refresh();
    });
    await row(page, 'src').click({button: 'right'});
    assert.equal(
      await page
        .getByRole('button', {name: 'Reset examples', exact: true})
        .count(),
      0,
    );
    await page.keyboard.press('Escape');
    await page.evaluate(() =>
      window.explorerApp.activateProjectFile('/examples/demo.ts'),
    );
    await active(page, '/examples/demo.ts');
    await menu(page, 'examples', 'Reset examples');
    await page
      .getByRole('dialog', {name: 'Reset examples', exact: true})
      .getByRole('button', {name: 'Cancel', exact: true})
      .click();
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.codeEditor.editor.getValue(),
      ),
      'export const edited = true;',
    );
    await menu(page, 'examples', 'Reset examples');
    await page
      .getByRole('dialog', {name: 'Reset examples', exact: true})
      .getByRole('button', {name: 'Reset examples', exact: true})
      .click();
    await page.waitForFunction(
      source => window.explorerApp.codeEditor.editor.getValue() === source,
      example.source,
    );
    assert.deepEqual(
      await page.evaluate(async () => {
        const fs = window.explorerApp.projectFileSystem;
        return {
          examples: (await fs.list('/examples')).map(entry => entry.name),
          kept: new TextDecoder().decode(await fs.readFile('/keep.txt')),
        };
      }),
      {examples: ['demo.ts'], kept: 'keep me'},
    );
  },
);

test(
  'text files use their language, external deletion closes stale tabs, and recreated files survive reload',
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
      .getByRole('button', {
        name: 'Refresh files and dependencies',
        exact: true,
      })
      .click();
    await row(page, 'external.txt').waitFor();
    assert.equal(await row(page, 'README.md').count(), 0);
    await active(page, '/model.ts');
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.codeEditor.fileState('/README.md'),
      ),
      undefined,
    );
    await create(page, 'file', 'README.md');
    await active(page, '/README.md');
    await page.evaluate(async () => {
      const {codeEditor, agentProject} = window.explorerApp;
      codeEditor.editor.setPosition({lineNumber: 1, column: 1});
      codeEditor.editor.trigger('test', 'type', {text: 'Saved text\n'});
      await agentProject.flush();
    });
    await row(page, 'README.md').waitFor();
    await page.reload();
    await active(page, '/README.md');
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.codeEditor
          .fileState('/README.md')!
          .content.replaceAll('\r\n', '\n'),
      ),
      'Saved text\n',
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
    const name = page.getByRole('textbox', {
      name: 'New file name',
      exact: true,
    });
    await name.fill('root-note.txt');
    await name.press('Enter');
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
      await fs.initialize();
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
    await menu(page, 'part copy.ts', 'Delete');
    const confirmation = page.getByRole('dialog', {
      name: 'Delete entries',
      exact: true,
    });
    assert.match(await confirmation.innerText(), /part copy\.ts/);
    await confirmation
      .getByRole('button', {name: 'Cancel', exact: true})
      .click();
    assert.equal(
      await page.evaluate(
        async () =>
          (await window.explorerApp.projectFileSystem.stat('/src/part copy.ts'))
            ?.kind,
      ),
      'file',
    );
    await menu(page, 'part copy.ts', 'Delete');
    await confirmation
      .getByRole('button', {name: 'Delete', exact: true})
      .click();
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

test(
  'an unopened browser project copies to a local folder without switching the source first',
  {timeout: 150_000},
  async t => {
    const page = await open(t, [
      {path: '/examples/sample.ts', source: 'export const sample = 1;'},
    ]);
    await newBrowserProject(page, 'Unopened copy source');
    const sourceId = new URL(page.url()).searchParams.get('project');
    await page.evaluate(async () => {
      const files = window.explorerApp.projectFileSystem;
      await files.createDirectory('/assets/empty');
      await files.writeFile(
        '/assets/source.bin',
        new Uint8Array([4, 0, 255, 18]),
      );
      await files.writeFile(
        '/examples/sample.ts',
        'export const copiedExample = 7;',
      );
      await files.writeFile('/node_modules/custom/ignored.js', 'ignored');
    });
    await selectBrowserProject(page, 'Default project');
    await mockLocalDirectories(page);
    await page.reload();
    await browserProjectReady(page, 'Default project');
    await page.evaluate(() => {
      sessionStorage.setItem('nextFolder', 'unopened-copy');
      window.explorerApp.codeEditor.editor.setValue(
        "import {box} from '@code3d/core';\nexport default box(31, 6, 8);\n",
      );
    });
    await (
      await openBrowserProjectMenu(page, 'Unopened copy source')
    )
      .locator('[data-action="copy"]')
      .click();
    await page.waitForURL(
      url => url.searchParams.get('workspace') === 'unopened-copy',
    );
    await page.locator('#project-location[data-kind="local"]').waitFor();
    await page.waitForFunction(() => !!window.explorerApp);
    assert.deepEqual(
      await page.evaluate(async () => {
        const files = window.explorerApp.projectFileSystem;
        return {
          model: new TextDecoder().decode(await files.readFile('/model.ts')),
          example: new TextDecoder().decode(
            await files.readFile('/examples/sample.ts'),
          ),
          bytes: [...(await files.readFile('/assets/source.bin'))!],
          empty: (await files.stat('/assets/empty'))?.kind,
          generated: await files.stat('/node_modules/custom/ignored.js'),
        };
      }),
      {
        model:
          "import {box} from '@code3d/core';\nexport default box(10, 6, 8);\n",
        example: 'export const copiedExample = 7;',
        bytes: [4, 0, 255, 18],
        empty: 'directory',
        generated: undefined,
      },
    );
    await selectBrowserProject(page, 'Default project');
    assert.match(
      await page.evaluate(() =>
        window.explorerApp.codeEditor.editor.getValue(),
      ),
      /box\(31, 6, 8\)/,
    );
    await selectBrowserProject(page, 'Unopened copy source');
    assert.equal(new URL(page.url()).searchParams.get('project'), sourceId);
    assert.deepEqual(
      await page.evaluate(async () => [
        ...(await window.explorerApp.projectFileSystem.readFile(
          '/assets/source.bin',
        ))!,
      ]),
      [4, 0, 255, 18],
    );
    assert.equal(
      await page.evaluate(async () =>
        new TextDecoder().decode(
          await window.explorerApp.projectFileSystem.readFile(
            '/node_modules/custom/ignored.js',
          ),
        ),
      ),
      'ignored',
    );
  },
);

test(
  'browser storage copies project bytes and examples to a local folder without generated files',
  {timeout: 90_000},
  async t => {
    const page = await open(t, [
      {path: '/examples/sample.ts', source: 'export const sample = 1;'},
    ]);
    await newBrowserProject(page, 'Copy source');
    const browserId = new URL(page.url()).searchParams.get('project');
    await mockLocalDirectories(page);
    await page.reload();
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await page.evaluate(async () => {
      sessionStorage.setItem('nextFolder', 'exported-project');
      const {projectFileSystem: files, codeEditor} = window.explorerApp;
      await files.createDirectory('/assets/empty');
      await files.writeFile(
        '/assets/image.bin',
        new Uint8Array([0, 255, 128, 1]),
      );
      await files.writeFile('/.config/settings.json', '{"keep":true}');
      for (const path of [
        '/node_modules/ignore.ts',
        '/examples/node_modules/ignore.ts',
        '/.code3d/internal',
        '/examples/.code3d/internal',
        '/code3d-lock.json',
        '/examples/code3d-lock.json',
      ])
        await files.writeFile(path, 'skip');
      await window.explorerApp.activateProjectFile('/src/part.ts');
      codeEditor.editor.setValue('export const size = 42;\n');
    });
    await (
      await openBrowserProjectMenu(page)
    )
      .locator('[data-action="copy"]')
      .click();
    await page.waitForURL(
      url => url.searchParams.get('workspace') === 'exported-project',
    );
    await page.locator('#project-location[data-kind="local"]').waitFor();
    assert.ok(page.url().endsWith('#/file/src/part.ts'));
    assert.deepEqual(
      await page.evaluate(async () => {
        const root = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('exported-project');
        const examples = await root.getDirectoryHandle('examples');
        const assets = await root.getDirectoryHandle('assets');
        const text = async (
          directory: FileSystemDirectoryHandle,
          name: string,
        ) => (await (await directory.getFileHandle(name)).getFile()).text();
        const exists = async (
          directory: FileSystemDirectoryHandle,
          name: string,
          kind: 'file' | 'directory',
        ) => {
          try {
            if (kind === 'file') await directory.getFileHandle(name);
            else await directory.getDirectoryHandle(name);
            return true;
          } catch (error) {
            if (error instanceof DOMException && error.name === 'NotFoundError')
              return false;
            throw error;
          }
        };
        return {
          part: await text(await root.getDirectoryHandle('src'), 'part.ts'),
          example: await text(examples, 'sample.ts'),
          config: await text(
            await root.getDirectoryHandle('.config'),
            'settings.json',
          ),
          bytes: [
            ...new Uint8Array(
              await (
                await (await assets.getFileHandle('image.bin')).getFile()
              ).arrayBuffer(),
            ),
          ],
          empty: (await assets.getDirectoryHandle('empty')).kind,
          generated: await Promise.all([
            exists(root, 'node_modules', 'directory'),
            exists(root, 'code3d-lock.json', 'file'),
            exists(examples, 'node_modules', 'directory'),
            exists(examples, '.code3d', 'directory'),
            exists(examples, 'code3d-lock.json', 'file'),
            exists(
              await root.getDirectoryHandle('.code3d'),
              'internal',
              'file',
            ),
          ]),
        };
      }),
      {
        part: 'export const size = 42;\n',
        example: 'export const sample = 1;',
        config: '{"keep":true}',
        bytes: [0, 255, 128, 1],
        empty: 'directory',
        generated: [false, false, false, false, false, false],
      },
    );
    await page.locator('#project-location').click();
    assert.equal(
      await page.locator('.project-storage-submenu:popover-open').count(),
      0,
    );
    await page
      .locator('#browser-project-list')
      .getByRole('menuitem', {name: 'Copy source', exact: true})
      .click();
    await page.locator('#project-location[data-kind="browser"]').waitFor();
    await browserProjectReady(page, 'Copy source');
    assert.equal(new URL(page.url()).searchParams.get('project'), browserId);
    assert.equal(
      await page.evaluate(async () =>
        new TextDecoder().decode(
          await window.explorerApp.projectFileSystem.readFile('/src/part.ts'),
        ),
      ),
      'export const size = 42;\n',
    );
    assert.deepEqual(
      await page.evaluate(async () => [
        ...(await window.explorerApp.projectFileSystem.readFile(
          '/assets/image.bin',
        ))!,
      ]),
      [0, 255, 128, 1],
    );
  },
);

test(
  'copy to local cancels safely and rejects nonempty targets and failed reads',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await mockLocalDirectories(page);
    await page.reload();
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    const originalUrl = page.url();
    const copy = async () => {
      await (
        await openBrowserProjectMenu(page)
      )
        .locator('[data-action="copy"]')
        .click();
      await page.waitForFunction(
        () =>
          !(document.getElementById('project-location') as HTMLButtonElement)
            .disabled,
      );
    };
    await page.evaluate(() =>
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async () => {
          throw new DOMException('Cancelled', 'AbortError');
        },
      }),
    );
    await copy();
    assert.equal(page.url(), originalUrl);
    await mockLocalDirectories(page);
    await page.evaluate(async () => {
      sessionStorage.setItem('nextFolder', 'occupied');
      const directory = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('occupied', {create: true});
      const output = await (
        await directory.getFileHandle('keep.txt', {create: true})
      ).createWritable();
      await output.write('keep');
      await output.close();
    });
    await copy();
    await page
      .getByText(
        'Choose an empty folder to copy this project. Existing files were not changed.',
        {exact: true},
      )
      .waitFor();
    assert.equal(page.url(), originalUrl);
    assert.equal(
      await page.evaluate(async () => {
        const directory = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('occupied');
        return (
          await (await directory.getFileHandle('keep.txt')).getFile()
        ).text();
      }),
      'keep',
    );
    await page.evaluate(() => {
      sessionStorage.setItem('nextFolder', 'failed');
      const files = window.explorerApp.projectFileSystem;
      const read = files.readFile.bind(files);
      files.readFile = async path => {
        if (path === '/README.md') throw new Error('Read failed for export');
        return read(path);
      };
    });
    await copy();
    await page.getByText(/Copy failed.*Read failed for export/).waitFor();
    assert.equal(page.url(), originalUrl);
    assert.equal(
      await page.evaluate(() =>
        window.explorerApp.codeEditor.editor.getValue(),
      ),
      "import {box} from '@code3d/core';\nexport default box(10, 6, 8);\n",
    );
  },
);

test(
  'copy to local preserves edits made while the copy is in flight',
  {timeout: 90_000},
  async t => {
    const page = await open(t);
    await mockLocalDirectories(page);
    await page.reload();
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    const originalUrl = page.url();
    await page.evaluate(() => {
      sessionStorage.setItem('nextFolder', 'edited-during-copy');
      const files = window.explorerApp.projectFileSystem;
      const read = files.readFile.bind(files);
      files.readFile = async path => {
        if (path === '/README.md')
          await new Promise<void>(resolve => {
            window.releaseExportRead = resolve;
          });
        return read(path);
      };
    });
    await (
      await openBrowserProjectMenu(page)
    )
      .locator('[data-action="copy"]')
      .click();
    await page.waitForFunction(() => !!window.releaseExportRead);
    assert.equal(await page.locator('#open-folder-button').isDisabled(), true);
    await page.evaluate(() => {
      window.explorerApp.codeEditor.editor.setValue(
        'export const latest = 123;',
      );
      window.releaseExportRead!();
    });
    await page.getByText(/The project changed while copying/).waitFor();
    assert.equal(page.url(), originalUrl);
    assert.equal(await page.locator('#open-folder-button').isEnabled(), true);
    assert.equal(
      await page.evaluate(async () => {
        await window.explorerApp.agentProject.flush();
        return new TextDecoder().decode(
          await window.explorerApp.projectFileSystem.readFile('/model.ts'),
        );
      }),
      'export const latest = 123;',
    );
  },
);
