import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium} from 'playwright-core';

const appUrl = process.env.CODE3D_TEST_URL;
let browser;
before(async () => {
  assert.ok(appUrl, 'Set CODE3D_TEST_URL to the development server URL');
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

async function open(t, source) {
  const context = await browser.newContext({
    viewport: {width: 1400, height: 900},
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(appUrl);
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 30_000});
  await page.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(source);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('region', {name: 'Sketch editor'}).waitFor();
  return page;
}

const text = async page =>
  (await page.locator('.monaco-editor .view-lines').innerText()).replaceAll(
    '\u00a0',
    ' ',
  );
const point = (page, id, layer = 'local') =>
  page.locator(`.sketch-canvas circle.${layer}[data-id="${id}"]`);
async function drag(page, locator, dx, dy) {
  const rect = await locator.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2 + dx,
    rect.y + rect.height / 2 + dy,
    {steps: 5},
  );
  await page.mouse.up();
}

test('an empty sketch accepts rapid point edits before recompile and one-step undo', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core';\nlet value = sketch([]);",
  );
  await page.getByRole('button', {name: 'Point', exact: true}).click();
  const rect = await page.locator('.sketch-canvas').boundingBox();
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.click(
    rect.x + rect.width / 2 + 60,
    rect.y + rect.height / 2,
  );
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 2);
  assert.match(await text(page), /'point',\s*1/);
  assert.match(await text(page), /'point',\s*2/);
  await page.getByText('Ready', {exact: true}).waitFor();
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+z');
  await point(page, 2).waitFor({state: 'detached'});
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 1);
});

test('derived editing connects named upstream points and cannot drag or delete upstream geometry', async t => {
  const source =
    "import {sketch} from '@code3d/core';\nconst base = sketch([['point', 1, [0,0]], ['point', 2, [30,0]], ['line', 3, [1,2]]]);\nlet child = base.derive([['point', 1, [10,20]]]);";
  const page = await open(t, source);
  await drag(page, point(page, 1, 'upstream'), 40, 25);
  await page.keyboard.press('Delete');
  assert.match(await text(page), /\[0,0\]/);
  assert.equal(await point(page, 1, 'upstream').count(), 1);
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await point(page, 2, 'upstream').click();
  await point(page, 1).click();
  assert.match(await text(page), /base\.point\(2\), 1/);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 1);
  await page.getByRole('button', {name: 'Select', exact: true}).click();
  await drag(page, point(page, 1), 40, -20);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.doesNotMatch(await text(page), /\[10,20\]/);
  await point(page, 1).click();
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.sketch-canvas .local').count(), 0);
  assert.equal(await page.locator('.sketch-canvas .upstream').count(), 3);
});

test('expression coordinates stay intact and switching named bindings switches the editable layer', async t => {
  const source =
    "import {sketch} from '@code3d/core';\nconst width = 20;\nconst base = sketch([['point', 1, [width, 0]]]);\nconst child = base.derive([]);";
  const page = await open(t, source);
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await point(page, 1).waitFor();
  await drag(page, point(page, 1), 40, 20);
  assert.match(await text(page), /width, 0/);
  assert.match(
    await page.locator('.sketch-editor output').innerText(),
    /Expression-driven/,
  );
});

test('a line between empty positions commits its points atomically and Escape cancels unfinished gestures', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core'; const value = sketch([]);",
  );
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  const rect = await page.locator('.sketch-canvas').boundingBox();
  await page.mouse.click(rect.x + 160, rect.y + 200);
  await page.keyboard.press('Escape');
  assert.match(await text(page), /sketch\(\[\]\)/);
  await page.mouse.click(rect.x + 160, rect.y + 200);
  await page.mouse.click(rect.x + 280, rect.y + 200);
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 2);
  assert.match(await text(page), /'line',\s*3,\s*\[1,\s*2\]/);
  await page.getByRole('button', {name: 'Select', exact: true}).click();
  const before = await text(page);
  const p = await point(page, 1).boundingBox();
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(p.x + 50, p.y + 50);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await text(page), before);
});
