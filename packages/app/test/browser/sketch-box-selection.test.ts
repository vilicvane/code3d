import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, point, text, waitForSource} from './sketch-test.ts';

const source = `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['point',2,[20,0]],['point',3,[0,10]],['point',4,[20,10]],['line',5,[1,2]],['line',6,[3,4]]]);`;
const selectedLines = (page: Page) =>
  page
    .locator('.sketch-canvas line.selected')
    .evaluateAll(lines =>
      lines.map(l => Number((l as SVGElement).dataset.id)).sort(),
    );
const tools = (page: Page) =>
  page.getByRole('toolbar', {name: 'Selection constraints'});

async function project(page: Page) {
  const a = (await point(page, 1).boundingBox())!;
  const b = (await point(page, 2).boundingBox())!;
  const scale = (b.x - a.x) / 20;
  return (x: number, y: number): [number, number] => [
    a.x + a.width / 2 + x * scale,
    a.y + a.height / 2 - y * scale,
  ];
}
async function box(
  page: Page,
  a: [number, number],
  b: [number, number],
  release = true,
) {
  const screen = await project(page);
  await page.mouse.move(...screen(...a));
  await page.mouse.down();
  await page.mouse.move(...screen(...b), {steps: 4});
  if (release) await page.mouse.up();
}

test('plain clicks replace, Ctrl toggles, Shift only adds, and modifier clicks never drag geometry', async t => {
  const page = await open(t, source);
  const original = await text(page);
  const selected = () =>
    page
      .locator('.sketch-canvas circle.selected')
      .evaluateAll(points =>
        points.map(p => Number((p as SVGElement).dataset.id)).sort(),
      );
  await point(page, 1).click();
  await page.keyboard.down('Shift');
  await point(page, 2).click();
  await point(page, 1).click();
  assert.deepEqual(await selected(), [1, 2]);
  await page.keyboard.up('Shift');
  await page.keyboard.down('Control');
  await point(page, 1).click();
  await point(page, 3).click();
  assert.deepEqual(await selected(), [2, 3]);
  await page.keyboard.up('Control');
  await point(page, 4).click();
  assert.deepEqual(await selected(), [4]);
  for (const key of ['Shift', 'Control']) {
    await page.keyboard.down(key);
    await page.locator('.sketch-canvas').click({position: {x: 30, y: 150}});
    assert.deepEqual(await selected(), [4]);
    await page.keyboard.up(key);
  }
  const r = (await point(page, 4).boundingBox())!;
  await page.keyboard.down('Control');
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 10, r.y + r.height / 2 + 10);
  await page.mouse.up();
  await page.keyboard.up('Control');
  assert.deepEqual(await selected(), []);
  assert.deepEqual(await point(page, 4).boundingBox(), r);
  assert.equal(await text(page), original);
});

test('Ctrl crossing boxes toggle relative to the original set on every frame and Escape works while Ctrl is held', async t => {
  const page = await open(t, source);
  const original = await text(page);
  await box(page, [15, -2], [5, 2]);
  assert.deepEqual(await selectedLines(page), [5]);
  await page.keyboard.down('Control');
  await box(page, [15, -2], [5, 12], false);
  assert.deepEqual(await selectedLines(page), [6]);
  const screen = await project(page);
  await page.mouse.move(...screen(6, 11));
  assert.deepEqual(await selectedLines(page), [6]);
  await page.mouse.move(...screen(5, 2));
  assert.deepEqual(await selectedLines(page), []);
  await page.mouse.move(...screen(5, 12));
  assert.deepEqual(await selectedLines(page), [6]);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.keyboard.up('Control');
  assert.deepEqual(await selectedLines(page), [5]);
  await page.keyboard.down('Shift');
  await box(page, [15, -2], [5, 12]);
  await page.keyboard.up('Shift');
  assert.deepEqual(await selectedLines(page), [5, 6]);
  await page.keyboard.down('Control');
  await box(page, [15, -2], [5, 2]);
  assert.deepEqual(await selectedLines(page), [6]);
  await page.keyboard.up('Control');
  assert.equal(await text(page), original);
});

