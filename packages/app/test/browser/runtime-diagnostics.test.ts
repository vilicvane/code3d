import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import type {ModelPreviewState} from '../../src/model/preview-state.ts';
import type {CodeEditor} from '../../src/editor.ts';

declare const window: Window & {
  diagnosticFixture: {codeEditor: CodeEditor; previewState: ModelPreviewState};
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
        source: "import {parse} from './helper.ts';\nparse('invalid json');",
      },
      {
        path: '/helper.ts',
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
          '\nwindow.diagnosticFixture = {codeEditor,previewState};',
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
      '/helper.ts',
    );
    await page.locator('#viewport-status').click();
    await page.waitForFunction(
      () =>
        window.diagnosticFixture.codeEditor.currentFile() === '/helper.ts' &&
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
