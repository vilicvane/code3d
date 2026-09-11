import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium, type Page} from 'playwright-core';

declare const window: Window & {
  extrusionApp: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
  };
};

for (const call of ['profile.extrude(3)', 'extrude(profile, 3)']) {
  test(
    `${call} supports distance editing, invalid input recovery and undo in the App`,
    {timeout: 120_000},
    async t => {
      assert.ok(
        process.env.CODE3D_TEST_URL,
        'Set CODE3D_TEST_URL to the task development server',
      );
      const browser = await chromium.connectOverCDP(
        process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
      );
      const context = await browser.newContext({
        viewport: {width: 1440, height: 1000},
      });
      const page = await context.newPage();
      let completed = false;
      t.after(async () => {
        if (!completed && !page.isClosed())
          t.diagnostic(
            JSON.stringify(
              await page.evaluate(() => ({
                scope: window.extrusionApp?.viewport.sourceEvaluation(),
                source: window.extrusionApp?.codeEditor.editor.getValue(),
                panel: document.querySelector('.contextual-tool-panel')
                  ?.outerHTML,
              })),
            ),
          );
      });
      t.after(() => context.close());
      t.after(() => browser.close());
      page.setDefaultTimeout(20_000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/src/main.ts*', async route => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()) +
            '\nwindow.extrusionApp = {viewport, codeEditor};\n',
        });
      });
      await page.goto(process.env.CODE3D_TEST_URL, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
      const source = `import {rectangle, extrude} from '@code3d/core';
const profile = rectangle(30, 20);
export const body = ${call};`;
      await page.evaluate(() => window.extrusionApp.codeEditor.editor.focus());
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText(source);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      const distance = page.locator('[data-parameter=distance]');
      await distance.waitFor();
      await waitExtrusion(page, 3);
      assert.equal(await distance.inputValue(), '3');

      await distance.fill('0');
      await page.keyboard.press('Enter');
      await page.getByText('Model error', {exact: true}).waitFor();
      // An error retains the last successful geometry and closes its stale tool.
      assert.equal(await distance.isVisible(), false);
      await page.evaluate(() => window.extrusionApp.codeEditor.editor.focus());
      await page.keyboard.press('Control+z');
      await page.getByText('Ready', {exact: true}).waitFor();
      await waitExtrusion(page, 3);
      await page.evaluate(() => {
        const editor = window.extrusionApp.codeEditor.editor;
        editor.setPosition(
          editor.getModel()!.getPositionAt(editor.getValue().lastIndexOf('3')),
        );
      });
      await distance.fill('-5');
      await page.keyboard.press('Enter');
      await waitExtrusion(page, -5);
      assert.match(
        await page.locator('.monaco-editor .view-lines').innerText(),
        /extrude\((?:profile,\s*)?-5\)/,
      );

      await page.keyboard.press('Control+z');
      await waitExtrusion(page, 3);
      assert.equal(await distance.inputValue(), '3');
      await page.keyboard.press('Control+Shift+z');
      await waitExtrusion(page, -5);
      assert.equal(await distance.inputValue(), '-5');
      assert.deepEqual(errors, []);
      completed = true;
    },
  );
}

async function waitExtrusion(page: Page, distance: number) {
  await page.waitForFunction(distance => {
    const module = window.extrusionApp.viewport['module'];
    const id = module?.exports.get('body');
    const body = id && module?.objects.get(id);
    if (
      !body ||
      module?.diagnostic ||
      body.operation.kind !== 'extrude' ||
      !body.mesh
    )
      return false;
    const ys = [...body.mesh.topologyVertices].filter(
      (_, index) => index % 3 === 1,
    );
    return (
      body.kind === 'solid' &&
      body.mesh.triangles.length > 0 &&
      Math.abs(Math.min(...ys) - Math.min(0, distance)) < 1e-6 &&
      Math.abs(Math.max(...ys) - Math.max(0, distance)) < 1e-6
    );
  }, distance);
  await page.getByText('Ready', {exact: true}).waitFor();
}
