import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, point, text, waitForSource} from './sketch-test.ts';

const source = `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['point',2,[20,0]],['point',3,[0,15]],['point',4,[20,15]],['line',5,[1,2]],['line',6,[3,4]]]);`;
const toolbar = (page: Page) =>
  page.getByRole('toolbar', {name: 'Selection constraints'});
const button = (page: Page, name: string) =>
  toolbar(page).getByRole('button', {name, exact: true});
async function selectLine(page: Page, id: number, shift = false) {
  const r = (await page
    .locator(`.sketch-canvas line.local[data-id="${id}"]`)
    .boundingBox())!;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  if (shift) await page.keyboard.up('Shift');
}

test('three selected lines add parallel pairs once, expose no two-line tools, and undo the batch', async t => {
  const page = await open(
    t,
    source.replace(
      "['line',6,[3,4]]",
      "['line',6,[3,4]],['point',7,[0,30]],['point',8,[20,30]],['line',9,[7,8]]",
    ),
  );
  const before = await text(page);
  await selectLine(page, 9);
  await selectLine(page, 6, true);
  await selectLine(page, 5, true);
  assert.equal(await button(page, 'Angle between lines').count(), 0);
  assert.equal(await button(page, 'Perpendicular').count(), 0);
  await button(page, 'Parallel').click();
  await waitForSource(page, /'parallel',\s*\[5,\s*9\]/);
  assert.match(await text(page), /'parallel',\s*\[5,\s*6\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(
    await page.locator('.constraint-badge[data-kind="parallel"]').count(),
    2,
  );
  await page.keyboard.press('Control+z');
  await waitForSource(page, /\[7,\s*8\]\]\]\)/);
  assert.equal(await text(page), before);
});

test('line angle has its own directed marker, numeric editor and undo without replacing orientation', async t => {
  const page = await open(
    t,
    source.replace(']]);', "]], {constraints:[['angle',5,0]]});"),
  );
  const before = await text(page);
  await selectLine(page, 5);
  await selectLine(page, 6, true);
  await button(page, 'Angle between lines').click();
  const input = page.getByRole('textbox', {
    name: 'Angle between lines',
    exact: true,
  });
  await input.fill('120');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'angle',\s*\[5,\s*6\],\s*120/);
  await page.getByText('Ready', {exact: true}).waitFor();
  const marker = page.locator('.constraint-badge[data-tool="angle"]');
  assert.equal(await marker.count(), 1);
  assert.equal(
    await page.locator('.constraint-badge[data-tool="orientation"]').count(),
    1,
  );
  assert.match(
    (await marker.getAttribute('aria-label')) ?? '',
    /line 5 → line 6.*120°/,
  );
  assert.equal(await page.locator('.constraint-angle-guide').count(), 1);
  assert.equal(
    await page
      .locator('.constraint-angle-guide')
      .evaluate(el => getComputedStyle(el).fill),
    'none',
  );
  await page.screenshot({path: '/tmp/code3d-line-angle-browser.png'});
  await page.keyboard.press('Escape');
  await marker.click();
  assert.equal(await page.locator('.sketch-canvas line.selected').count(), 2);
  assert.equal(await input.inputValue(), '120');
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await input.fill('-60');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'angle',\s*\[5,\s*6\],\s*-60/);
  assert.match(await text(page), /'angle',\s*5,\s*0/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'angle',\s*\[5,\s*6\],\s*120/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /constraints:\s*\[\['angle',\s*5,\s*0\]\]/);
  assert.equal(await text(page), before);
});

test('perpendicular can be removed from a mixed subset and highlights its unselected line partner', async t => {
  const page = await open(t, source.replace('[20,15]', '[0,35]'));
  await selectLine(page, 5);
  await selectLine(page, 6, true);
  await button(page, 'Perpendicular').click();
  await waitForSource(page, /'perpendicular',\s*\[5,\s*6\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  await selectLine(page, 5);
  await page.keyboard.down('Shift');
  await point(page, 2).click();
  await page.keyboard.up('Shift');
  assert.equal(
    await button(page, 'Perpendicular').getAttribute('aria-pressed'),
    'mixed',
  );
  await button(page, 'Perpendicular').hover();
  assert.equal(
    await page.locator('.sketch-canvas line.constraint-related').count(),
    2,
  );
  await button(page, 'Perpendicular').click();
  await page
    .locator('.constraint-badge[data-kind="perpendicular"]')
    .waitFor({state: 'detached'});
  assert.doesNotMatch(await text(page), /'perpendicular'/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'perpendicular',\s*\[5,\s*6\]/);
});
