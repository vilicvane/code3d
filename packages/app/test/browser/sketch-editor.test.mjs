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

test('continuous lines reuse endpoints before recompile and undo one segment at a time', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core';\nlet value = sketch([]);",
  );
  assert.equal(
    await page.getByRole('button', {name: 'Point', exact: true}).count(),
    0,
  );
  for (const name of ['Select', 'Line', 'Delete', 'Fit', 'Snap']) {
    const button = page.getByRole('button', {name, exact: true});
    const icon = button.locator('svg.ui-icon');
    assert.equal(await icon.count(), 1);
    assert.equal(await icon.getAttribute('aria-hidden'), 'true');
    assert.equal(await icon.getAttribute('focusable'), 'false');
    assert.equal(await icon.getAttribute('stroke'), 'currentColor');
    const bounds = await icon.boundingBox();
    assert.equal(bounds.width, 16);
    assert.equal(bounds.height, 16);
  }
  // Clicking the glyph must retain the button action and accessible name.
  await page
    .getByRole('button', {name: 'Line', exact: true})
    .locator('svg')
    .click();
  const rect = await page.locator('.sketch-canvas').boundingBox();
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.click(
    rect.x + rect.width / 2 + 60,
    rect.y + rect.height / 2,
  );
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 2);
  assert.match(await text(page), /'point',\s*1/);
  assert.match(await text(page), /'point',\s*2/);
  await page.mouse.click(
    rect.x + rect.width / 2 + 60,
    rect.y + rect.height / 2 - 60,
  );
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 3);
  assert.match(await text(page), /'line',\s*5,\s*\[2,\s*4\]/);
  assert.equal(await page.locator('.source-edit-popover').isVisible(), false);
  await page.getByRole('textbox', {name: 'Length', exact: true}).click();
  assert.equal(await activeDimension(page), 'length');
  const completed = await text(page);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sketch-canvas .draft').count(), 0);
  assert.equal(await text(page), completed);
  await page.getByText('Ready', {exact: true}).waitFor();
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+z');
  await point(page, 4).waitFor({state: 'detached'});
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 2);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 1);
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

const field = (page, name) => page.getByRole('textbox', {name, exact: true});
const activeDimension = page =>
  page.evaluate(() => document.activeElement?.getAttribute('data-dimension'));
const emptySketch =
  "import {sketch} from '@code3d/core'; const value = sketch([]);";

test('line start XY and length/angle retain entered values through pointer movement and Tab', async t => {
  const page = await open(t, emptySketch);
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await page.keyboard.type('1.25');
  await page.keyboard.press('Tab');
  assert.equal(await activeDimension(page), 'y');
  await page.keyboard.type('-3.5');
  await page.keyboard.press('Tab');
  assert.equal(await activeDimension(page), 'x');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await activeDimension(page), 'y');
  const rect = await page.locator('.sketch-canvas').boundingBox();
  await page.mouse.move(rect.x + 200, rect.y + 230);
  assert.equal(await field(page, 'X').inputValue(), '1.25');
  assert.equal(await field(page, 'Y').inputValue(), '-3.5');
  await page.keyboard.press('Enter');
  assert.match(
    await text(page),
    /sketch\(\[\]\)/,
    'the start is still a draft',
  );
  await page.keyboard.type('40');
  await page.keyboard.press('Tab');
  await page.keyboard.type('90');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await activeDimension(page), 'angle');
  await page.mouse.move(rect.x + 400, rect.y + 300);
  assert.equal(await field(page, 'Length').inputValue(), '40');
  assert.equal(await field(page, 'Angle').inputValue(), '90');
  await page.keyboard.press('Enter');
  assert.match(await text(page), /'point',\s*1,\s*\[1.25,\s*-3.5\]/);
  assert.match(await text(page), /'point',\s*2,\s*\[1.25,\s*36.5\]/);
  assert.match(await text(page), /'line',\s*3,\s*\[1,\s*2\]/);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 1);

  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+z');
  await point(page, 2).waitFor({state: 'detached'});
  assert.equal(await point(page, 1).count(), 0);
});

test('partial input, validation and Escape never commit or discard an in-progress value', async t => {
  const page = await open(t, emptySketch);
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await page.keyboard.press('Enter');
  await field(page, 'Length').fill('-');
  await page.keyboard.press('Enter');
  assert.equal(await field(page, 'Length').inputValue(), '-');
  assert.equal(await activeDimension(page), 'length');
  assert.match(
    await page.locator('.drawing-input-error').innerText(),
    /finite number/,
  );
  assert.match(await text(page), /sketch\(\[\]\)/);
  await field(page, 'Length').fill('1.');
  await page.keyboard.press('End');
  await page.keyboard.type('25');
  assert.equal(await field(page, 'Length').inputValue(), '1.25');
  await field(page, 'Length').dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
  });
  assert.match(await text(page), /sketch\(\[\]\)/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sketch-canvas .draft').count(), 0);
  assert.equal(await field(page, 'X').inputValue(), '');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.drawing-inputs').isVisible(), false);
  assert.equal(
    await page
      .getByRole('button', {name: 'Select', exact: true})
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.match(await text(page), /sketch\(\[\]\)/);
});

