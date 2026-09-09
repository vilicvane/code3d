import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

declare const window: Window & {
  packageApp: {
    codeEditor: import('../../src/editor.ts').CodeEditor;
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
        '\nwindow.packageApp = {codeEditor, projectFileSystem};',
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

    await page.locator('#packages-button').click();
    await page.waitForFunction(() =>
      window.packageApp.codeEditor
        .currentFile()
        ?.endsWith('/post-array/package.json'),
    );
    assert.equal(
      await page.evaluate(() => window.packageApp.codeEditor.editor.getValue()),
      installed.manifest,
      'Packages opens the stored manifest with its original formatting and field order',
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
    await page.locator('#packages-button').click();
    await page.waitForFunction(
      () => window.packageApp.codeEditor.currentFile() === '/b/package.json',
    );
    await page.evaluate(() => {
      const {codeEditor} = window.packageApp;
      const model = codeEditor.editor.getModel()!;
      const manifest = JSON.parse(model.getValue());
      manifest.dependencies['d3-delaunay'] = '6.0.4';
      model.setValue(JSON.stringify(manifest, null, 2));
    });
    await page.locator('#install-packages-button').click();
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
      'reinstall replaces the existing lock after a manifest edit',
    );
    assert.deepEqual(errors, []);
  },
);
