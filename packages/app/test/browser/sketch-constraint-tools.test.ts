import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {open, point, text, waitForSource} from './sketch-test.ts';

const lines = `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['point',2,[20,0]],['point',3,[0,10]],['point',4,[20,10]],['line',5,[1,2]],['line',6,[3,4]]]);`;
const toolbar = (page: Page) =>
  page.getByRole('toolbar', {name: 'Selection constraints'});
const names = (page: Page) =>
  toolbar(page)
    .getByRole('button')
    .evaluateAll(buttons =>
      buttons.map(button => button.getAttribute('aria-label')),
    );
const line = (page: Page, id: number) =>
  page.locator(`.sketch-canvas line.local[data-id="${id}"]`);
async function click(page: Page, target: Locator, shift = false) {
  const r = (await target.boundingBox())!;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  if (shift) await page.keyboard.up('Shift');
}

test('point and line selection expose applicable tools, Shift toggles and blank or Escape clears them', async t => {
  const page = await open(t, lines);
  const original = await text(page);
  assert.equal(await toolbar(page).isVisible(), false);
  await point(page, 1).click();
  assert.deepEqual(await names(page), [
    'Fixed',
    'X coordinate',
    'Y coordinate',
  ]);
  await click(page, point(page, 3), true);
  assert.deepEqual(await names(page), [
    'Fixed',
    'X coordinate',
    'Y coordinate',
    'Coincident',
  ]);
  assert.equal(await page.locator('.sketch-canvas circle.selected').count(), 2);
  await click(page, point(page, 3), true);
  assert.deepEqual(await names(page), [
    'Fixed',
    'X coordinate',
    'Y coordinate',
  ]);
  await click(page, line(page, 5));
  assert.deepEqual(await names(page), [
    'Horizontal',
    'Vertical',
    'Length',
    'Orientation',
  ]);
  await click(page, line(page, 6), true);
  assert.equal(await page.locator('.sketch-canvas line.selected').count(), 2);
  assert.equal(await text(page), original);
  await page.keyboard.press('Escape');
  assert.equal(await toolbar(page).isVisible(), false);
  await point(page, 1).click();
  await page.locator('.sketch-canvas').click({position: {x: 30, y: 150}});
  assert.equal(await toolbar(page).isVisible(), false);
  assert.equal(await text(page), original);
});

test('selected lines batch constraints once, toggle them off and undo either edit', async t => {
  const page = await open(t, lines);
  const original = await text(page);
  await click(page, line(page, 5));
  await click(page, line(page, 6), true);
  await toolbar(page)
    .getByRole('button', {name: 'Horizontal', exact: true})
    .click();
  await waitForSource(page, /'horizontal',\s*6/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.match(await text(page), /'horizontal',\s*5/);
  assert.equal(
    await page.locator('.constraint-badge[data-kind="horizontal"]').count(),
    2,
  );
  assert.equal(
    await toolbar(page)
      .getByRole('button', {name: 'Horizontal', exact: true})
      .isDisabled(),
    false,
  );
  const horizontal = toolbar(page).getByRole('button', {
    name: 'Horizontal',
    exact: true,
  });
  assert.equal(await horizontal.getAttribute('aria-pressed'), 'true');
  await horizontal.click();
  await page
    .locator('.constraint-badge[data-kind="horizontal"]')
    .first()
    .waitFor({state: 'detached'});
  assert.doesNotMatch(await text(page), /'horizontal'/);
  assert.equal(await horizontal.getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'horizontal',\s*6/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /\[3,\s*4\]\]\]\)/);
  assert.equal(await text(page), original);
});

test('mixed selections remove existing constraints without filling the selected group', async t => {
  const page = await open(
    t,
    lines.replace(']]);', "]], {constraints:[['horizontal',5]]});"),
  );
  await click(page, line(page, 5));
  await click(page, line(page, 6), true);
  const horizontal = toolbar(page).getByRole('button', {
    name: 'Horizontal',
    exact: true,
  });
  assert.equal(await horizontal.getAttribute('aria-pressed'), 'mixed');
  await horizontal.click();
  await page
    .locator('.constraint-badge[data-kind="horizontal"]')
    .first()
    .waitFor({state: 'detached'});
  assert.doesNotMatch(await text(page), /'horizontal'/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'horizontal',\s*5/);
  assert.doesNotMatch(await text(page), /'horizontal',\s*6/);
});

test('Fixed captures a solved point position instead of returning to its source seed', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]]], {constraints: [['x',1,25]]});`,
  );
  const original = await text(page);
  const before = (await point(page, 1).boundingBox())!;
  await point(page, 1).click();
  await toolbar(page).getByRole('button', {name: 'Fixed', exact: true}).click();
  await waitForSource(page, /'fixed',\s*1/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.match(await text(page), /'point',\s*1,\s*\[25,\s*0\]/);
  assert.deepEqual(await point(page, 1).boundingBox(), before);
  assert.equal(
    await toolbar(page)
      .getByRole('button', {name: 'Fixed', exact: true})
      .isDisabled(),
    false,
  );
  const fixed = toolbar(page).getByRole('button', {name: 'Fixed', exact: true});
  await fixed.click();
  await page
    .locator('.constraint-badge[data-kind="fixed"]')
    .waitFor({state: 'detached'});
  assert.deepEqual(await point(page, 1).boundingBox(), before);
  assert.doesNotMatch(await text(page), /'fixed'/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'fixed',\s*1/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'point',\s*1,\s*\[0,\s*0\]/);
  assert.equal(await text(page), original);
});

test('point plus line selection adds a midpoint relation and replays the solved geometry', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['point',2,[20,0]],['point',7,[5,10]],['line',3,[1,2]]]);`,
  );
  await point(page, 7).click();
  await click(page, line(page, 3), true);
  assert.deepEqual(await names(page), ['Midpoint']);
  await toolbar(page)
    .getByRole('button', {name: 'Midpoint', exact: true})
    .click();
  await waitForSource(page, /'midpoint',\s*\[7,\s*1,\s*2\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  const bounds = await Promise.all(
    [1, 2, 7].map(id => point(page, id).boundingBox()),
  );
  for (const axis of ['x', 'y'] as const)
    assert.ok(
      Math.abs(bounds[2]![axis] - (bounds[0]![axis] + bounds[1]![axis]) / 2) <
        0.1,
    );
});

