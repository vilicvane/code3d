import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {clickSegment, open, point, text, waitForSource} from './sketch-test.ts';

const source = [
  "import {sketch} from '@code3d/core';",
  'const width = 40;',
  "const value = sketch([['point',1,[0,0]],['point',2,[20,0]],['line',3,[1,2]]], {constraints: [['fixed',1],['horizontal',3]]});",
].join('\n');
const form = (page: Page) => page.getByRole('form', {name: 'Constraint value'});
const input = (page: Page) =>
  form(page).getByRole('textbox', {name: 'Length', exact: true});
const badge = (page: Page) =>
  page.locator('.constraint-badge[data-kind="length"]');
async function addLength(page: Page) {
  await clickSegment(
    page,
    page.locator('.sketch-canvas line.local[data-id="3"]'),
  );
  await page
    .getByRole('toolbar', {name: 'Selection constraints'})
    .getByRole('button', {name: 'Length', exact: true})
    .click();
}
async function length(page: Page) {
  const bounds = await Promise.all(
    [1, 2].map(id => point(page, id).boundingBox()),
  );
  assert.ok(bounds[0] && bounds[1]);
  return Math.hypot(bounds[1].x - bounds[0].x, bounds[1].y - bounds[0].y);
}

test('length expressions add, edit and recompile in source scope with one undo per commit', async t => {
  const page = await open(t, source);
  const before = await text(page);
  const originalLength = await length(page);
  await addLength(page);
  assert.equal(await input(page).getAttribute('inputmode'), 'text');
  await input(page).fill('width / 2');
  assert.equal(await text(page), before);
  await page.keyboard.press('Enter');
  await waitForSource(page, /'length',\s*3,\s*width \/ 2/);
  await page.getByText('Ready', {exact: true}).waitFor();
  await badge(page).waitFor();
  assert.ok(Math.abs((await length(page)) - originalLength) < 0.01);
  await badge(page).click();
  assert.equal(await input(page).inputValue(), 'width / 2');
  assert.equal(
    await input(page).evaluate(el => document.activeElement === el),
    true,
  );
  await input(page).fill('Math.max(width / 2, 30)');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'length',\s*3,\s*Math.max\(width \/ 2, 30\)/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.ok(Math.abs((await length(page)) - originalLength * 1.5) < 0.01);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'length',\s*3,\s*width \/ 2/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.ok(Math.abs((await length(page)) - originalLength) < 0.01);
  await page.keyboard.press('Control+z');
  await badge(page).waitFor({state: 'detached'});
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await text(page), before);
  await page.keyboard.press('Control+y');
  await badge(page).waitFor();
  await badge(page).click();
  assert.equal(await input(page).inputValue(), 'width / 2');
});

test('expression syntax errors and cancellation preserve source and native input history', async t => {
  const page = await open(t, source);
  const before = await text(page);
  await addLength(page);
  for (const expression of ['width /', '20, 30', '...values', '-1']) {
    await input(page).fill(expression);
    await page.keyboard.press('Enter');
    assert.equal(await input(page).getAttribute('aria-invalid'), 'true');
    assert.ok((await form(page).getByRole('alert').innerText()).length);
    assert.equal(await text(page), before);
  }
  await page.keyboard.press('Escape');
  await addLength(page);
  await page.keyboard.type('width / 2');
  await page.keyboard.press('Control+z');
  assert.equal(await input(page).inputValue(), '');
  await page.keyboard.type('width / 2');
  await page.keyboard.press('Escape');
  assert.equal(await form(page).count(), 0);
  assert.equal(await text(page), before);
});

test('dimension fields grow with measured text, cap at 320px and fit a narrow viewport', async t => {
  const page = await open(t, source);
  await addLength(page);
  const field = input(page);
  const minimum = (await field.boundingBox())!.width;
  assert.equal(minimum, 82);
  const medium = 'width + width / 2';
  await field.fill(medium);
  const grown = (await field.boundingBox())!.width;
  assert.ok(grown > minimum && grown < 320, String(grown));
  const long = 'width + '.repeat(30) + 'width';
  await field.fill(long);
  assert.equal((await field.boundingBox())!.width, 320);
  assert.equal(await field.evaluate(el => document.activeElement === el), true);
  await page.setViewportSize({width: 680, height: 900});
  const canvas = (await page
    .getByRole('region', {name: 'Sketch editor'})
    .boundingBox())!;
  const box = (await field.boundingBox())!;
  assert.ok(
    box.x >= canvas.x && box.x + box.width <= canvas.x + canvas.width,
    JSON.stringify({canvas, box}),
  );
  assert.ok(box.width <= 320);
  assert.equal(await field.inputValue(), long);
  await field.fill('2');
  assert.equal((await field.boundingBox())!.width, minimum);
  assert.equal(await field.evaluate(el => document.activeElement === el), true);
});
