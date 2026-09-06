import assert from 'node:assert/strict';
import {after, before, type TestContext} from 'node:test';
import {chromium, type Browser, type Locator, type Page} from 'playwright-core';

let browser: Browser;
before(async () => {
  assert.ok(
    process.env.CODE3D_TEST_URL,
    'Set CODE3D_TEST_URL to the development server URL',
  );
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

export async function open(
  t: TestContext,
  source: string,
  cursor?: {line: number; column: number},
): Promise<Page> {
  const context = await browser.newContext({
    viewport: {width: 1400, height: 900},
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(process.env.CODE3D_TEST_URL!);
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 30_000});
  await page.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(source);
  if (cursor) {
    await page.keyboard.press('Control+Home');
    for (let line = 1; line < cursor.line; line++)
      await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    for (let column = 1; column < cursor.column; column++)
      await page.keyboard.press('ArrowRight');
  } else {
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
  }
  await page.getByRole('region', {name: 'Sketch editor'}).waitFor();
  return page;
}
export const text = async (page: Page): Promise<string> =>
  (await page.locator('.monaco-editor .view-lines').innerText()).replaceAll(
    '\u00a0',
    ' ',
  );

// Geometry commits synchronously; Monaco renders source on its next frame.
export async function waitForSource(
  page: Page,
  pattern: RegExp,
): Promise<void> {
  await page.waitForFunction(
    ({source, flags}) =>
      new RegExp(source, flags).test(
        document
          .querySelector<HTMLElement>('.monaco-editor .view-lines')!
          .innerText.replaceAll('\u00a0', ' '),
      ),
    {source: pattern.source, flags: pattern.flags},
  );
}
export const point = (page: Page, id: number, layer = 'local'): Locator =>
  page.locator(`.sketch-canvas circle.${layer}[data-id="${id}"]`);
export const segment = (
  page: Page,
  id: number,
  start: number,
  end: number,
  layer = 'local',
): Locator =>
  page.locator(
    `.sketch-canvas line.${layer}[data-id="${id}"][data-start="${start}"][data-end="${end}"]`,
  );
export async function clickSegment(
  page: Page,
  locator: Locator,
): Promise<void> {
  const bounds = await locator.boundingBox();
  assert.ok(bounds);
  // SVG horizontal/vertical lines have a zero-height/width geometric box.
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
}
