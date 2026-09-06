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
// Sketch geometry updates synchronously, while Monaco renders source edits on
// its next frame. Wait for the expected source, not compilation or a fixed delay.
async function waitForSource(page, pattern) {
  await page.waitForFunction(
    ({source, flags}) =>
      new RegExp(source, flags).test(
        document
          .querySelector('.monaco-editor .view-lines')
          .innerText.replaceAll('\u00a0', ' '),
      ),
    {source: pattern.source, flags: pattern.flags},
  );
}
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
  for (const name of [
    'Select',
    'Line',
    'Rectangle',
    'Center rectangle',
    'Delete',
    'Fit',
    'Snap',
  ]) {
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
  await waitForSource(page, /'line',\s*3,\s*\[1,\s*2\]/);
  assert.match(await text(page), /'point',\s*1/);
  assert.match(await text(page), /'point',\s*2/);
  await page.mouse.click(
    rect.x + rect.width / 2 + 60,
    rect.y + rect.height / 2 - 60,
  );
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 3);
  await waitForSource(page, /'line',\s*5,\s*\[2,\s*4\]/);
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
  await waitForSource(page, /base\.point\(2\), 1/);
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
  const before = await screenPoint(point(page, 1));
  await drag(page, point(page, 1), 40, 20);
  await settleDrag(page);
  await page.getByText('Ready', {exact: true}).waitFor();
  const after = await screenPoint(point(page, 1));
  assert.equal(after[0], before[0]);
  assert.ok(Math.abs(after[1] - before[1]) > 10);
  assert.match(await text(page), /\[width,\s*-/);
  await point(page, 1).click();
  assert.match(
    await page.locator('.sketch-editor output').innerText(),
    /X locked by expression/,
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
  await waitForSource(page, /'line',\s*3,\s*\[1,\s*2\]/);
  await page.getByRole('button', {name: 'Select', exact: true}).click();
  const created = await text(page);
  const start = await screenPoint(point(page, 1));
  const anchor = await screenPoint(point(page, 2));
  await drag(page, point(page, 1), 35, -25);
  await settleDrag(page);
  assert.notDeepEqual(
    await screenPoint(point(page, 1)),
    start,
    'new point data is available before recompilation',
  );
  assert.deepEqual(await screenPoint(point(page, 2)), anchor);
  // Source edits are synchronous; Monaco's view-lines render on a later frame.
  await page
    .locator('.monaco-editor .view-lines')
    .filter({hasNotText: created})
    .waitFor();
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
  await waitForSource(page, /'line',\s*3,\s*\[1,\s*2\]/);
  assert.match(await text(page), /'point',\s*1,\s*\[1.25,\s*-3.5\]/);
  assert.match(await text(page), /'point',\s*2,\s*\[1.25,\s*36.5\]/);
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
  await waitForSource(page, /'line',\s*2,\s*\[1,\s*base\.point\(1\)\]/);
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
  await waitForSource(page, /'line',\s*4,\s*\[base\.point\(1\),\s*3\]/);
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
  await waitForSource(page, /'line'/);
  assert.doesNotMatch(await text(page), /constraint|horizontal/);
});

