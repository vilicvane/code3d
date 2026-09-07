import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, point, text, waitForSource} from './sketch-test.ts';

const circle = (page: Page, id: number) =>
  page.locator(
    `.sketch-canvas circle.local[data-kind="circle"][data-id="${id}"]`,
  );
const arcs = (page: Page) =>
  page.locator('.sketch-canvas path.local[data-kind="arc"]');
async function center(page: Page, id: number) {
  const box = (await point(page, id).boundingBox())!;
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

test('Trim converts a circle interval to an arc with expression radius, stable geometry and one source undo', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core'; const r = 15; const value = sketch([['point', 1, [0, 0]], ['circle', 2, [1, r]], ['point', 3, [0, 10]], ['point', 4, [0, -10]]], {constraints: [['radius', [2, 10]]]});",
  );
  const original = await center(page, 1);
  const radius = Number(await circle(page, 2).getAttribute('r'));
  await page.getByRole('button', {name: 'Trim', exact: true}).click();
  await page.mouse.move(original.x + radius, original.y);
  const highlight = page.locator('.sketch-canvas path.trim-preview');
  await highlight.waitFor();
  assert.equal(await highlight.count(), 1);
  assert.equal(await highlight.evaluate(e => getComputedStyle(e).fill), 'none');
  await page.screenshot({
    path: '/tmp/code3d-circular-trim-R2x8P9/circle-hover-1400.png',
  });
  await page.mouse.click(original.x + radius, original.y);
  await circle(page, 2).waitFor({state: 'detached'});
  await arcs(page).waitFor();
  await waitForSource(page, /'arc',\s*2,\s*\[1,\s*r,\s*4,\s*3,\s*'cw'\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  const current = await center(page, 1);
  assert.ok(Math.hypot(current.x - original.x, current.y - original.y) < 0.01);
  const path = (await arcs(page).getAttribute('d'))!;
  assert.equal(Number(path.split(' A ')[1].split(' ')[0]), radius);
  assert.match(await text(page), /'radius',\s*\[2,\s*10\]/);
  await page.keyboard.press('Control+z');
  await circle(page, 2).waitFor();
  assert.equal(await arcs(page).count(), 0);
  assert.equal(Number(await circle(page, 2).getAttribute('r')), radius);
});

test('Select and Delete trim an interior arc, preserving radius dimensions and undoing both survivors atomically', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core'; const r = 10; const value = sketch([['point', 1, [0, 0]], ['point', 2, [10, 0]], ['point', 3, [0, -10]], ['point', 4, [0, 10]], ['point', 5, [-10, 0]], ['arc', 6, [1, r, 2, 3, 'ccw']]], {constraints: [['radius', [6, 10]], ['sweep', [6, 270]]]});",
  );
  const c = await center(page, 1);
  const p = await center(page, 2);
  const radius = p.x - c.x;
  await page.mouse.click(
    c.x - radius / Math.sqrt(2),
    c.y - radius / Math.sqrt(2),
  );
  await page
    .locator('.sketch-canvas path.selected[data-kind="segment"]')
    .waitFor();
  await page.keyboard.press('Delete');
  await waitForSource(page, /'arc',\s*7,/);
  assert.equal(await arcs(page).count(), 2);
  const source = await text(page);
  assert.doesNotMatch(source, /'sweep'/);
  assert.equal(source.match(/'radius'/g)?.length, 2);
  assert.equal(source.match(/\[1,\s*r,/g)?.length, 2);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'sweep',\s*\[6,\s*270\]/);
  await page
    .locator('.sketch-canvas path.local[data-kind="arc"][data-id="6"]')
    .waitFor();
  assert.equal(await arcs(page).count(), 1);
});

test('overlapping circles highlight and trim together, sharing new analytic cut points', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core'; const value = sketch([['point', 1, [0, 0]], ['circle', 2, [1, 10]], ['circle', 3, [1, 10]], ['point', 4, [-20, 3]], ['point', 5, [20, 3]], ['line', 6, [4, 5]]]);",
  );
  const c = await center(page, 1);
  const radius = Number(await circle(page, 2).getAttribute('r'));
  await page.getByRole('button', {name: 'Trim', exact: true}).click();
  await page.mouse.move(c.x, c.y - radius);
  assert.equal(
    await page.locator('.sketch-canvas path.trim-preview').count(),
    2,
  );
  await page.mouse.click(c.x, c.y - radius);
  await waitForSource(page, /'arc',\s*2,/);
  assert.equal(await arcs(page).count(), 2);
  assert.equal((await text(page)).match(/'point'/g)?.length, 5);
  await page.keyboard.press('Control+z');
  await circle(page, 2).waitFor();
  await circle(page, 3).waitFor();
  assert.equal(await arcs(page).count(), 0);
});

test('an isolated circle is directly trimmable and removes only its newly disconnected center', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core'; const value = sketch([['point', 1, [0, 0]], ['circle', 2, [1, 10]], ['point', 3, [20, 20]]]);",
  );
  const c = await center(page, 1);
  const radius = Number(await circle(page, 2).getAttribute('r'));
  await page.getByRole('button', {name: 'Trim', exact: true}).click();
  await page.mouse.move(c.x + radius, c.y);
  await page.locator('.sketch-canvas circle.trim-preview').waitFor();
  await page.mouse.click(c.x + radius, c.y);
  await circle(page, 2).waitFor({state: 'detached'});
  await point(page, 1).waitFor({state: 'detached'});
  await point(page, 3).waitFor();
  await page.keyboard.press('Control+z');
  await circle(page, 2).waitFor();
  await point(page, 1).waitFor();
});