test('a named upstream point can constrain a local point without rewriting upstream data', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const base = sketch([['point',1,[0,0]]]);
const value = base.derive([['point',1,[20,10]]]);`,
  );
  await point(page, 1).click();
  await click(page, point(page, 1, 'upstream'), true);
  await toolbar(page)
    .getByRole('button', {name: 'Coincident', exact: true})
    .click();
  await waitForSource(page, /'coincident',\s*\[1,\s*base.point\(1\)\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.deepEqual(
    await point(page, 1).boundingBox(),
    await point(page, 1, 'upstream').boundingBox(),
  );
  assert.match(
    await text(page),
    /const base = sketch\(\[\['point',\s*1,\s*\[0,\s*0\]\]\]\)/,
  );
});

test('constraint numeric input validates, cancels without writes, preserves native undo, and applies one source edit', async t => {
  const page = await open(t, lines);
  const original = await text(page);
  await click(page, line(page, 5));
  await toolbar(page)
    .getByRole('button', {name: 'Length', exact: true})
    .click();
  const form = page.getByRole('form', {name: 'Constraint value'});
  const input = form.getByRole('textbox', {name: 'Length', exact: true});
  await input.fill('-1');
  await page.keyboard.press('Enter');
  await form
    .getByRole('alert')
    .getByText('Length must be greater than zero', {exact: true})
    .waitFor();
  assert.equal(await text(page), original);
  await page.keyboard.press('Escape');
  assert.equal(await form.count(), 0);
  assert.equal(await toolbar(page).isVisible(), true);
  await toolbar(page)
    .getByRole('button', {name: 'Length', exact: true})
    .click();
  await page.keyboard.type('30');
  await page.keyboard.press('Control+z');
  assert.equal(await input.inputValue(), '');
  assert.equal(await text(page), original);
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'length',\s*5,\s*30/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(
    await page.locator('.constraint-badge[data-kind="length"]').count(),
    1,
  );
  const bounds = await Promise.all(
    [1, 2].map(id => point(page, id).boundingBox()),
  );
  const length = toolbar(page).getByRole('button', {
    name: 'Length',
    exact: true,
  });
  assert.equal(await length.getAttribute('aria-pressed'), 'true');
  await length.click();
  await page
    .locator('.constraint-badge[data-kind="length"]')
    .waitFor({state: 'detached'});
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await form.count(), 0);
  assert.deepEqual(
    await Promise.all([1, 2].map(id => point(page, id).boundingBox())),
    bounds,
  );
  assert.doesNotMatch(await text(page), /'length'/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'length',\s*5,\s*30/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /\[3,\s*4\]\]\]\)/);
  assert.equal(await text(page), original);
});

test('circle and arc selection expose their own dimensions, not line constraints', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['point',2,[10,0]],['point',3,[0,10]],['arc',4,[1,10,2,3,'ccw']],['circle',5,[1,5]]]);`,
  );
  const circle = page.locator('.sketch-canvas circle[data-kind="circle"]');
  const r = (await circle.boundingBox())!;
  await page.mouse.click(r.x + r.width / 2, r.y);
  assert.deepEqual(await names(page), ['Radius']);
  const arc = page.locator('.sketch-canvas path[data-kind="arc"]');
  const bounds = (await arc.boundingBox())!;
  const cx = bounds.x,
    cy = bounds.y + bounds.height;
  await page.mouse.click(
    cx + bounds.width / Math.SQRT2,
    cy - bounds.height / Math.SQRT2,
  );
  assert.deepEqual(await names(page), ['Radius', 'Sweep']);
  await toolbar(page).getByRole('button', {name: 'Sweep', exact: true}).click();
  await page
    .getByRole('form', {name: 'Constraint value'})
    .getByRole('textbox')
    .fill('60');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'sweep',\s*4,\s*60/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(
    await page.locator('.constraint-badge[data-kind="sweep"]').count(),
    1,
  );
});

test('multi-selection Delete removes the chosen intervals atomically and preserves unselected line portions', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['point',2,[40,0]],['point',3,[10,0]],['point',4,[20,0]],['point',5,[30,0]],['line',6,[1,2]]]);`,
  );
  const original = await text(page);
  await click(
    page,
    page.locator('.sketch-canvas line[data-id="6"][data-start="0.25"]'),
  );
  await click(
    page,
    page.locator('.sketch-canvas line[data-id="6"][data-start="0.75"]'),
    true,
  );
  await page.keyboard.press('Delete');
  await waitForSource(page, /'line',\s*7/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 2);
  assert.doesNotMatch(await text(page), /'line',\s*6/);
  assert.doesNotMatch(await text(page), /'point',\s*2/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'line',\s*6/);
  assert.equal(await text(page), original);
});