test('numeric fields retain native undo including the first character, independently of source history', async t => {
  const page = await open(t, emptySketch);
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await page.keyboard.press('Enter');
  await field(page, 'Length').fill('10');
  await field(page, 'Angle').fill('0');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'line',\s*3,\s*\[1,\s*2\]/);
  const before = await text(page);
  await page.keyboard.type('40');
  assert.equal(await field(page, 'Length').inputValue(), '40');
  // Native Chrome may split typing when Monaco asynchronously tokenizes the
  // just-edited source. Every native group must remain in the field's history.
  let groups = 0;
  while (await field(page, 'Length').inputValue()) {
    assert.ok(groups++ < 2);
    await page.keyboard.press('Control+z');
    assert.equal(await text(page), before);
    assert.equal(await point(page, 1).count(), 1);
  }
  for (let i = 0; i < groups; i++) await page.keyboard.press('Control+Shift+z');
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
  await waitForSource(page, /\['horizontal',\s*3\]/);
  const completed = await text(page);
  assert.match(completed, /constraints/);
  assert.match(completed, /\['horizontal',\s*3\]/);
  assert.doesNotMatch(completed, /vertical|locked|axis/);
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
  await waitForSource(page, /'point',\s*2,\s*\[40,\s*0\]/);
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

const constrainedLine = `import {sketch} from '@code3d/core';
const value = sketch([
  ['point', 1, [0, 0]],
  ['point', 2, [40, 0]],
  ['line', 3, [1, 2]],
], {constraints: [['horizontal', 3], ['length', [3, 40]]]});`;
const screenPoint = locator =>
  locator.evaluate(e => [
    Number(e.getAttribute('cx')),
    Number(e.getAttribute('cy')),
  ]);
const settleDrag = page =>
  page
    .getByRole('region', {name: 'Sketch editor'})
    .filter({has: page.locator('svg')})
    .evaluate(async root => {
      if (root.getAttribute('aria-busy') !== 'true') return;
      await new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (root.getAttribute('aria-busy') !== 'true') {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(root, {
          attributes: true,
          attributeFilter: ['aria-busy'],
        });
      });
    });

test('constrained drag anchors the opposite endpoint, keeps length and survives recompilation with one undo', async t => {
  const page = await open(
    t,
    constrainedLine.replace("['horizontal', 3], ", ''),
  );
  const source = await text(page);
  const a = await screenPoint(point(page, 1)),
    b = await screenPoint(point(page, 2));
  await page.evaluate(
    () =>
      (globalThis.originalSketchPoint = document.querySelector(
        '.sketch-canvas circle.local[data-id="1"]',
      )),
  );
  await drag(page, point(page, 2), -40, -50);
  await settleDrag(page);
  await page.getByText('Ready', {exact: true}).waitFor();
  const movedA = await screenPoint(point(page, 1)),
    movedB = await screenPoint(point(page, 2));
  assert.deepEqual(movedA, a);
  assert.ok(
    Math.abs(
      Math.hypot(movedB[0] - movedA[0], movedB[1] - movedA[1]) -
        Math.hypot(b[0] - a[0], b[1] - a[1]),
    ) < 1e-5,
  );
  assert.ok(Math.abs(movedB[1] - b[1]) > 20);
  assert.notEqual(await text(page), source);
  assert.match(await text(page), /'length',\s*\[3,\s*40\]/);
  assert.equal(
    await page.evaluate(
      () =>
        globalThis.originalSketchPoint ===
        document.querySelector('.sketch-canvas circle.local[data-id="1"]'),
    ),
    true,
  );
  await page.keyboard.press('Control+z');
  await page.getByText('Ready', {exact: true}).waitFor();
  await point(page, 2).waitFor();
  assert.match(await text(page), /'point',\s*2,\s*\[40,\s*0\]/);
  assert.doesNotMatch(await text(page), /'horizontal'|'fixed'/);
});

