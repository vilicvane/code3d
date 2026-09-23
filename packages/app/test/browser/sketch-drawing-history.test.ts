import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from './browser-connection.ts';
import {open, point, selectTool, waitForSource} from './sketch-test.ts';

const empty = "import {sketch} from '@code3d/core';\nconst value = sketch([]);";
const source = (page: Page) =>
  page.evaluate(() => window.sketchTestEditor.getModel()!.getValue());

test('undo and an immediate replacement click share the restored geometry before recompilation', async t => {
  const page = await open(t, empty);
  await selectTool(page, 'Line');
  await click(page, 0, 0);
  await click(page, 20, 0);
  await click(page, 20, 20);
  await point(page, 4).waitFor();
  const [x, y] = await screen(page, 36, 16);
  const updated = await page.evaluate(
    ({x, y}) => {
      const canvas = document.querySelector<SVGElement>('.sketch-canvas')!;
      canvas.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          code: 'KeyZ',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          button: 0,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      );
      return window.sketchTestEditor.getModel()!.getValue();
    },
    {x, y},
  );
  assert.match(updated, /'point',\s*4,\s*\[36,\s*16\]/);
  assert.match(updated, /'line',\s*5,\s*\[2,\s*4\]/);
  await waitForSource(page, /'point',\s*4,\s*\[36,\s*16\]/);
});
async function screen(page: Page, x: number, y: number) {
  return page.evaluate(
    ({x, y}) => {
      const bounds = document
        .querySelector('.sketch-canvas')!
        .getBoundingClientRect();
      const {center, scale} =
        window.sketchTestRuntime.sketchEditor.navigation.pose;
      return [
        bounds.x + bounds.width / 2 + (x - center[0]) * scale,
        bounds.y + bounds.height / 2 - (y - center[1]) * scale,
      ] as const;
    },
    {x, y},
  );
}
async function click(page: Page, x: number, y: number) {
  await page.mouse.click(...(await screen(page, x, y)));
}
async function move(page: Page, x: number, y: number) {
  await page.mouse.move(...(await screen(page, x, y)));
}
async function editable(page: Page, name: string) {
  await page.waitForFunction(
    name =>
      !document.querySelector<HTMLButtonElement>(
        `button[aria-label="${name}"]`,
      )!.disabled,
    name,
  );
}

test('line undo restores the previous anchor, permits a replacement segment and redoes source and draft steps', async t => {
  const page = await open(t, empty);
  await selectTool(page, 'Line');
  await click(page, 0, 0);
  await click(page, 20, 0);
  await click(page, 20, 20);
  await point(page, 4).waitFor();
  await page.keyboard.press('Control+z');
  await point(page, 4).waitFor({state: 'detached'});
  await editable(page, 'Line');
  assert.equal(
    await page.locator('.sketch-canvas').getAttribute('data-tool'),
    'Line',
  );
  assert.equal(
    await page.getByRole('textbox', {name: 'Length', exact: true}).isVisible(),
    true,
  );
  assert.equal(await page.locator('.drawing-overlay line.draft').count(), 1);
  await click(page, 36, 16);
  await waitForSource(page, /'point',\s*4,\s*\[36,\s*16\]/);
  await waitForSource(page, /'line',\s*5,\s*\[2,\s*4\]/);
  await page.keyboard.press('Control+z');
  await point(page, 4).waitFor({state: 'detached'});
  await page.keyboard.press('Control+z');
  await point(page, 1).waitFor({state: 'detached'});
  assert.equal(
    await page.getByRole('textbox', {name: 'Length', exact: true}).isVisible(),
    true,
  );
  const undone = await source(page);
  await page.keyboard.press('Control+z');
  assert.equal(
    await page.getByRole('textbox', {name: 'X', exact: true}).isVisible(),
    true,
  );
  assert.equal(
    await source(page),
    undone,
    'undoing the first click does not undo unrelated source',
  );
  await page.keyboard.press('Control+Shift+z');
  assert.equal(
    await page.getByRole('textbox', {name: 'Length', exact: true}).isVisible(),
    true,
  );
  await page.keyboard.press('Control+Shift+z');
  await point(page, 2).waitFor();
  await page.keyboard.press('Control+Shift+z');
  await point(page, 4).waitFor();
  await waitForSource(page, /'line',\s*5,\s*\[2,\s*4\]/);
});

