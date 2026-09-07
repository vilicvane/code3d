import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, point, text, waitForSource} from './sketch-test.ts';

const circle = (page: Page, id: number, layer = 'local') =>
  page.locator(
    `.sketch-canvas circle.${layer}[data-kind="circle"][data-id="${id}"]`,
  );
const radius = async (page: Page, id = 2) =>
  Number(await circle(page, id).getAttribute('r'));
const field = (page: Page, label: string) =>
  page.getByRole('textbox', {name: label, exact: true});
const empty = "import {sketch} from '@code3d/core';\nconst value = sketch([]);";
async function resize(page: Page, id: number, delta: number) {
  const bounds = (await circle(page, id).boundingBox())!;
  const x = bounds.x + bounds.width,
    y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, {steps: 5});
  await page.mouse.up();
}

test('numeric circles use analytic previews, native input history and one atomic undo', async t => {
  const page = await open(t, empty);
  await page.getByRole('button', {name: 'Circle', exact: true}).click();
  const bounds = (await page.locator('.sketch-canvas').boundingBox())!;
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await page.mouse.click(x, y);
  await page.mouse.move(x + 80, y);
  assert.equal(await page.locator('.drawing-overlay circle.draft').count(), 1);
  await page.keyboard.type('12', {delay: 30});
  assert.equal(await field(page, 'Radius').inputValue(), '12');
  await page.keyboard.press('Control+z');
  // Chrome may split typing groups when Monaco replaces an unrelated text
  // node. Both native groupings must retain the complete undo/redo history;
  // only the source transaction below promises exactly one undo step.
  const undone = await field(page, 'Radius').inputValue();
  assert.ok(undone === '' || undone === '1');
  if (undone === '1') await page.keyboard.press('Control+z');
  assert.equal(await field(page, 'Radius').inputValue(), '');
  await page.keyboard.press('Control+Shift+z');
  if (undone === '1') {
    assert.equal(await field(page, 'Radius').inputValue(), '1');
    await page.keyboard.press('Control+Shift+z');
  }
  assert.equal(await field(page, 'Radius').inputValue(), '12');
  await page.keyboard.press('Enter');
  await circle(page, 2).waitFor();
  await waitForSource(page, /'radius',\s*\[2,\s*12\]/);
  assert.equal(
    await page
      .locator('.sketch-canvas circle.local[data-kind="point"]')
      .count(),
    1,
  );
  assert.equal(
    await circle(page, 2).evaluate(e => getComputedStyle(e).fill),
    'none',
  );
  assert.equal(
    await page
      .locator('.constraint-badge')
      .getByText('R12', {exact: true})
      .count(),
    1,
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await circle(page, 2).waitFor({state: 'detached'});
  assert.doesNotMatch(await text(page), /constraints/);
  await page.keyboard.press('Control+Shift+z');
  await circle(page, 2).waitFor();
});

test('free radius drags survive recompilation and undo; deleting the circle cleans its center', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core';\nconst value = sketch([['point', 1, [0, 0]], ['circle', 2, [1, 10]]]);",
  );
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  const before = await radius(page);
  await resize(page, 2, 45);
  await page.waitForFunction(
    before =>
      Number(
        document
          .querySelector('.sketch-canvas circle[data-kind="circle"]')!
          .getAttribute('r'),
      ) >
      before + 30,
    before,
  );
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.ok((await radius(page)) > before + 30);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    before =>
      Math.abs(
        Number(
          document
            .querySelector('.sketch-canvas circle[data-kind="circle"]')!
            .getAttribute('r'),
        ) - before,
      ) < 0.1,
    before,
  );
  await resize(page, 2, 0);
  await page.keyboard.press('Delete');
  await circle(page, 2).waitFor({state: 'detached'});
  assert.equal(await point(page, 1).count(), 0);
  await page.keyboard.press('Control+z');
  await circle(page, 2).waitFor();
  await point(page, 1).waitFor();
});

test('hard radius and expression radius remain unchanged while their centers can move', async t => {
  for (const [data, options] of [
    ['10', ", {constraints: [['radius', [2, 10]]]}"],
    ['size', ''],
  ]) {
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';\nconst size = 10;\nconst value = sketch([['point', 1, [0, 0]], ['circle', 2, [1, ${data}]]]${options});`,
    );
    await page.getByRole('button', {name: 'Snap', exact: true}).click();
    const before = await radius(page);
    await resize(page, 2, 40);
    assert.ok(Math.abs((await radius(page)) - before) < 0.1);
    const p = (await point(page, 1).boundingBox())!;
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.move(p.x + p.width / 2 + 30, p.y + p.height / 2 - 20, {
      steps: 5,
    });
    await page.mouse.up();
    await waitForSource(page, /'point',\s*1,\s*\[(?!0,\s*0)/);
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.ok(Math.abs((await radius(page)) - before) < 0.1);
    if (data === 'size')
      assert.match(await text(page), /'circle',\s*2,\s*\[1,\s*size\]/);
  }
});

test('canceling a circle creates no source data and an upstream center stays a named reference', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core';\nconst base = sketch([['point', 7, [0, 0]]]);\nconst value = base.derive([]);",
  );
  const before = await text(page);
  await page.getByRole('button', {name: 'Circle', exact: true}).click();
  await point(page, 7, 'upstream').click();
  await page.keyboard.type('5');
  await page.keyboard.press('Escape');
  assert.equal(await text(page), before);
  await point(page, 7, 'upstream').click();
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await circle(page, 1).waitFor();
  await waitForSource(page, /'circle',\s*1,\s*\[base\.point\(7\),\s*5\]/);
  assert.equal(
    await page
      .locator('.sketch-canvas circle.local[data-kind="point"]')
      .count(),
    0,
  );
});
