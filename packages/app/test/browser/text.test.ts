import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium, type Page} from 'playwright-core';

declare const window: Window & {
  textApp: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
  };
};

test(
  'local font text supports size and batch extrusion editing with undo in the App',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    const context = await browser.newContext({
      viewport: {width: 1440, height: 1000},
    });
    t.after(() => context.close());
    t.after(() => browser.close());
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.textApp = {viewport, codeEditor};\n',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    const fontBytes = await readFile(
      new URL('../../../core/test/fonts/DejaVuSans.ttf', import.meta.url),
    );
    await page.evaluate(
      async bytes => {
        const {openBrowserProjectFileSystem} =
          await import('/src/project/filesystem.ts');
        await (
          await openBrowserProjectFileSystem()
        ).writeFile('/text-test.ttf', new Uint8Array(bytes));
      },
      [...fontBytes],
    );
    const source = `import {font, text, extrude, group} from '@code3d/core';
const sans = font(new URL('./text-test.ttf', import.meta.url));
const profiles = text('B8i', sans, 20);
export const lettering = group(extrude(profiles, 3));`;
    await page.evaluate(() => window.textApp.codeEditor.editor.focus());
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(source);
    await waitText(page, 3);
    await page.evaluate(() => {
      const editor = window.textApp.codeEditor.editor;
      editor.setPosition(
        editor.getModel()!.getPositionAt(editor.getValue().lastIndexOf('20')),
      );
    });
    const size = page.locator('[data-parameter=size]');
    await size.waitFor();
    assert.equal(await size.inputValue(), '20');
    await size.fill('24');
    await page.keyboard.press('Enter');
    await waitSize(page, 24);
    assert.match(
      await page.evaluate(() => window.textApp.codeEditor.editor.getValue()),
      /text\('B8i', sans, 24\)/,
    );
    await page.keyboard.press('Control+z');
    await waitSize(page, 20);
    await page.evaluate(() => {
      const editor = window.textApp.codeEditor.editor;
      editor.setPosition(
        editor.getModel()!.getPositionAt(editor.getValue().lastIndexOf('3')),
      );
    });
    const distance = page.locator('[data-parameter=distance]');
    await distance.waitFor();
    assert.equal(await distance.inputValue(), '3');
    await distance.fill('0');
    await page.keyboard.press('Enter');
    await page.getByText('Model error', {exact: true}).waitFor();
    // Failed extrusion keeps its current input editable while showing the error.
    assert.equal(await distance.isVisible(), true);
    assert.equal(await distance.inputValue(), '0');
    await page.evaluate(() => window.textApp.codeEditor.editor.focus());
    await page.keyboard.press('Control+z');
    await page.getByText('Ready', {exact: true}).waitFor();
    await waitText(page, 3);
    await page.evaluate(() => {
      const editor = window.textApp.codeEditor.editor;
      editor.setPosition(
        editor.getModel()!.getPositionAt(editor.getValue().lastIndexOf('3')),
      );
    });
    await distance.fill('-5');
    await page.keyboard.press('Enter');
    await waitText(page, -5);
    await page.keyboard.press('Control+z');
    await waitText(page, 3);
    await page.keyboard.press('Control+Shift+z');
    await waitText(page, -5);
    assert.deepEqual(errors, []);
    await page.screenshot({path: '/tmp/code3d-text-browser.png'});
  },
);

async function waitSize(page: Page, size: number) {
  await page.waitForFunction(
    size => {
      const module = window.textApp.viewport['module'];
      if (!module || module.diagnostic) return false;
      const faces = [...module.objects.values()].filter(
        object => object.operation.kind === 'text',
      );
      return (
        faces.length === 4 &&
        faces.every(face =>
          face.parameters.some(
            parameter =>
              parameter.argument === 'size' && parameter.value === size,
          ),
        )
      );
    },
    size,
    {timeout: 60_000},
  );
}

async function waitText(page: Page, distance: number) {
  await page.waitForFunction(
    distance => {
      const module = window.textApp.viewport['module'];
      if (!module || module.diagnostic) return false;
      const bodies = [...module.objects.values()].filter(
        object => object.operation.kind === 'extrude',
      );
      return (
        bodies.length === 4 &&
        bodies.every(
          body =>
            body.mesh &&
            body.parameters.some(
              parameter =>
                parameter.argument === 'distance' &&
                parameter.value === distance,
            ),
        )
      );
    },
    distance,
    {timeout: 60_000},
  );
}