test('window and crossing box selection preserve source, Shift adds and Escape restores the previous selection', async t => {
  const page = await open(t, source);
  const original = await text(page);
  await box(page, [5, -2], [15, 2]);
  assert.deepEqual(await selectedLines(page), []);
  await box(page, [15, -2], [5, 2], false);
  assert.equal(
    await page.locator('.sketch-selection-box.crossing').isVisible(),
    true,
  );
  assert.deepEqual(await selectedLines(page), [5]);
  await page.mouse.up();
  await page.keyboard.down('Shift');
  await box(page, [15, 8], [5, 12]);
  await page.keyboard.up('Shift');
  assert.deepEqual(await selectedLines(page), [5, 6]);
  await box(page, [5, -2], [15, 2], false);
  assert.deepEqual(await selectedLines(page), []);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await selectedLines(page), [5, 6]);
  assert.equal(await page.locator('.sketch-selection-box').isVisible(), false);
  assert.equal(await text(page), original);
  await box(page, [-2, -2], [22, 12]);
  assert.deepEqual(await selectedLines(page), [5, 6]);
  assert.equal(await page.locator('.sketch-canvas circle.selected').count(), 4);
  assert.equal(await tools(page).isVisible(), false);
  await page.keyboard.press('Escape');
  assert.deepEqual(await selectedLines(page), []);
});

test('box-selected mixed points and lines remove existing dimension and direction constraints with one undo', async t => {
  const page = await open(
    t,
    source.replace(
      ']]);',
      "]], {constraints:[['horizontal',5],['length',6,20],['fixed',1]]});",
    ),
  );
  const original = await text(page);
  const screen = await project(page);
  await page.mouse.click(...screen(7, 10));
  const length = tools(page).getByRole('button', {name: 'Length', exact: true});
  const appearance = () =>
    length.evaluate(button => {
      const style = getComputedStyle(button);
      return {
        color: style.color,
        background: style.backgroundColor,
        borderColor: style.borderColor,
        borderStyle: style.borderStyle,
        shadow: style.boxShadow,
        width: style.width,
        height: style.height,
      };
    });
  assert.equal(await length.getAttribute('aria-pressed'), 'true');
  const fullyMatched = await appearance();
  assert.equal(fullyMatched.borderStyle, 'solid');
  assert.equal(fullyMatched.shadow, 'none');
  await box(page, [-2, -2], [22, 12]);
  assert.equal(
    await tools(page)
      .getByRole('button', {name: 'Vertical', exact: true})
      .count(),
    0,
  );
  assert.equal(await length.getAttribute('aria-pressed'), 'mixed');
  assert.deepEqual(await appearance(), {
    ...fullyMatched,
    borderStyle: 'dashed',
  });
  await length.click();
  await page
    .locator('.constraint-badge[data-kind="length"]')
    .waitFor({state: 'detached'});
  assert.equal(
    await page.getByRole('region', {name: 'Constraint value'}).isVisible(),
    false,
  );
  assert.doesNotMatch(await text(page), /'length'/);
  assert.match(await text(page), /'horizontal'/);
  assert.match(await text(page), /'fixed'/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'length',\s*6,\s*20/);
  assert.equal(await text(page), original);
});

test('removing a relation from one target highlights the unselected partner and leaves its geometry in place', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value=sketch([['point',1,[0,0]],['point',2,[20,0]],['point',3,[10,0]]],{constraints:[['midpoint',[3,1,2]]]});`,
  );
  await point(page, 1).click();
  const midpoint = tools(page).getByRole('button', {
    name: 'Midpoint',
    exact: true,
  });
  await midpoint.hover();
  assert.equal(
    await page.locator('.sketch-canvas circle.constraint-related').count(),
    3,
  );
  assert.equal(await page.locator('.sketch-canvas circle.selected').count(), 1);
  const before = await point(page, 2).boundingBox();
  await midpoint.click();
  await page
    .locator('.constraint-badge[data-kind="midpoint"]')
    .waitFor({state: 'detached'});
  assert.deepEqual(await point(page, 2).boundingBox(), before);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'midpoint'/);
});
