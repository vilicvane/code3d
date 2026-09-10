import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

declare const window: Window & {
  packageApp: {
    runModel(): Promise<void>;
    codeEditor: import('../../src/editor.ts').CodeEditor;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
    projectFileSystem: import('../../src/project/filesystem.ts').BrowserProjectFileSystem;
  };
};

const modelSource =
  "import {box} from '@code3d/core';\nimport {Delaunay} from 'd3-delaunay';\nexport default box(Delaunay.from([[0,0],[20,0],[0,20]]).points.length, 10, 5);\n";

async function exposePackageApp(
  page: import('playwright-core').Page,
): Promise<void> {
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.packageApp = {codeEditor, compiler, projectFileSystem, runModel};',
    });
  });
}

const seed = {
  files: ['a', 'b'].flatMap((folder, index) => [
    {
      path: `/${folder}/package.json`,
      source: JSON.stringify({
        private: true,
        type: 'module',
        dependencies: {
          'd3-delaunay': index ? '6.0.3' : '6.0.4',
          '@types/d3-delaunay': '6.0.4',
        },
      }),
    },
    {path: `/${folder}/model.ts`, source: modelSource},
  ]),
};

test(
  'bundled package example supports Peek-to-tab navigation and source reload in a fresh browser workspace',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await exposePackageApp(page);
    const packageRequests: string[] = [];
    page.on('request', request => {
      if (request.url().startsWith('https://registry.npmjs.org/'))
        packageRequests.push(request.url());
    });
    const errors: string[] = [];
    page.on('pageerror', error => {
      // Monaco's AbstractTree disposes its pending active-node Delayer when
      // Peek closes. Its uncaught cancellation is independent of the opener;
      // retain every other error, including cancellations from App code.
      if (
        error.message === 'Canceled' &&
        error.stack?.includes('Delayer.cancel') &&
        error.stack.includes('ReferenceWidget.dispose')
      )
        return;
      errors.push(error.message);
    });
    const route = '#/file/examples/patterns/post-array/model.ts';
    // Do not inject a project or files: the public link must work for a new user.
    await page.goto(process.env.CODE3D_TEST_URL + route);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 90_000});
    assert.equal(new URL(page.url()).hash, route);
    const installed = await page.evaluate(async () => {
      const {openBrowserProjectFileSystem} =
        await import('/src/project/filesystem.ts');
      const files = await openBrowserProjectFileSystem();
      const root = '/examples/patterns/post-array';
      return {
        source: new TextDecoder().decode(
          await files.readFile(root + '/model.ts'),
        ),
        manifest: new TextDecoder().decode(
          await files.readFile(root + '/package.json'),
        ),
        lock: !!(await files.stat(root + '/code3d-lock.json')),
        package: !!(await files.stat(
          root + '/node_modules/just-range/index.mjs',
        )),
      };
    });
    assert.match(installed.source, /import range from 'just-range'/);
    assert.match(installed.manifest, /\n  "private": true,/);
    assert.equal(installed.lock, true);
    assert.equal(installed.package, true);

    const requestCount = packageRequests.length;
    const editPhases = await page.evaluate(async () => {
      const {codeEditor, compiler, runModel} = window.packageApp;
      const phases: string[] = [];
      const compile = compiler.compile;
      compiler.compile = (project, rootPath, designContext, onProgress) =>
        compile.call(compiler, project, rootPath, designContext, phase => {
          phases.push(phase);
          onProgress?.(phase);
        });
      try {
        const model = codeEditor.editor.getModel()!;
        model.setValue(model.getValue().replace('count = 5', 'count = 6'));
        await runModel();
        return phases;
      } finally {
        compiler.compile = compile;
      }
    });
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.equal(
      packageRequests.length,
      requestCount,
      'source edits do not request npm metadata or archives again',
    );
    assert.deepEqual(editPhases, ['compiling-model', 'evaluating-model']);

    await page
      .getByRole('treeitem', {name: 'package.json', exact: true})
      .click();
    await page.waitForFunction(() =>
      window.packageApp.codeEditor
        .currentFile()
        ?.endsWith('/post-array/package.json'),
    );
    assert.equal(
      await page.evaluate(() => window.packageApp.codeEditor.editor.getValue()),
      installed.manifest,
      'opening package.json in the explorer preserves the stored manifest with its original formatting and field order',
    );
    await page.reload();
    await page.waitForFunction(() =>
      window.packageApp?.codeEditor.currentFile()?.endsWith('/package.json'),
    );
    assert.equal(
      await page.evaluate(() => window.packageApp.codeEditor.editor.getValue()),
      installed.manifest,
      'reloading the manifest preserves the same source text',
    );
    await page.evaluate(() =>
      window.packageApp.codeEditor.openFile(
        '/examples/patterns/post-array/model.ts',
      ),
    );
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 90_000});

    await page.evaluate(() => {
      const {editor} = window.packageApp.codeEditor;
      const model = editor.getModel()!;
      editor.setPosition(
        model.getPositionAt(model.getValue().indexOf('range') + 1),
      );
      editor.focus();
    });
    await page.keyboard.press('F12');
    await page.locator('.reference-zone-widget').waitFor();
    await page
      .locator('.reference-zone-widget .monaco-list-row')
      .filter({hasText: 'function range'})
      .first()
      .dblclick();
    await page.waitForFunction(() =>
      window.packageApp.codeEditor
        .currentFile()
        ?.endsWith('/just-range/index.d.ts'),
    );
    const definitionPath = await page.evaluate(() =>
      window.packageApp.codeEditor.currentFile()!,
    );
    assert.ok(
      definitionPath.includes('just-range@4.2.0') &&
        !definitionPath.includes('%'),
      'package directory names retain readable @ characters',
    );
    await page.reload();
    await page.waitForFunction(
      path => window.packageApp?.codeEditor.currentFile() === path,
      definitionPath,
    );
    assert.equal(
      await page.evaluate(
        () => window.packageApp.codeEditor.editor.getRawOptions().readOnly,
      ),
      true,
    );
    assert.match(
      await page.evaluate(() => window.packageApp.codeEditor.editor.getValue()),
      /declare function range/,
    );

    // The package's implementation is also a directly addressable, read-only document.
    await page.goto(
      process.env.CODE3D_TEST_URL +
        '#/file/examples/patterns/post-array/node_modules/just-range/index.mjs',
    );
    await page.waitForFunction(() =>
      window.packageApp?.codeEditor
        .currentFile()
        ?.endsWith('/just-range/index.mjs'),
    );
    assert.match(
      await page.evaluate(() => window.packageApp.codeEditor.editor.getValue()),
      /function range/,
    );
    assert.equal(
      await page.evaluate(
        () => window.packageApp.codeEditor.editor.getRawOptions().readOnly,
      ),
      true,
    );
    assert.deepEqual(errors, []);
  },
);

