import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import type {ModelPreviewState} from '../../src/model/preview-state.ts';
import type {CodeEditor} from '../../src/editor.ts';

declare const window: Window & {
  setSeverityMarkers(errors: number, warnings: number): void;
  diagnosticFixture: {
    codeEditor: CodeEditor;
    previewState: ModelPreviewState;
    projectDirectory: import('../../src/ui/project-tree.ts').ProjectTree;
  };
  diagnosticMarkers(): Array<{message: string; startLineNumber: number}>;
};

test(
  'runtime errors in lazily opened helpers survive source navigation and clear after edits',
  {timeout: 90_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1400, height: 900},
    });
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
    const files = [
      {
        path: '/model.ts',
        source:
          "import {parse} from './checks/helper.ts';\nparse('invalid json');",
      },
      {
        path: '/checks/helper.ts',
        source:
          'export function parse(text: string) {\n  return JSON.parse(text);\n}',
      },
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
        body: 'export const bundledExamples = {directory:"/examples",revision:"empty",files:[]};',
      }),
    );
    await page.route('**/src/editor.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.diagnosticMarkers = () => monaco.editor.getModelMarkers({owner:"code3d-model"});',
      });
    });
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.diagnosticFixture = {codeEditor,previewState,projectDirectory};',
      });
    });
    await page.goto(
      new URL('/#/file/model.ts', process.env.CODE3D_TEST_URL).href,
    );
    await page
      .locator('#viewport-status[data-state=error]')
      .waitFor({timeout: 60_000});
    assert.equal(
      await page.evaluate(
        () => window.diagnosticFixture.previewState.diagnostic?.sourceRef?.file,
      ),
      '/checks/helper.ts',
    );
    await page.waitForFunction(
      () =>
        window.diagnosticFixture.codeEditor.diagnosticCounts.get(
          '/checks/helper.ts',
        )?.errors === 1,
    );
    const folder = page
      .locator('[data-item-path="checks/"] [data-item-section="content"]')
      .first();
    await folder.waitFor();
    assert.equal(
      await folder.evaluate(element => getComputedStyle(element).color),
      'rgb(227, 144, 134)',
    );
    await page.evaluate(() =>
      window.diagnosticFixture.projectDirectory.setAgentLocations([
        {
          id: 'test-agent',
          name: 'Test agent',
          file: '/checks/helper.ts',
          color: 4,
        },
      ]),
    );
    await page
      .locator('[data-item-path="checks/"] [title*="Test agent"]')
      .first()
      .waitFor();
    await page.locator('#viewport-status').click();
    await page.waitForFunction(
      () =>
        window.diagnosticFixture.codeEditor.currentFile() ===
          '/checks/helper.ts' &&
        !window.diagnosticFixture.previewState.busy &&
        window.diagnosticFixture.previewState.sourceVersion !== undefined,
    );
    assert.equal(
      await page.evaluate(
        () => window.diagnosticFixture.previewState.diagnostic,
      ),
      undefined,
      'The helper alone succeeds, but the importing entry still has a runtime error',
    );
    const tab = page.locator('.editor-tab[data-path="/checks/helper.ts"]');
    await tab.locator('.editor-tab-diagnostics').waitFor();
    assert.equal(await tab.locator('.editor-tab-diagnostics').innerText(), '1');
    assert.equal(
      await tab
        .locator('.editor-tab-label')
        .evaluate(element => getComputedStyle(element).color),
      'rgb(227, 144, 134)',
    );
    const decoratedFile = page.locator(
      '[data-item-path="checks/helper.ts"] [data-item-section="decoration"]',
    );
    assert.match(
      (await decoratedFile.locator('[title]').first().getAttribute('title')) ??
        '',
      /1 error/,
    );
    assert.match(
      (await decoratedFile.locator('[title]').first().getAttribute('title')) ??
        '',
      /Test agent/,
    );
    const markers = await page.evaluate(() => window.diagnosticMarkers());
    assert.equal(markers.length, 1);
    assert.equal(markers[0].startLineNumber, 2);
    await page.locator('.monaco-editor .squiggly-error').first().waitFor();
    await page.evaluate(() =>
      window.diagnosticFixture.codeEditor.editor
        .getModel()!
        .setValue('export function parse(text: string) {\n  return text;\n}'),
    );
    await page.waitForFunction(() => window.diagnosticMarkers().length === 0);
    await page.waitForFunction(
      () => window.diagnosticFixture.codeEditor.diagnosticCounts.size === 0,
    );
    assert.equal(
      await tab.locator('.editor-tab-diagnostics').isVisible(),
      false,
    );
    await page.evaluate(() =>
      window.diagnosticFixture.codeEditor.editor
        .getModel()!
        .setValue('export const count: number = "wrong";'),
    );
    await page.waitForFunction(
      () =>
        (window.diagnosticFixture.codeEditor.diagnosticCounts.get(
          '/checks/helper.ts',
        )?.errors ?? 0) > 0,
    );
    await tab.locator('.editor-tab-diagnostics').waitFor();
    await page.evaluate(() =>
      window.diagnosticFixture.codeEditor.editor
        .getModel()!
        .setValue('export function parse(text: string) { return text; }'),
    );
    await page.waitForFunction(
      () =>
        !window.diagnosticFixture.codeEditor.diagnosticCounts.has(
          '/checks/helper.ts',
        ),
    );
    await page.evaluate(() =>
      window.diagnosticFixture.codeEditor.openFile('/model.ts'),
    );
    await page.waitForFunction(
      () =>
        window.diagnosticFixture.previewState.sourceVersion !== undefined &&
        !window.diagnosticFixture.previewState.busy,
    );
    assert.equal(
      await page.evaluate(() => window.diagnosticMarkers().length),
      0,
    );
  },
);

