import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, text, waitForSource} from './sketch-test.ts';

async function cursor(page: Page, line: number, column: number) {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+Home');
  for (let i = 1; i < line; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  for (let i = 1; i < column; i++) await page.keyboard.press('ArrowRight');
}

test('closed regions preview holes, retain editing, and feed the extrusion parameter panel', async t => {
  const source = `import {sketch} from '@code3d/core';
const profile = sketch([['point',1,[0,0]],['circle',2,[1,15]],['circle',3,[1,5]]]);
export const body = profile.face().extrude(10);`;
  const page = await open(t, source, {line: 2, column: 8});
  const region = page.locator('.sketch-region');
  await region.waitFor();
  assert.equal(await region.count(), 1);
  assert.equal(await region.getAttribute('fill-rule'), 'evenodd');
  assert.equal((await region.getAttribute('d'))!.match(/M /g)!.length, 2);
  assert.equal(
    await region.evaluate(e => getComputedStyle(e).pointerEvents),
    'none',
  );
  const circle = page.locator(
    '.sketch-canvas circle.local[data-kind=circle][data-id="2"]',
  );
  const before = await text(page);
  const bounds = (await circle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width + 30,
    bounds.y + bounds.height / 2,
    {steps: 4},
  );
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document.querySelector('.sketch-editor')!.getAttribute('aria-busy') ===
      'false',
  );
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.notEqual(await text(page), before);
  assert.equal(await region.count(), 1);
  // Locate the operation after formatting using its rendered source line.
  const lines = (await text(page)).split('\n');
  const line = lines.findIndex(s => s.includes('.extrude('));
  await cursor(page, line + 1, lines[line].indexOf('extrude') + 3);
  const input = page.locator('[data-parameter="distance"]');
  await input.waitFor();
  assert.equal(await page.locator('.sketch-editor').isVisible(), false);
  assert.equal(await input.inputValue(), '10');
  await input.fill('14');
  await input.press('Tab');
  await waitForSource(page, /extrude\(14\)/);
  assert.equal(await page.locator('.monaco-editor .squiggly-error').count(), 0);
});

test('trim opens a closed region and undo restores it without blocking sketch editing', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const profile = sketch([['point',1,[0,0]],['point',2,[20,0]],['point',3,[20,20]],['point',4,[0,20]],['line',5,[1,2]],['line',6,[2,3]],['line',7,[3,4]],['line',8,[4,1]]]);`,
    {line: 2, column: 8},
  );
  await page.locator('.sketch-region').waitFor();
  await page.getByRole('button', {name: 'Trim', exact: true}).click();
  const line = page.locator('.sketch-canvas line.local[data-id="5"]');
  const bounds = (await line.boundingBox())!;
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.locator('.sketch-region').waitFor({state: 'detached'});
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await page.locator('.sketch-editor').isVisible(), true);
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+z');
  await cursor(page, 2, 8);
  await page.locator('.sketch-region').waitFor();
});