test(
  'browser npm install, nested versions, navigation and offline lock restoration',
  {timeout: 180_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1500, height: 960},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().startsWith('https://registry.npmjs.org/'))
        requests.push(request.url());
    });
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export const defaultProject = ${JSON.stringify(seed)};`,
      }),
    );
    await exposePackageApp(page);
    const root = process.env.CODE3D_TEST_URL.replace(/\/$/, '');
    await page.goto(root + '/#/file/a/model.ts');
    const ready = () =>
      page.getByText('Ready', {exact: true}).waitFor({timeout: 90_000});
    await ready();
    const installed = await page.evaluate(async () => {
      const {projectFileSystem: files, codeEditor} = window.packageApp;
      const {projectTypeScriptWorker} =
        await import('/src/monaco/typescript-worker-client.ts');
      const model = codeEditor.editor.getModel()!;
      const worker = await projectTypeScriptWorker('typescript', model.uri);
      return {
        lock: JSON.parse(
          new TextDecoder().decode(await files.readFile('/a/code3d-lock.json')),
        ),
        otherInstalled: !!(await files.stat('/b/node_modules')),
        diagnostics: await worker.getSemanticDiagnostics(model.uri.toString()),
      };
    });
    assert.ok(
      installed.lock.packages['https://registry.npmjs.org/d3-delaunay/6.0.4/'],
    );
    assert.equal(installed.otherInstalled, false);
    assert.deepEqual(installed.diagnostics, []);

    // Exercise Monaco's real F12 action and the App opener, including declaration maps.
    await page.evaluate(async () => {
      const {codeEditor} = window.packageApp;
      const model = codeEditor.editor.getModel()!;
      codeEditor.editor.setPosition(
        model.getPositionAt(model.getValue().lastIndexOf('box(') + 1),
      );
      codeEditor.editor.focus();
    });
    await page.keyboard.press('F12');
    await page.waitForFunction(() =>
      window.packageApp.codeEditor.currentFile()?.includes('/node_modules/'),
    );
    const definition = await page.evaluate(() => {
      const {codeEditor} = window.packageApp;
      codeEditor.setReadOnly(true);
      codeEditor.setReadOnly(false);
      return {
        file: codeEditor.currentFile(),
        editable: codeEditor.isModelFile(codeEditor.currentFile()!),
        included: codeEditor
          .project()
          .files.some(file => file.path.includes('/node_modules/')),
        readOnly: codeEditor.editor.getRawOptions().readOnly,
      };
    });
    assert.match(definition.file!, /\/src\/library\/runtime\.ts$/);
    assert.equal(definition.editable, false);
    assert.equal(definition.included, false);
    assert.equal(
      definition.readOnly,
      true,
      'a completed explorer operation keeps package sources read-only',
    );

    await page.evaluate(() =>
      window.packageApp.codeEditor.openFile('/a/model.ts'),
    );
    await ready();
    const before = requests.length;
    await page.route('https://registry.npmjs.org/**', route => route.abort());
    await page.reload();
    await ready();
    assert.equal(
      requests.length,
      before,
      'reopen uses installed lock without contacting registry',
    );
    await page.evaluate(() =>
      window.packageApp.projectFileSystem.remove('/a/node_modules'),
    );
    await page.reload();
    await ready();
    assert.equal(
      requests.length,
      before,
      'missing installation restores from verified archive cache without resolving again',
    );
    assert.equal(
      await page.evaluate(
        async () =>
          !!(await window.packageApp.projectFileSystem.stat(
            '/a/node_modules/d3-delaunay/src/index.js',
          )),
      ),
      true,
    );
    await page.unroute('https://registry.npmjs.org/**');
    await page.evaluate(() =>
      window.packageApp.codeEditor.openFile('/b/model.ts'),
    );
    await page.waitForFunction(
      async () =>
        !!(await window.packageApp.projectFileSystem.stat(
          '/b/code3d-lock.json',
        )),
    );
    await ready();
    const other = await page.evaluate(async () =>
      JSON.parse(
        new TextDecoder().decode(
          await window.packageApp.projectFileSystem.readFile(
            '/b/code3d-lock.json',
          ),
        ),
      ),
    );
    assert.ok(other.packages['https://registry.npmjs.org/d3-delaunay/6.0.3/']);
    await page.locator('[data-item-path="b/package.json"]').click();
    await page.waitForFunction(
      () => window.packageApp.codeEditor.currentFile() === '/b/package.json',
    );
    await page
      .locator('[data-item-path="b/package.json"]')
      .click({button: 'right'});
    await page
      .getByRole('menuitem', {name: 'Install package', exact: true})
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Install package',
      exact: true,
    });
    await dialog
      .getByRole('textbox', {name: 'Package', exact: true})
      .fill('d3-delaunay@6.0.4');
    await dialog.getByRole('button', {name: 'Install', exact: true}).click();
    await page.getByText('Packages installed', {exact: true}).waitFor();
    assert.ok(
      await page.evaluate(async () => {
        const bytes = await window.packageApp.projectFileSystem.readFile(
          '/b/code3d-lock.json',
        );
        return JSON.parse(new TextDecoder().decode(bytes)).packages[
          'https://registry.npmjs.org/d3-delaunay/6.0.4/'
        ];
      }),
      'contextual installation updates an existing manifest and replaces its lock',
    );
    assert.deepEqual(errors, []);
  },
);

test(
  'folder installation creates core dependencies and redirects node_modules actions to the owning project',
  {timeout: 240_000},
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
    page.setDefaultTimeout(20_000);
    const activeDownloads = new Set<import('playwright-core').Request>();
    let peakDownloads = 0;
    page.on('request', request => {
      if (request.url().endsWith('.tgz')) {
        activeDownloads.add(request);
        peakDownloads = Math.max(peakDownloads, activeDownloads.size);
      }
    });
    const downloadFinished = (request: import('playwright-core').Request) =>
      activeDownloads.delete(request);
    page.on('requestfinished', downloadFinished);
    page.on('requestfailed', downloadFinished);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await exposePackageApp(page);
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          'export const defaultProject = ' +
          JSON.stringify({
            files: [
              {
                path: '/model.ts',
                source:
                  "import {box} from '@code3d/core'; export default box(10, 8, 6);",
              },
              {
                path: '/panel/model.ts',
                source:
                  "import {box} from '@code3d/core'; export default box(10, 8, 6);",
              },
            ],
          }),
      }),
    );
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 90_000});
    assert.equal(
      await page.getByRole('button', {name: 'Packages', exact: true}).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole('button', {name: 'Install packages', exact: true})
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        async () =>
          !!(await window.packageApp.projectFileSystem.stat('/package.json')),
      ),
      false,
      'zero-install model does not create a manifest',
    );
    const folder = page.getByRole('treeitem', {name: 'panel', exact: true});
    await folder.click({button: 'right'});
    await page
      .getByRole('menuitem', {name: 'Install package', exact: true})
      .click();
    let dialog = page.getByRole('dialog', {
      name: 'Install package',
      exact: true,
    });
    assert.equal(await dialog.locator('header p').textContent(), 'In /panel');
    await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
    assert.equal(
      await page.evaluate(
        async () =>
          !!(await window.packageApp.projectFileSystem.stat(
            '/panel/package.json',
          )),
      ),
      false,
    );
    await folder.click({button: 'right'});
    await page
      .getByRole('menuitem', {name: 'Install package', exact: true})
      .click();
    dialog = page.getByRole('dialog', {name: 'Install package', exact: true});
    await dialog
      .getByRole('textbox', {name: 'Package', exact: true})
      .fill('just-range@4.2.0');
    const installationStart = Date.now();
    await dialog.getByRole('button', {name: 'Install', exact: true}).click();
    await page
      .getByText('Packages installed', {exact: true})
      .waitFor({timeout: 150_000});
    assert.ok(
      peakDownloads > 1 && peakDownloads <= 15,
      `npm archives download concurrently within the limit: observed ${peakDownloads}`,
    );
    t.diagnostic(
      `Cold npm installation: ${Date.now() - installationStart} ms; peak ${peakDownloads} concurrent archive requests`,
    );
    const installed = await page.evaluate(async () => {
      const files = window.packageApp.projectFileSystem;
      const source = new TextDecoder().decode(
        await files.readFile('/panel/package.json'),
      );
      return {
        source,
        manifest: JSON.parse(source),
        lock: JSON.parse(
          new TextDecoder().decode(
            await files.readFile('/panel/code3d-lock.json'),
          ),
        ),
        root: !!(await files.stat('/package.json')),
      };
    });
    assert.deepEqual(installed.manifest.dependencies, {
      '@code3d/core': 'latest',
      'just-range': '4.2.0',
    });
    assert.equal(installed.root, false);
    assert.ok(
      Object.values(installed.lock.packages).some(
        (pkg: any) => pkg.name === '@code3d/core',
      ),
    );
    assert.equal(
      await page.evaluate(() => window.packageApp.codeEditor.editor.getValue()),
      installed.source,
    );
    await page.evaluate(() =>
      window.packageApp.codeEditor.openFile('/panel/model.ts'),
    );
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 90_000});
    const warmEdit = await page.evaluate(async () => {
      const {projectFileSystem, codeEditor, runModel} = window.packageApp;
      const stat = projectFileSystem.stat;
      const checked: string[] = [];
      projectFileSystem.stat = async function (path) {
        if (path.includes('/node_modules/')) checked.push(path);
        return stat.call(this, path);
      };
      const start = performance.now();
      try {
        const model = codeEditor.editor.getModel()!;
        model.setValue(model.getValue().replace('box(10,', 'box(12,'));
        await runModel();
        return {checked, milliseconds: performance.now() - start};
      } finally {
        projectFileSystem.stat = stat;
      }
    });
    const installedChecks = warmEdit.checked.filter(path =>
      path.startsWith('/panel/node_modules/'),
    );
    assert.ok(
      installedChecks.length < 20,
      `warm model edits should check installation markers, not every installed file: ${JSON.stringify(warmEdit.checked)}`,
    );
    t.diagnostic(
      `Installed core warm edit: ${Math.round(warmEdit.milliseconds)} ms; ${installedChecks.length} installed-tree checks; other scopes: ${JSON.stringify(warmEdit.checked.filter(path => !path.startsWith('/panel/node_modules/')))}`,
    );
    const definition = await page.evaluate(async () => {
      const {codeEditor} = window.packageApp;
      const model = codeEditor.editor.getModel()!;
      const {projectTypeScriptWorker} =
        await import('/src/monaco/typescript-worker-client.ts');
      const worker = await projectTypeScriptWorker('typescript', model.uri);
      return worker.getDefinitionAtPosition(
        model.uri.toString(),
        model.getValue().indexOf('box') + 1,
      );
    });
    assert.ok(definition?.length);
    const sourcePath = decodeURIComponent(definition[0].fileName).replace(
      /^file:\/\/\/workspace/,
      '',
    );
    assert.match(sourcePath, /\/panel\/node_modules\/.*core\/src\//);
    await page.evaluate(
      path => window.packageApp.codeEditor.openFile(path),
      sourcePath,
    );
    assert.equal(
      await page.evaluate(
        () => window.packageApp.codeEditor.editor.getRawOptions().readOnly,
      ),
      true,
    );
    // Opening the public entry reveals the physical dependency subtree in the explorer.
    await page.evaluate(() =>
      window.packageApp.codeEditor.openFile(
        '/panel/node_modules/just-range/index.mjs',
      ),
    );
    const dependency = page.locator(
      '[data-item-path="panel/node_modules/just-range/"]',
    );
    await dependency.click({button: 'right'});
    await page
      .getByRole('menuitem', {name: 'Install package', exact: true})
      .click();
    dialog = page.getByRole('dialog', {name: 'Install package', exact: true});
    assert.equal(await dialog.locator('header p').textContent(), 'In /panel');
    await dialog
      .getByRole('textbox', {name: 'Package', exact: true})
      .fill('just-range@4.2.0');
    await dialog.getByRole('button', {name: 'Install', exact: true}).click();
    await page
      .getByText('Packages installed', {exact: true})
      .waitFor({timeout: 60_000});
    assert.equal(
      await page.evaluate(
        async () =>
          JSON.parse(
            new TextDecoder().decode(
              await window.packageApp.projectFileSystem.readFile(
                '/panel/node_modules/just-range/package.json',
              ),
            ),
          ).name,
      ),
      'just-range',
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        window.packageApp?.codeEditor.currentFile() === '/panel/package.json',
    );
    assert.equal(
      await page.evaluate(() => window.packageApp.codeEditor.editor.getValue()),
      installed.source,
    );
    assert.deepEqual(errors, []);
  },
);

test(
  'package downloads allow file navigation and editing without taking over the active model',
  {timeout: 120_000},
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
    await exposePackageApp(page);
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          'export const defaultProject = ' +
          JSON.stringify({
            files: [
              {
                path: '/model.ts',
                source:
                  "import {box} from '@code3d/core'; export default box(10, 8, 6);",
              },
              {path: '/notes.md', source: '# Notes'},
              {path: '/panel/package.json', source: '{"private":true}'},
              {
                path: '/panel/model.ts',
                source:
                  "import {box} from '@code3d/core'; import range from 'just-range'; export default box(range(3).length, 8, 6);",
              },
            ],
          }),
      }),
    );
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let downloading!: () => void;
    const started = new Promise<void>(resolve => {
      downloading = resolve;
    });
    await page.route(
      'https://registry.npmjs.org/just-range/-/*.tgz',
      async route => {
        downloading();
        await gate;
        await route.continue();
      },
    );
    try {
      await page.goto(process.env.CODE3D_TEST_URL);
      await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
      await page
        .getByRole('treeitem', {name: 'panel', exact: true})
        .click({button: 'right'});
      await page
        .getByRole('menuitem', {name: 'Install package', exact: true})
        .click();
      const dialog = page.getByRole('dialog', {
        name: 'Install package',
        exact: true,
      });
      await dialog
        .getByRole('textbox', {name: 'Package', exact: true})
        .fill('just-range@4.2.0');
      await dialog.getByRole('button', {name: 'Install', exact: true}).click();
      await started;
      await page
        .getByRole('treeitem', {name: 'notes.md', exact: true})
        .click({timeout: 3000});
      await page.waitForFunction(
        () => window.packageApp.codeEditor.currentFile() === '/notes.md',
      );
      assert.equal(
        await page.evaluate(
          () => window.packageApp.codeEditor.editor.getRawOptions().readOnly,
        ),
        false,
      );
      await page.evaluate(() =>
        window.packageApp.codeEditor.editor.trigger('test', 'type', {
          text: 'Editable during installation\n',
        }),
      );
      await page.waitForFunction(async () =>
        new TextDecoder()
          .decode(
            await window.packageApp.projectFileSystem.readFile('/notes.md'),
          )
          .includes('Editable during installation'),
      );
      await page
        .locator('[data-item-path="panel/model.ts"]')
        .click({timeout: 3000});
      await page.waitForFunction(
        () => window.packageApp.codeEditor.currentFile() === '/panel/model.ts',
      );
      await page.locator('[data-item-path="model.ts"]').click({timeout: 3000});
      await page.getByText('Ready', {exact: true}).waitFor({timeout: 30_000});
      release();
      await page
        .getByText('Packages installed', {exact: true})
        .waitFor({timeout: 60_000});
      assert.equal(
        await page.evaluate(() => window.packageApp.codeEditor.currentFile()),
        '/model.ts',
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      await page
        .getByRole('status', {name: 'Package installation'})
        .waitFor({state: 'hidden'});
    } finally {
      release();
    }
  },
);

test(
  'package failures appear once and clear after correcting the manifest',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await exposePackageApp(page);
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          'export const defaultProject = ' +
          JSON.stringify({
            files: [
              {
                path: '/model.ts',
                source:
                  "import {box} from '@code3d/core'; const x = box(3, 2, 2);",
              },
              {path: '/package.json', source: '{"private":true}'},
            ],
          }),
      }),
    );
    await page.route(
      'https://registry.npmjs.org/mistyped-code3d-package',
      route => route.abort('failed'),
    );
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await page
      .getByRole('treeitem', {name: 'package.json', exact: true})
      .click({button: 'right'});
    await page
      .getByRole('menuitem', {name: 'Install package', exact: true})
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Install package',
      exact: true,
    });
    await dialog
      .getByRole('textbox', {name: 'Package', exact: true})
      .fill('mistyped-code3d-package');
    await dialog.getByRole('button', {name: 'Install', exact: true}).click();
    const status = page.getByRole('status', {name: 'Package installation'});
    await status.locator('[data-state="error"]').waitFor();
    assert.match(
      await status.innerText(),
      /Unable to fetch npm package mistyped-code3d-package/,
    );
    assert.equal(
      await page
        .getByText(/Unable to fetch npm package mistyped-code3d-package/)
        .count(),
      1,
    );
    await page.evaluate(async () => {
      await window.packageApp.codeEditor.openFile('/model.ts');
      await window.packageApp.runModel();
    });
    assert.equal(
      await page
        .getByText(/Unable to fetch npm package mistyped-code3d-package/)
        .filter({visible: true})
        .count(),
      1,
    );
    await page.evaluate(async () => {
      const {codeEditor, runModel} = window.packageApp;
      await codeEditor.openFile('/package.json');
      codeEditor.editor.getModel()!.setValue('{"private":true}');
      await codeEditor.openFile('/model.ts');
      await runModel();
    });
    await page.getByText('Ready', {exact: true}).waitFor();
    await status.locator('[data-state="ready"]').waitFor();
    assert.equal(
      await page
        .getByText(/Failed to fetch|Unable to fetch npm package/)
        .filter({visible: true})
        .count(),
      0,
    );
    assert.equal(
      await page.locator('.project-status:not(.package-status)').isVisible(),
      false,
    );
  },
);

test(
  'Update dependencies refreshes the selected manifest lock and keeps navigation available',
  {timeout: 150_000},
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
    page.setDefaultTimeout(20_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await exposePackageApp(page);
    const manifest =
      JSON.stringify(
        {
          private: true,
          type: 'module',
          dependencies: {
            'd3-delaunay': '^6.0.0',
            '@types/d3-delaunay': '6.0.4',
          },
        },
        null,
        2,
      ) + '\n';
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          'export const defaultProject = ' +
          JSON.stringify({
            files: [
              {
                path: '/model.ts',
                source:
                  "import {box} from '@code3d/core'; export default box(3, 2, 2);",
              },
              {path: '/panel/package.json', source: manifest},
              {path: '/panel/model.ts', source: modelSource},
            ],
          }),
      }),
    );
    let offerUpdate = false;
    await page.route('https://registry.npmjs.org/d3-delaunay', async route => {
      const response = await route.fetch();
      const packument = await response.json();
      const version = offerUpdate ? '6.0.4' : '6.0.3';
      await route.fulfill({
        response,
        json: {
          ...packument,
          versions: {[version]: packument.versions[version]},
          'dist-tags': {latest: version},
        },
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL + '/#/file/panel/model.ts');
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 90_000});
    const readLock = () =>
      page.evaluate(async () =>
        new TextDecoder().decode(
          await window.packageApp.projectFileSystem.readFile(
            '/panel/code3d-lock.json',
          ),
        ),
      );
    const oldLock = await readLock();
    assert.ok(
      JSON.parse(oldLock).packages[
        'https://registry.npmjs.org/d3-delaunay/6.0.3/'
      ],
    );
    const alias = '/panel/node_modules/d3-delaunay/package.json';
    const previousSource =
      '/panel/node_modules/.code3d/d3-delaunay@6.0.3/node_modules/d3-delaunay/package.json';
    await page.evaluate(
      async ({alias, previousSource}) => {
        const editor = window.packageApp.codeEditor;
        await editor.openFile(alias);
        await editor.openFile(previousSource);
        await editor.openFile('/panel/code3d-lock.json');
      },
      {alias, previousSource},
    );
    await page.evaluate(() =>
      window.packageApp.codeEditor.openFile('/panel/package.json'),
    );
    const item = page.locator('[data-item-path="panel/package.json"]');
    await item.click({button: 'right'});
    const update = page.getByRole('menuitem', {
      name: 'Update dependencies',
      exact: true,
    });
    assert.equal(await update.isEnabled(), true);
    offerUpdate = true;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    t.after(() => release());
    let started!: () => void;
    const downloading = new Promise<void>(resolve => {
      started = resolve;
    });
    await page.route(
      'https://registry.npmjs.org/d3-delaunay/-/d3-delaunay-6.0.4.tgz',
      async route => {
        started();
        await gate;
        await route.continue();
      },
    );
    await update.click();
    await downloading;
    assert.equal(
      await readLock(),
      oldLock,
      'do not delete the previous lock before the update succeeds',
    );
    await item.click({button: 'right'});
    assert.equal(
      await update.isEnabled(),
      false,
      'manual package actions share their busy state',
    );
    assert.equal(
      await page
        .getByRole('menuitem', {name: 'Install package', exact: true})
        .isEnabled(),
      false,
    );
    await page.keyboard.press('Escape');
    await page.locator('[data-item-path="model.ts"]').click();
    await page.waitForFunction(
      () => window.packageApp.codeEditor.currentFile() === '/model.ts',
    );
    assert.equal(
      await page.evaluate(
        () => window.packageApp.codeEditor.editor.getRawOptions().readOnly,
      ),
      false,
    );
    await page.evaluate(() => {
      const editor = window.packageApp.codeEditor.editor;
      editor.setValue(
        editor.getValue().replace('box(3, 2, 2)', 'box(4, 2, 2)'),
      );
    });
    await page.waitForFunction(async () =>
      new TextDecoder()
        .decode(await window.packageApp.projectFileSystem.readFile('/model.ts'))
        .includes('box(4, 2, 2)'),
    );
    release();
    await page
      .getByText('Dependencies updated', {exact: true})
      .waitFor({timeout: 90_000});
    assert.equal(
      await page.evaluate(() => window.packageApp.codeEditor.currentFile()),
      '/model.ts',
    );
    await page.waitForFunction(
      previousSource =>
        !window.packageApp.codeEditor.filePaths().includes(previousSource),
      previousSource,
    );
    assert.equal(
      await page.evaluate(
        previousSource =>
          window.packageApp.codeEditor.openedFiles().includes(previousSource),
        previousSource,
      ),
      false,
    );
    await page.evaluate(
      alias => window.packageApp.codeEditor.openFile(alias),
      alias,
    );
    assert.equal(
      JSON.parse(
        await page.evaluate(() =>
          window.packageApp.codeEditor.editor.getValue(),
        ),
      ).version,
      '6.0.4',
      'an already opened package alias refreshes after installation',
    );
    assert.equal(
      await page.evaluate(
        () => window.packageApp.codeEditor.editor.getRawOptions().readOnly,
      ),
      true,
    );
    const newLock = JSON.parse(await readLock());
    assert.ok(
      newLock.packages['https://registry.npmjs.org/d3-delaunay/6.0.4/'],
    );
    assert.equal(
      newLock.packages['https://registry.npmjs.org/d3-delaunay/6.0.3/'],
      undefined,
    );
    assert.equal(
      await page.evaluate(async () =>
        new TextDecoder().decode(
          await window.packageApp.projectFileSystem.readFile(
            '/panel/package.json',
          ),
        ),
      ),
      manifest,
    );
    await page.evaluate(() =>
      window.packageApp.codeEditor.openFile('/panel/code3d-lock.json'),
    );
    assert.ok(
      JSON.parse(
        await page.evaluate(() =>
          window.packageApp.codeEditor.editor.getValue(),
        ),
      ).packages['https://registry.npmjs.org/d3-delaunay/6.0.4/'],
    );
    await page.evaluate(() =>
      window.packageApp.codeEditor.openFile('/panel/model.ts'),
    );
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 90_000});
    await page
      .locator('[data-item-path="panel/model.ts"]')
      .click({button: 'right'});
    assert.equal(
      await update.count(),
      0,
      'ordinary source files do not offer dependency updates',
    );
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  },
);

test(
  'development latest installs current workspace Core and Screws and restores them without registry requests',
  {timeout: 180_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await exposePackageApp(page);
    const source = `import {box} from '@code3d/core'; import {ISO4762} from '@code3d/screws'; export default box(10, 10, 5).cut([ISO4762.clearanceHole('M3', 5)]);`;
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          'export const defaultProject = ' +
          JSON.stringify({
            files: [
              {
                path: '/package.json',
                source: JSON.stringify({
                  type: 'module',
                  dependencies: {
                    '@code3d/core': 'latest',
                    '@code3d/screws': 'latest',
                  },
                }),
              },
              {path: '/model.ts', source},
            ],
          }) +
          ';',
      }),
    );
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://registry.npmjs.org/**', async route => {
      const url = route.request().url();
      requests.push(url);
      if (
        /\/@code3d\/(?:core|screws)(?:\/|$)/.test(
          decodeURIComponent(new URL(url).pathname),
        )
      ) {
        await route.abort();
      } else await route.continue();
    });
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 120_000});
    const installed = await page.evaluate(async () => {
      const {developmentWorkspaces} =
        await import('/src/project/browser-packages.ts');
      const files = window.packageApp.projectFileSystem;
      const lock = JSON.parse(
        new TextDecoder().decode(await files.readFile('/code3d-lock.json')),
      );
      return {
        core: lock.packages[
          lock.resolutions.primary['@code3d/core'].installUrl
        ],
        screws:
          lock.packages[lock.resolutions.primary['@code3d/screws'].installUrl],
        expected: developmentWorkspaces['@code3d/core'].revision,
        peer:
          lock.resolutions.secondary[
            lock.resolutions.primary['@code3d/screws'].installUrl
          ]['@code3d/core'].installUrl ===
          lock.resolutions.primary['@code3d/core'].installUrl,
        declaration: new TextDecoder().decode(
          await files.readFile(
            '/node_modules/@code3d/core/bld/library/index.d.ts',
          ),
        ),
      };
    });
    assert.equal(installed.core.workspace, installed.expected);
    assert.ok(installed.screws.workspace);
    assert.equal(installed.peer, true);
    assert.match(installed.declaration, /box/);
    assert.equal(
      requests.some(url =>
        /\/@code3d\/(?:core|screws)(?:\/|$)/.test(
          decodeURIComponent(new URL(url).pathname),
        ),
      ),
      false,
    );
    await page.evaluate(() =>
      window.packageApp.codeEditor.openFile(
        '/node_modules/@code3d/core/bld/library/index.d.ts',
      ),
    );
    await page.waitForFunction(() =>
      window.packageApp.codeEditor
        .currentFile()
        ?.endsWith('/core/bld/library/index.d.ts'),
    );
    assert.equal(
      await page.evaluate(() => window.packageApp.codeEditor.editor.getValue()),
      installed.declaration,
    );
    await page.evaluate(() =>
      window.packageApp.codeEditor.openFile('/model.ts'),
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    const count = requests.length;
    await page.reload();
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 90_000});
    assert.equal(requests.length, count);
    assert.deepEqual(errors, []);
  },
);

test(
  'directory projects use latest development packages without installation and reload virtual source pages',
  {timeout: 150_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await exposePackageApp(page);
    // Chromium 153 exits when an OPFS directory handle is deserialized from
    // IndexedDB after navigation. This fixture supplies a fresh OPFS handle per
    // document; native folder permission/persistence is outside this package test.
    await page.route('**/src/project/directory-access.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `\nstoredProjectDirectory = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('local-project-test', {create: true});`,
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL + '/#/file/');
    await page.waitForFunction(() => !!window.packageApp);
    const workspace = await page.evaluate(async () => {
      const {openDirectoryProjectFileSystem} =
        await import('/src/project/filesystem.ts');
      const handle = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('local-project-test', {create: true});
      const fs = await openDirectoryProjectFileSystem(handle);
      await fs.initialize(async () => {});
      await fs.writeFile(
        '/package.json',
        JSON.stringify({
          type: 'module',
          dependencies: {'@code3d/core': 'latest'},
        }),
      );
      await fs.writeFile(
        '/model.ts',
        `import {box} from '@code3d/core'; export default box(10, 8, 6);`,
      );
      return 'workspace-development-test';
    });
    const url = new URL(process.env.CODE3D_TEST_URL);
    url.searchParams.set('workspace', workspace);
    url.hash = '/file/model.ts';
    await page.goto(url.href);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 90_000});
    assert.equal(
      await page.evaluate(
        async () =>
          !!(await window.packageApp.projectFileSystem.stat('/node_modules')),
      ),
      false,
    );
    const declaration =
      '/node_modules/.code3d-workspace/node_modules/@code3d/core/bld/library/index.d.ts';
    await page.evaluate(
      path => window.packageApp.codeEditor.openFile(path),
      declaration,
    );
    await page.waitForFunction(
      path => window.packageApp.codeEditor.currentFile() === path,
      declaration,
    );
    const source = await page.evaluate(() =>
      window.packageApp.codeEditor.editor.getValue(),
    );
    assert.match(source, /box/);
    await page.reload();
    await page.waitForFunction(
      path => window.packageApp?.codeEditor.currentFile() === path,
      declaration,
    );
    assert.equal(
      await page.evaluate(() => window.packageApp.codeEditor.editor.getValue()),
      source,
    );
    assert.equal(
      await page.evaluate(
        () => window.packageApp.codeEditor.editor.getRawOptions().readOnly,
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        async () =>
          !!(await window.packageApp.projectFileSystem.stat('/node_modules')),
      ),
      false,
    );
    await page.evaluate(async () => {
      const {projectFileSystem, codeEditor} = window.packageApp;
      await projectFileSystem.writeFile('/package.json', '{"type":"module"}');
      await codeEditor.openFile('/model.ts');
    });
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await page.evaluate(() =>
      window.packageApp.codeEditor.openFile(
        '/node_modules/@code3d/core/bld/library/index.d.ts',
      ),
    );
    assert.equal(
      await page.evaluate(() => window.packageApp.codeEditor.editor.getValue()),
      source,
    );
  },
);