test('expression locks survive constrained preview, release and undo without rewriting dependencies', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const width = 0, height = 0;
const value = sketch([
  ['point', 1, [width, height]],
  ['point', 2, [40, 0]],
  ['line', 3, [1, 2]],
], {constraints: [['length', [3, 40]]]});`,
  );
  const source = await text(page);
  const anchor = await screenPoint(point(page, 1));
  await drag(page, point(page, 1), 40, 30);
  assert.equal(await text(page), source, 'both expression axes are read-only');
  assert.deepEqual(await screenPoint(point(page, 1)), anchor);
  assert.match(
    await page.locator('.sketch-editor output').innerText(),
    /X\/Y locked by expression/,
  );

  const rect = await point(page, 2).boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2 - 40,
    rect.y + rect.height / 2 - 50,
    {steps: 8},
  );
  await settleDrag(page);
  const preview = await screenPoint(point(page, 2));
  assert.deepEqual(await screenPoint(point(page, 1)), anchor);
  await page.mouse.up();
  await settleDrag(page);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.deepEqual(await screenPoint(point(page, 1)), anchor);
  const released = await screenPoint(point(page, 2));
  released.forEach((v, axis) => assert.ok(Math.abs(v - preview[axis]) < 1e-5));
  assert.match(await text(page), /\[width,\s*height\]/);
  assert.doesNotMatch(await text(page), /fixed|offset/);
  assert.notEqual(await text(page), source);
  await page.keyboard.press('Control+z');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.match(await text(page), /'point',\s*2,\s*\[40,\s*0\]/);
  assert.match(await text(page), /\[width,\s*height\]/);
});

test('fully constrained points resist dragging without writing a source transaction', async t => {
  const page = await open(
    t,
    constrainedLine.replace('constraints: [', "constraints: [['fixed', 1], "),
  );
  const before = await text(page);
  const p = await screenPoint(point(page, 2));
  await drag(page, point(page, 2), -60, -70);
  await settleDrag(page);
  assert.deepEqual(await screenPoint(point(page, 2)), p);
  assert.equal(await text(page), before);
});

test('rectangle dimensions retain native input, emit persistent sizes and undo the whole rectangle', async t => {
  const page = await open(t, emptySketch);
  await page.getByRole('button', {name: 'Rectangle', exact: true}).click();
  const canvas = await page.locator('.sketch-canvas').boundingBox();
  await page.mouse.click(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  await page.mouse.move(
    canvas.x + canvas.width / 2 + 90,
    canvas.y + canvas.height / 2 - 70,
  );
  assert.equal(await page.locator('.drawing-overlay line.draft').count(), 4);
  assert.equal(await drawingTitle(page), 'Opposite corner');
  await page.keyboard.type('40');
  await page.keyboard.press('Control+z');
  assert.equal(await field(page, 'Width').inputValue(), '');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await field(page, 'Width').inputValue(), '40');
  await page.keyboard.press('Tab');
  await page.keyboard.type('30');
  await page.mouse.move(
    canvas.x + canvas.width / 2 - 90,
    canvas.y + canvas.height / 2 + 70,
  );
  assert.equal(await field(page, 'Width').inputValue(), '40');
  assert.equal(await field(page, 'Height').inputValue(), '30');
  await page.keyboard.press('Enter');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 4);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 4);
  assert.match(await text(page), /'point',\s*3,\s*\[-40,\s*-30\]/);
  assert.match(await text(page), /'length',\s*\[5,\s*40\]/);
  assert.match(await text(page), /'length',\s*\[6,\s*30\]/);
  assert.equal(await drawingTitle(page), 'First corner');
  assert.equal(await page.locator('.drawing-overlay line.draft').count(), 0);
  await page.keyboard.press('Control+z');
  await page
    .locator('.sketch-canvas line.local')
    .first()
    .waitFor({state: 'detached'});
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 0);
  assert.doesNotMatch(await text(page), /constraints/);
  await page.keyboard.press('Control+Shift+z');
  await point(page, 3).waitFor();
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 4);
});

test('a free rectangle keeps its right angles after a corner drag and recompilation', async t => {
  const page = await open(t, emptySketch);
  await page.getByRole('button', {name: 'Rectangle', exact: true}).click();
  const canvas = await page.locator('.sketch-canvas').boundingBox();
  await page.mouse.click(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  await page.mouse.click(
    canvas.x + canvas.width / 2 + 100,
    canvas.y + canvas.height / 2 - 80,
  );
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 4);
  assert.doesNotMatch(await text(page), /'length'|'fixed'/);
  const before = await screenPoint(point(page, 3));
  await page.getByRole('button', {name: 'Select', exact: true}).click();
  await drag(page, point(page, 3), 40, -30);
  await settleDrag(page);
  await page.getByText('Ready', {exact: true}).waitFor();
  const [a, b, c, d] = await Promise.all(
    [1, 2, 3, 4].map(id => screenPoint(point(page, id))),
  );
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5);
  near(a[1], b[1]);
  near(b[0], c[0]);
  near(c[1], d[1]);
  near(d[0], a[0]);
  assert.ok(c[0] - before[0] > 20 && before[1] - c[1] > 15);
});

test('rectangle validation and cancellation preserve source, while snapped upstream corners stay named', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const base = sketch([['point',1,[0,0]]]);
const child = base.derive([]);`,
  );
  await page.getByRole('button', {name: 'Rectangle', exact: true}).click();
  await point(page, 1, 'upstream').click();
  await field(page, 'Width').fill('0');
  await field(page, 'Height').fill('20');
  await page.keyboard.press('Enter');
  assert.match(
    await page.locator('.drawing-input-error').innerText(),
    /greater than zero/,
  );
  assert.match(await text(page), /derive\(\[\]\)/);
  await page.keyboard.press('Escape');
  assert.equal(await drawingTitle(page), 'First corner');
  await point(page, 1, 'upstream').click();
  await field(page, 'Width').fill('30');
  await page.keyboard.press('Tab');
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.match(await text(page), /base\.point\(1\)/);
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 3);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 4);
  assert.equal(await point(page, 1, 'upstream').count(), 1);
  const complete = await text(page);
  await page.getByRole('button', {name: 'Select', exact: true}).click();
  await drag(page, point(page, 1, 'upstream'), 30, 20);
  assert.equal(await text(page), complete);
});

