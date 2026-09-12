import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {chromium} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';

declare const window: Window & {
  releaseLanguage(): void;
  languageGate: Promise<void>;
  languageFixture: {
    codeEditor: import('../../src/editor.ts').CodeEditor;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
  };
  languageMarkers(): import('monaco-editor/editor').editor.IMarker[];
  languageMarkerHistory: string[];
};

async function pageFor(t: TestContext) {
  assert.ok(process.env.CODE3D_TEST_URL);
  const browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
  t.after(() => browser.close());
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (
      ['error', 'warning'].includes(message.type()) &&
      /mobx|reaction/i.test(message.text())
    )
      errors.push(message.text());
  });
  t.after(() => assert.deepEqual(errors, []));
  return page;
}

test(
  'initial dependency loading keeps syntax diagnostics and publishes types only when ready',
  {timeout: 90_000},
  async t => {
    const page = await pageFor(t);
    await page.addInitScript(() => {
      window.languageGate = new Promise(resolve => {
        window.releaseLanguage = resolve;
      });
    });
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export const defaultProject = ${JSON.stringify({files: [{path: '/model.ts', source: "import {box} from '@code3d/core'; box('bad', 10, 10); const syntax = ;"}]})};`,
      }),
    );
    await page.route('**/src/editor.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `
      window.languageMarkers = () => monaco.editor.getModelMarkers({owner:'typescript'});
      window.languageMarkerHistory = [];
      monaco.editor.onDidChangeMarkers(() => window.languageMarkerHistory.push(...window.languageMarkers().map(m => String(m.code))));
    `,
      });
    });
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      const source = (await response.text())
        .replace(
          'if (!packageManager) return;',
          'await window.languageGate; if (!packageManager) return;',
        )
        .replace(
          'const retrySaveButton =',
          'window.languageFixture = {codeEditor, compiler};\nconst retrySaveButton =',
        );
      await route.fulfill({response, body: source});
    });
    await page.goto(
      new URL('/#/file/model.ts', process.env.CODE3D_TEST_URL).href,
    );
    await page.waitForFunction(
      () =>
        window.languageFixture &&
        window.languageMarkers().some(m => String(m.code) === '1109'),
    );
    assert.equal(
      await page.evaluate(
        () => window.languageFixture.compiler.language === undefined,
      ),
      true,
    );
    assert.equal(
      await page.evaluate(() =>
        window
          .languageMarkers()
          .some(m => ['2307', '2345'].includes(String(m.code))),
      ),
      false,
    );
    // Editing while preparation remains blocked still gets fresh syntax results.
    await page.evaluate(() => {
      const {editor} = window.languageFixture.codeEditor;
      editor
        .getModel()!
        .setValue(
          "import {box} from '@code3d/core'; box('bad', 10, 10); const syntax = 1;",
        );
    });
    await page.waitForFunction(() => window.languageMarkers().length === 0);
    await page.evaluate(() => window.releaseLanguage());
    await page.waitForFunction(
      () =>
        window.languageFixture.compiler.language !== undefined &&
        window.languageMarkers().some(m => String(m.code) === '2345'),
      undefined,
      {timeout: 60_000},
    );
    assert.equal(
      await page.evaluate(() => window.languageMarkerHistory.includes('2307')),
      false,
    );
    await page.evaluate(() =>
      window.languageFixture.codeEditor.editor
        .getModel()!
        .setValue("import {box} from '@code3d/core'; box(10, 10, 10);"),
    );
    await page.waitForFunction(
      () =>
        window.languageFixture.compiler.language !== undefined &&
        window.languageMarkers().length === 0,
    );
  },
);

for (const change of [
  'source',
  'dependencies',
  'queued-dependencies',
  'dispose',
] as const) {
  test(
    `late diagnostics cannot overwrite newer ${change} state`,
    {timeout: 30_000},
    async t => {
      const page = await pageFor(t);
      await page.route('**/diagnostic-race.html', route =>
        route.fulfill({
          contentType: 'text/html',
          headers: appIsolationHeaders,
          body: '<main></main>',
        }),
      );
      await page.goto(
        new URL('/diagnostic-race.html', process.env.CODE3D_TEST_URL).href,
      );
      const messages = await page.evaluate(
        async ({change, monacoRoot}) => {
          // Use the real installed adapter with controlled worker replies, avoiding timing races.
          const apiPath = monacoRoot + 'editor/editor.api.js';
          const featuresPath =
            monacoRoot + 'languages/features/typescript/languageFeatures.js';
          const {editor, Uri} = await import(apiPath);
          const {DiagnosticsAdapter} = await import(featuresPath);
          const model = editor.createModel(
            'const value = 1;',
            'plaintext',
            Uri.file('/race.ts'),
          );
          let changed!: () => void;
          let extraLibs = {};
          const defaults = {
            getExtraLibs: () => extraLibs,
            getDiagnosticsOptions: () => ({
              noSyntaxValidation: true,
              noSuggestionDiagnostics: true,
            }),
            onDidChange: () => ({dispose() {}}),
            onDidExtraLibsChange: (listener: () => void) => {
              changed = listener;
              return {dispose() {}};
            },
          };
          const pending: Array<(value: unknown[]) => void> = [];
          const adapter = new DiagnosticsAdapter(
            {async fetchLibFilesIfNecessary() {}},
            defaults,
            'plaintext',
            async () => ({
              getSemanticDiagnostics: () =>
                new Promise(resolve => pending.push(resolve)),
            }),
          );
          const flush = async () => {
            for (let n = 0; n < 8; n++) await Promise.resolve();
          };
          const diagnostic = (messageText: string) => [
            {start: 0, length: 5, category: 1, code: 2322, messageText},
          ];
          await flush();
          const old = pending.shift()!;
          if (change === 'source') model.setValue('const value = 2;');
          if (change === 'dependencies') changed();
          if (change === 'queued-dependencies') extraLibs = {};
          if (change === 'dispose') adapter.dispose();
          if (change !== 'dispose') {
            const current = adapter._doValidate(model);
            await flush();
            // Dependency changes already scheduled a validation; settle both current requests.
            for (const finish of pending.splice(0))
              finish(diagnostic('current'));
            await current;
          }
          old(diagnostic('obsolete'));
          await flush();
          const result = editor
            .getModelMarkers({resource: model.uri})
            .map((marker: {message: string}) => marker.message);
          adapter.dispose();
          model.dispose();
          return result;
        },
        {
          change,
          monacoRoot:
            '/@fs' +
            new URL(
              '../../../../node_modules/monaco-editor/esm/vs/',
              import.meta.url,
            ).pathname,
        },
      );
      assert.deepEqual(messages, change === 'dispose' ? [] : ['current']);
    },
  );
}