test('numeric entry can finish on a named upstream point without losing the reference', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core'; const base = sketch([['point', 1, [30, 0]]]); const child = base.derive([]);",
  );
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await field(page, 'X').fill('0');
  await field(page, 'Y').fill('0');
  await page.keyboard.press('Enter');
  await field(page, 'Length').fill('30');
  await field(page, 'Angle').fill('0');
  assert.match(
    await page.locator('.snap-label').textContent(),
    /Point 1 · upstream/,
  );
  await page.keyboard.press('Enter');
  assert.match(await text(page), /'line',\s*2,\s*\[1,\s*base.point\(1\)\]/);
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 1);
  assert.equal(await page.locator('.sketch-canvas circle.upstream').count(), 1);
  // Recompilation must retain the continuing chain and its active numeric input.
  await field(page, 'Length').fill('10');
  await field(page, 'Angle').fill('90');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await field(page, 'Length').inputValue(), '10');
  assert.equal(await field(page, 'Angle').inputValue(), '90');
  assert.equal(await activeDimension(page), 'angle');
  await page.keyboard.press('Enter');
  assert.match(await text(page), /'line',\s*4,\s*\[base.point\(1\),\s*3\]/);
  assert.equal(await page.locator('.sketch-canvas circle.upstream').count(), 1);
});

test('leaving the sketch, changing tools and window blur cancel drafts, but focusing an input does not', async t => {
  const page = await open(t, emptySketch);
  const start = async () => {
    await page.getByRole('button', {name: 'Line', exact: true}).click();
    await page.keyboard.press('Enter');
    await field(page, 'Length').fill('12');
    assert.equal(await page.locator('.sketch-canvas .draft').count(), 1);
  };
  await start();
  await field(page, 'Angle').click();
  assert.equal(await field(page, 'Length').inputValue(), '12');
  await page.getByRole('button', {name: 'Select', exact: true}).click();
  assert.equal(await page.locator('.drawing-inputs').isVisible(), false);
  assert.equal(await page.locator('.sketch-canvas .draft').count(), 0);
  await start();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await field(page, 'X').inputValue(), '');
  await start();
  await page.locator('.monaco-editor .view-lines').click();
  assert.equal(await page.locator('.sketch-canvas .draft').count(), 0);
  assert.match(await text(page), /sketch\(\[\]\)/);
});

test('snap guides are visible, can be bypassed with Alt and never become persisted constraints', async t => {
  const page = await open(t, emptySketch);
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await page.keyboard.press('Enter');
  const rect = await page.locator('.sketch-canvas').boundingBox();
  await page.mouse.move(
    rect.x + rect.width / 2 + 100,
    rect.y + rect.height / 2 + 3,
  );
  assert.equal(await page.locator('.snap-label').textContent(), 'Horizontal');
  await page.keyboard.down('Alt');
  assert.equal(await page.locator('.snap-label').count(), 0);
  await page.keyboard.up('Alt');
  assert.equal(await page.locator('.snap-label').textContent(), 'Horizontal');
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  assert.equal(await page.locator('.snap-label').count(), 0);
  assert.equal(await page.locator('.sketch-canvas .draft').count(), 1);
  await page.keyboard.press('Enter');
  assert.match(await text(page), /'line'/);
  assert.doesNotMatch(await text(page), /constraint|horizontal/);
});

test('numeric fields retain native undo including the first character, independently of source history', async t => {
  const page = await open(t, emptySketch);
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await page.keyboard.press('Enter');
  await field(page, 'Length').fill('10');
  await field(page, 'Angle').fill('0');
  await page.keyboard.press('Enter');
  const before = await text(page);
  await page.keyboard.type('40');
  assert.equal(await field(page, 'Length').inputValue(), '40');
  await page.keyboard.press('Control+z');
  assert.equal(await field(page, 'Length').inputValue(), '');
  assert.equal(await text(page), before);
  assert.equal(await point(page, 1).count(), 1);
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await field(page, 'Length').inputValue(), '40');
  assert.equal(await text(page), before);
  await page.keyboard.press('Escape');
  // On the canvas, the same shortcut still belongs to the source history.
  await page.keyboard.press('Control+z');
  await point(page, 1).waitFor({state: 'detached'});
});

const draftSegment = page =>
  page
    .locator('.sketch-canvas .draft')
    .evaluate(line =>
      ['x1', 'y1', 'x2', 'y2'].map(name => Number(line.getAttribute(name))),
    );