test(
  'warnings, errors and agent activity share tabs and tree decorations without hiding each other',
  {timeout: 90_000},
  async t => {
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
    const files = ['/model.ts', '/nested/file.ts', '/nested/unopened.ts'].map(
      path => ({path, source: 'export const value = 1;'}),
    );
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export const defaultProject = ${JSON.stringify({files})};`,
      }),
    );
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.diagnosticFixture = {codeEditor, previewState, projectDirectory};',
      });
    });
    await page.route('**/src/editor.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `
      window.setSeverityMarkers = (errors, warnings) => {
        const model = window.diagnosticFixture.codeEditor.editor.getModel();
        monaco.editor.setModelMarkers(model, 'severity-fixture', [
          ...Array.from({length: errors}, (_, n) => ({severity: monaco.MarkerSeverity.Error, message: 'error ' + n})),
          ...Array.from({length: warnings}, (_, n) => ({severity: monaco.MarkerSeverity.Warning, message: 'warning ' + n})),
          {severity: monaco.MarkerSeverity.Info, message: 'information'},
          {severity: monaco.MarkerSeverity.Hint, message: 'hint'},
        ].map(marker => ({...marker, startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 2})));
      };
    `,
      });
    });
    await page.goto(
      new URL('/#/file/nested/file.ts', process.env.CODE3D_TEST_URL).href,
    );
    await page.waitForFunction(
      () =>
        window.diagnosticFixture?.previewState.module &&
        !window.diagnosticFixture.previewState.busy,
    );
    await page.evaluate(() => {
      window.diagnosticFixture.projectDirectory.setAgentLocations(
        Array.from({length: 4}, (_, color) => ({
          id: 'agent-' + color,
          name: 'Agent ' + color,
          file: '/nested/file.ts',
          color,
        })),
      );
      window.setSeverityMarkers(0, 2);
    });
    const tab = page.locator('.editor-tab[data-path="/nested/file.ts"]');
    const name = page
      .locator(
        '[data-item-path="nested/file.ts"] [data-item-section="content"]',
      )
      .first();
    const folder = page
      .locator('[data-item-path="nested/"] [data-item-section="content"]')
      .first();
    const decoration = page.locator(
      '[data-item-path="nested/file.ts"] [data-item-section="decoration"]',
    );
    await page.waitForFunction(
      () =>
        window.diagnosticFixture.codeEditor.diagnosticCounts.get(
          '/nested/file.ts',
        )?.warnings === 2,
    );
    assert.equal(await tab.locator('.editor-tab-diagnostics').innerText(), '2');
    assert.equal(
      await name.evaluate(el => getComputedStyle(el).color),
      'rgb(221, 197, 142)',
    );
    assert.equal(
      await folder.evaluate(el => getComputedStyle(el).color),
      'rgb(221, 197, 142)',
    );
    assert.equal(
      await tab
        .locator('.editor-tab-label')
        .evaluate(el => getComputedStyle(el).color),
      'rgb(221, 197, 142)',
    );
    assert.equal(
      (await decoration.innerText()).replaceAll(/\s/g, ''),
      '2●●●+1',
    );
    assert.deepEqual(
      await decoration
        .locator('span')
        .evaluateAll(elements =>
          elements
            .filter(element => element.textContent === '●')
            .map(element => getComputedStyle(element).color),
        ),
      ['rgb(112, 200, 240)', 'rgb(216, 160, 245)', 'rgb(239, 173, 108)'],
    );
    assert.match(
      (await decoration.locator('[title]').first().getAttribute('title')) ?? '',
      /2 warnings[\s\S]*Agent 3/,
    );
    const folderDecoration = page.locator(
      '[data-item-path="nested/"] [data-item-section="decoration"]',
    );
    await folderDecoration.locator('[title*="Agent 3"]').waitFor();
    assert.equal(
      (await folderDecoration.innerText()).replaceAll(/\s/g, ''),
      '●●●●+1',
      'expanded folders retain descendant activity alongside diagnostics',
    );
    await page.evaluate(() => window.setSeverityMarkers(1, 2));
    await page.waitForFunction(
      () =>
        window.diagnosticFixture.codeEditor.diagnosticCounts.get(
          '/nested/file.ts',
        )?.errors === 1,
    );
    assert.equal(await tab.locator('.editor-tab-diagnostics').innerText(), '3');
    assert.equal(
      await name.evaluate(el => getComputedStyle(el).color),
      'rgb(227, 144, 134)',
    );
    assert.equal(
      await folder.evaluate(el => getComputedStyle(el).color),
      'rgb(227, 144, 134)',
    );
    assert.match(
      (await tab.locator('button').first().getAttribute('title')) ?? '',
      /1 error, 2 warnings/,
    );
    await page.evaluate(() => {
      const tree = (
        window.diagnosticFixture.projectDirectory as unknown as {
          tree: import('@pierre/trees').FileTree;
        }
      ).tree;
      (
        tree.getItem(
          'nested/',
        ) as import('@pierre/trees').FileTreeDirectoryHandle
      ).collapse();
    });
    await folderDecoration.locator('[title*="Agent 3"]').waitFor();
    assert.equal(
      (await folderDecoration.innerText()).replaceAll(/\s/g, ''),
      '●●●●+1',
    );
    await page.evaluate(() => {
      const tree = (
        window.diagnosticFixture.projectDirectory as unknown as {
          tree: import('@pierre/trees').FileTree;
        }
      ).tree;
      (
        tree.getItem(
          'nested/',
        ) as import('@pierre/trees').FileTreeDirectoryHandle
      ).expand();
    });
    await decoration.locator('[title*="Agent 3"]').waitFor();
    assert.equal(
      (await folderDecoration.innerText()).replaceAll(/\s/g, ''),
      '●●●●+1',
    );
    await page.evaluate(() => window.setSeverityMarkers(0, 2));
    await page.waitForFunction(
      () =>
        window.diagnosticFixture.codeEditor.diagnosticCounts.get(
          '/nested/file.ts',
        )?.errors === 0,
    );
    assert.equal(
      await folder.evaluate(el => getComputedStyle(el).color),
      'rgb(221, 197, 142)',
    );
    await page.evaluate(() => window.setSeverityMarkers(0, 0));
    await page.waitForFunction(
      () =>
        !window.diagnosticFixture.codeEditor.diagnosticCounts.has(
          '/nested/file.ts',
        ),
    );
    assert.equal(
      await tab.locator('.editor-tab-diagnostics').isVisible(),
      false,
    );
    assert.equal(
      (await folderDecoration.innerText()).replaceAll(/\s/g, ''),
      '●●●+1',
    );
    // Two copies of one runtime warning remain one warning before and after opening its source.
    await page.evaluate(() => {
      const {previewState} = window.diagnosticFixture;
      const warning = {
        kind: 'evaluation' as const,
        severity: 'warning' as const,
        summary: 'Runtime warning',
        sourceRef: {file: '/nested/unopened.ts', start: 0, end: 6},
      };
      previewState.accept(previewState.begin(0), {
        ...previewState.module!,
        warnings: [warning, warning],
      });
    });
    await page.waitForFunction(
      () =>
        window.diagnosticFixture.codeEditor.diagnosticCounts.get(
          '/nested/unopened.ts',
        )?.warnings === 1,
    );
    await page.evaluate(() =>
      window.diagnosticFixture.codeEditor.openFile('/nested/unopened.ts'),
    );
    await page.waitForFunction(
      () =>
        window.diagnosticFixture.codeEditor.currentFile() ===
          '/nested/unopened.ts' && !window.diagnosticFixture.previewState.busy,
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.diagnosticFixture.codeEditor.diagnosticCounts.get(
          '/nested/unopened.ts',
        ),
      ),
      {errors: 0, warnings: 1},
    );
    await page.evaluate(() =>
      window.diagnosticFixture.previewState.clearEditorDiagnostics(),
    );
    await page.waitForFunction(
      () => window.diagnosticFixture.codeEditor.diagnosticCounts.size === 0,
    );
  },
);