test('deleting a constrained line removes only its constraints and undo restores them together', async t => {
  const page = await open(t, constrainedLine);
  const a = await point(page, 1).boundingBox(),
    b = await point(page, 2).boundingBox();
  await page.mouse.click((a.x + b.x + a.width) / 2, a.y + a.height / 2);
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 0);
  assert.doesNotMatch(await text(page), /'horizontal'|'length'/);
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 2);
  await page.getByText('Ready', {exact: true}).waitFor();
  await page.keyboard.press('Control+z');
  await page.locator('.sketch-canvas line.local').waitFor({state: 'attached'});
  assert.match(await text(page), /'horizontal',\s*3/);
  assert.match(await text(page), /'length',\s*\[3,\s*40\]/);
});

test('center rectangle numeric sizes are full side lengths and its center undoes atomically', async t => {
  const page = await open(t, emptySketch);
  await page
    .getByRole('button', {name: 'Center rectangle', exact: true})
    .click();
  assert.equal(await drawingTitle(page), 'Center');
  await field(page, 'X').fill('5');
  await page.keyboard.press('Tab');
  await page.keyboard.type('-3');
  await page.keyboard.press('Enter');
  assert.equal(await drawingTitle(page), 'Corner');
  await page.keyboard.type('40');
  await page.keyboard.press('Tab');
  await page.keyboard.type('20');
  assert.equal(await activeDimension(page), 'height');
  assert.equal(await page.locator('.drawing-overlay line.draft').count(), 4);
  await page.keyboard.press('Enter');
  await waitForSource(page, /'midpoint',\s*\[1,\s*2,\s*4\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 5);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 4);
  assert.match(await text(page), /'point',\s*1,\s*\[5,\s*-3\]/);
  assert.match(await text(page), /'length',\s*\[6,\s*40\]/);
  assert.match(await text(page), /'length',\s*\[7,\s*20\]/);
  const [m, a, b, c] = await Promise.all(
    [1, 2, 3, 4].map(id => screenPoint(point(page, id))),
  );
  assert.ok(Math.abs(Math.abs(b[0] - a[0]) - 240) < 1e-5);
  assert.ok(Math.abs(Math.abs(c[1] - b[1]) - 120) < 1e-5);
  m.forEach((v, axis) =>
    assert.ok(Math.abs(v - (a[axis] + c[axis]) / 2) < 1e-5),
  );
  assert.equal(await drawingTitle(page), 'Center');
  await page.keyboard.press('Control+z');
  await point(page, 1).waitFor({state: 'detached'});
  await waitForSource(page, /sketch\(\[\]\)/);
  assert.equal(await page.locator('.sketch-canvas .local').count(), 0);
  await page.keyboard.press('Control+Shift+z');
  await point(page, 1).waitFor();
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 5);
});