const drawingTitle = page => page.locator('.drawing-input-title').textContent();

test('X/Y switch and cancel bidirectional axis locks independently of snap and key repeat', async t => {
  const page = await open(t, emptySketch);
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await page.keyboard.press('x');
  assert.equal(await drawingTitle(page), 'Start point');
  await page.keyboard.press('Enter');
  const canvas = page.locator('.sketch-canvas');
  const rect = await canvas.boundingBox();
  await page.mouse.move(
    rect.x + rect.width / 2 + 87,
    rect.y + rect.height / 2 - 53,
  );
  await page.keyboard.press('x');
  assert.equal(await drawingTitle(page), 'X locked');
  let [x1, y1, x2, y2] = await draftSegment(page);
  assert.equal(y1, y2);
  assert.ok(x2 > x1);
  await page.mouse.move(
    rect.x + rect.width / 2 - 95,
    rect.y + rect.height / 2 - 70,
  );
  [x1, y1, x2, y2] = await draftSegment(page);
  assert.equal(y1, y2);
  assert.ok(x2 < x1, 'the lock is an axis, not a positive-angle ray');
  await canvas.dispatchEvent('keydown', {key: 'x', repeat: true});
  await canvas.dispatchEvent('keydown', {key: 'y', isComposing: true});
  assert.equal(await drawingTitle(page), 'X locked');
  await page.keyboard.press('Shift+y');
  assert.equal(await drawingTitle(page), 'Y locked');
  [x1, y1, x2, y2] = await draftSegment(page);
  assert.equal(x1, x2);
  assert.ok(y2 < y1);
  await page.keyboard.press('y');
  assert.equal(await drawingTitle(page), 'Next point');
  [x1, y1, x2, y2] = await draftSegment(page);
  assert.notEqual(x1, x2);
  assert.notEqual(y1, y2);
  await page.keyboard.press('x');
  await page.keyboard.down('Alt');
  assert.equal(await page.locator('.snap-label').textContent(), 'X locked');
  [x1, y1, x2, y2] = await draftSegment(page);
  assert.equal(y1, y2);
  await page.keyboard.up('Alt');
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  assert.equal(await drawingTitle(page), 'X locked');
  await page.keyboard.press('Enter');
  assert.equal(await drawingTitle(page), 'Next point');
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 1);
  const completed = await text(page);
  assert.doesNotMatch(completed, /constraint|locked|axis/);
  await page.keyboard.press('y');
  await page.keyboard.press('Escape');
  assert.equal(await drawingTitle(page), 'Start point');
  assert.equal(await text(page), completed);
});

test('axis shortcuts share direction with Angle while preserving Length focus, text and native undo', async t => {
  const page = await open(t, emptySketch);
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await page.keyboard.press('Enter');
  const rect = await page.locator('.sketch-canvas').boundingBox();
  await page.mouse.move(
    rect.x + rect.width / 2 + 90,
    rect.y + rect.height / 2 - 90,
  );
  await page.keyboard.type('40');
  await page.keyboard.press('x');
  assert.equal(await drawingTitle(page), 'X locked');
  assert.equal(await activeDimension(page), 'length');
  assert.equal(await field(page, 'Length').inputValue(), '40');
  await page.keyboard.press('Control+z');
  assert.equal(await field(page, 'Length').inputValue(), '');
  assert.equal(await drawingTitle(page), 'X locked');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await field(page, 'Length').inputValue(), '40');
  await page.keyboard.press('Tab');
  await page.keyboard.type('45');
  assert.equal(await drawingTitle(page), 'Next point');
  await page.keyboard.press('Control+z');
  assert.equal(await field(page, 'Angle').inputValue(), '');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await field(page, 'Angle').inputValue(), '45');
  await page.keyboard.press('y');
  assert.equal(await drawingTitle(page), 'Y locked');
  assert.equal(await activeDimension(page), 'angle');
  assert.equal(await field(page, 'Angle').inputValue(), '');
  await field(page, 'Angle').fill('-');
  await page.keyboard.press('Enter');
  assert.match(
    await page.locator('.drawing-input-error').textContent(),
    /finite/,
  );
  await page.keyboard.press('x');
  assert.equal(await field(page, 'Angle').inputValue(), '');
  assert.equal(await field(page, 'Length').inputValue(), '40');
  assert.equal(await page.locator('.drawing-input-error').textContent(), '');
  assert.equal(await field(page, 'Angle').getAttribute('aria-invalid'), null);
  await page.keyboard.press('Enter');
  assert.match(await text(page), /'point',\s*2,\s*\[40,\s*0\]/);
  assert.equal(await drawingTitle(page), 'Next point');
  await page.keyboard.press('y');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(
    await drawingTitle(page),
    'Y locked',
    'recompile retains the current lock',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await drawingTitle(page), 'Start point');
});