test('arc undo restores center, start, direction and numeric draft, with local steps before source redo', async t => {
  const page = await open(t, empty);
  await selectTool(page, 'Arc');
  await click(page, 0, 0);
  await move(page, 10, 0);
  await page.getByRole('textbox', {name: 'Radius', exact: true}).fill('10');
  await page.keyboard.press('Enter');
  await page.keyboard.press('r');
  await page.getByRole('textbox', {name: 'Sweep', exact: true}).fill('45');
  await page.keyboard.press('Enter');
  await point(page, 3).waitFor();
  await page.keyboard.press('Control+z');
  await point(page, 3).waitFor({state: 'detached'});
  await editable(page, 'Arc');
  assert.equal(
    await page.getByRole('textbox', {name: 'Sweep', exact: true}).inputValue(),
    '45',
  );
  assert.match(await page.locator('.drawing-input-title').innerText(), /CCW/);
  await page.getByRole('textbox', {name: 'Sweep', exact: true}).fill('');
  await click(page, 0, 10);
  await waitForSource(page, /'arc',\s*4,\s*\[1,\s*10,\s*2,\s*3,\s*'ccw'\]/);
  assert.doesNotMatch(await source(page), /'sweep'/);
  await page.keyboard.press('Control+z');
  await point(page, 3).waitFor({state: 'detached'});
  await page.keyboard.press('Control+z');
  assert.equal(
    await page.getByRole('textbox', {name: 'Radius', exact: true}).inputValue(),
    '10',
  );
  await page.keyboard.press('Control+z');
  assert.equal(
    await page.getByRole('textbox', {name: 'X', exact: true}).isVisible(),
    true,
  );
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(
    await page.getByRole('textbox', {name: 'Sweep', exact: true}).isVisible(),
    true,
  );
  await page.keyboard.press('Control+Shift+z');
  await point(page, 3).waitFor();
});

for (const name of ['Circle', 'Rectangle', 'Center rectangle']) {
  test(`${name} resumes its last construction step after undo and abandons checkpoints on cancel`, async t => {
    const page = await open(t, empty);
    await selectTool(page, name);
    await click(page, 0, 0);
    await click(page, 15, 10);
    await point(page, 1).waitFor();
    await page.keyboard.press('Control+z');
    await point(page, 1).waitFor({state: 'detached'});
    await editable(page, name);
    assert.equal(
      await page.locator('.sketch-canvas').getAttribute('data-tool'),
      name,
    );
    assert.equal(
      await page
        .getByRole('textbox', {
          name: name === 'Circle' ? 'Radius' : 'Width',
          exact: true,
        })
        .isVisible(),
      true,
    );
    await click(page, 25, 20);
    await point(page, 1).waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await point(page, 1).waitFor({state: 'detached'});
    assert.equal(await page.locator('.drawing-overlay .draft').count(), 0);
  });
}

test('drawing snaps to intersections and midpoints, preserves endpoint identity and supports Alt bypass', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([
  ['point', 1, [1,11]], ['point', 2, [19,11]], ['line', 3, [1,2]],
  ['point', 4, [7,3]], ['point', 5, [7,23]], ['line', 6, [4,5]],
  ['point', 7, [-10,-6]], ['point', 8, [-2,-6]], ['line', 9, [7,8]],
]);`,
  );
  await selectTool(page, 'Line');
  const [x, y] = await screen(page, 7, 11);
  await page.mouse.move(x + 2, y + 2);
  assert.equal(await page.locator('.snap-label').textContent(), 'Intersection');
  await page.keyboard.down('Alt');
  assert.equal(await page.locator('.snap-label').count(), 0);
  await page.keyboard.up('Alt');
  await page.mouse.click(x + 2, y + 2);
  const [mx, my] = await screen(page, -6, -6);
  await page.mouse.move(mx + 2, my + 2);
  assert.equal(await page.locator('.snap-label').textContent(), 'Midpoint');
  await page.mouse.click(mx + 2, my + 2);
  await waitForSource(page, /'point',\s*10,\s*\[7,\s*11\]/);
  await waitForSource(page, /'point',\s*11,\s*\[-6,\s*-6\]/);
  await point(page, 2).click();
  await waitForSource(page, /'line',\s*13,\s*\[11,\s*2\]/);
});

test('point dragging snaps to a computed intersection and writes coordinates without an alias', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([
  ['point', 1, [1,11]], ['point', 2, [19,11]], ['line', 3, [1,2]],
  ['point', 4, [7,3]], ['point', 5, [7,23]], ['line', 6, [4,5]],
  ['point', 7, [0,0]],
]);`,
  );
  await move(page, 0, 0);
  await page.mouse.down();
  const [x, y] = await screen(page, 7, 11);
  await page.mouse.move(x + 2, y + 2, {steps: 4});
  await page.mouse.up();
  await waitForSource(page, /'point',\s*7,\s*\[7,\s*11\]/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'point',\s*7,\s*\[0,\s*0\]/);
});