test('center rectangle corners resize symmetrically through preview, recompilation and undo', async t => {
  const page = await open(t, emptySketch);
  await page
    .getByRole('button', {name: 'Center rectangle', exact: true})
    .click();
  const canvas = await page.locator('.sketch-canvas').boundingBox();
  await page.mouse.click(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  await page.mouse.click(
    canvas.x + canvas.width / 2 + 120,
    canvas.y + canvas.height / 2 - 90,
  );
  await waitForSource(page, /'midpoint'/);
  await page.getByText('Ready', {exact: true}).waitFor();
  const before = await text(page);
  const center = await screenPoint(point(page, 1));
  const corner = await screenPoint(point(page, 4));
  await page.getByRole('button', {name: 'Select', exact: true}).click();
  await drag(page, point(page, 4), 45, -30);
  await settleDrag(page);
  await page.getByText('Ready', {exact: true}).waitFor();
  const [m, a, b, c, d] = await Promise.all(
    [1, 2, 3, 4, 5].map(id => screenPoint(point(page, id))),
  );
  assert.deepEqual(m, center);
  assert.ok(c[0] - corner[0] > 30 && corner[1] - c[1] > 20);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5);
  m.forEach((v, axis) => {
    near(v, (a[axis] + c[axis]) / 2);
    near(v, (b[axis] + d[axis]) / 2);
  });
  near(a[1], b[1]);
  near(b[0], c[0]);
  near(c[1], d[1]);
  near(d[0], a[0]);
  assert.notEqual(await text(page), before);
  assert.doesNotMatch(await text(page), /'fixed'|'length'/);
  await page.keyboard.press('Control+z');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.deepEqual(await screenPoint(point(page, 4)), corner);
});

test('center rectangles preserve named upstream centers and remove midpoint constraints with deleted corners', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const base = sketch([['point',1,[0,0]]]);
const child = base.derive([]);`,
  );
  await page
    .getByRole('button', {name: 'Center rectangle', exact: true})
    .click();
  await point(page, 1, 'upstream').click();
  await field(page, 'Width').fill('-');
  await page.keyboard.press('Enter');
  assert.match(
    await page.locator('.drawing-input-error').innerText(),
    /finite/,
  );
  await page.keyboard.press('Escape');
  assert.equal(await drawingTitle(page), 'Center');
  await point(page, 1, 'upstream').click();
  await field(page, 'Width').fill('40');
  await page.keyboard.press('Tab');
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'midpoint',\s*\[base\.point\(1\),\s*1,\s*3\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  // The initial single upstream point is zoomed in; numeric creation may extend
  // beyond that view. Fit the completed geometry before picking its corners.
  await page.getByRole('button', {name: 'Fit', exact: true}).click();
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 4);
  const center = await screenPoint(point(page, 1, 'upstream'));
  await page.getByRole('button', {name: 'Select', exact: true}).click();
  await drag(page, point(page, 1, 'upstream'), 30, 20);
  assert.deepEqual(await screenPoint(point(page, 1, 'upstream')), center);
  await point(page, 1).click();
  await page.keyboard.press('Delete');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.doesNotMatch(await text(page), /'midpoint'/);
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 3);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 2);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'midpoint'/);
  await point(page, 1).waitFor();
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 4);
});
