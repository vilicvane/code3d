import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from './browser-connection.ts';
import {
  open,
  segment,
  clickSegment,
  selectTool,
  waitForSource,
} from './sketch-test.ts';

const construction = (page: Page) =>
  page.getByRole('button', {name: 'Construction', exact: true});
const source = (page: Page) =>
  page.evaluate(() => window.sketchTestEditor.getModel()!.getValue());

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
async function click(page: Page, x: number, y: number, add = false) {
  if (add) await page.keyboard.down('Shift');
  await page.mouse.click(...(await screen(page, x, y)));
  if (add) await page.keyboard.up('Shift');
}

test('a selected diagonal becomes dashed reference geometry, restores the unique region and supports undo/redo', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([
  ['point',1,[0,0]],['point',2,[20,0]],['point',3,[20,20]],['point',4,[0,20]],
  ['line',5,[1,2]],['line',6,[2,3]],['line',7,[3,4]],['line',8,[4,1]],['line',9,[1,3]],
]);`,
  );
  assert.equal(await construction(page).isDisabled(), true);
  assert.equal(await page.locator('.sketch-region').count(), 2);
  await clickSegment(page, segment(page, 9, 0, 1));
  await construction(page).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.sketch-region').length === 1,
  );
  const diagonal = segment(page, 9, 0, 1);
  assert.match((await diagonal.getAttribute('class'))!, /construction/);
  assert.equal(
    await diagonal.evaluate(
      element => getComputedStyle(element).strokeDasharray,
    ),
    '6px, 4px',
  );
  assert.equal(await construction(page).getAttribute('aria-pressed'), 'true');
  await waitForSource(page, /aux:line/);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    () => document.querySelectorAll('.sketch-region').length === 2,
  );
  assert.doesNotMatch(await source(page), /aux:/);
  await page.keyboard.press('Control+y');
  await page.waitForFunction(
    () => document.querySelectorAll('.sketch-region').length === 1,
  );
  await clickSegment(page, diagonal);
  await construction(page).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.sketch-region').length === 2,
  );
  await waitForSource(page, /'line',\s*9/);
});

test('mixed curve selections toggle together and construction circles and arcs remain snap targets', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([
  ['point',1,[0,0]],['aux:circle',2,[1,10]],
  ['point',3,[30,0]],['point',4,[40,0]],['point',5,[30,10]],['arc',6,[3,10,4,5,'ccw']],
]);`,
  );
  await click(page, -10, 0);
  await click(page, 30 + Math.sqrt(50), Math.sqrt(50), true);
  assert.equal(await construction(page).getAttribute('aria-pressed'), 'mixed');
  await construction(page).click();
  assert.equal(await construction(page).getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.sketch-canvas [data-kind="arc"]')].every(
      node => node.classList.contains('construction'),
    ),
  );
  assert.equal((await source(page)).match(/aux:/g)?.length, 2);
  assert.equal(await page.locator('.sketch-region').count(), 0);
  await selectTool(page, 'Line');
  await page.mouse.move(...(await screen(page, -9.95, 0.05)));
  assert.equal(await page.locator('.snap-label').textContent(), 'Quadrant');
  await click(page, -10, 0);
  await page.mouse.move(
    ...(await screen(page, 30 + Math.sqrt(50), Math.sqrt(50))),
  );
  assert.equal(await page.locator('.snap-label').textContent(), 'Midpoint');
});

test('trimming a construction line keeps its surviving pieces auxiliary and one undo restores it', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['point',2,[30,0]],['point',3,[10,0]],['point',4,[20,0]],['aux:line',5,[1,2]]]);`,
  );
  await clickSegment(page, segment(page, 5, 1 / 3, 2 / 3));
  await page.keyboard.press('Delete');
  await segment(page, 5, 1 / 3, 2 / 3).waitFor({state: 'detached'});
  assert.equal(
    await page.locator('.sketch-canvas line.local.construction').count(),
    2,
  );
  assert.equal((await source(page)).match(/aux:/g)?.length, 2);
  await page.keyboard.press('Control+z');
  await segment(page, 5, 1 / 3, 2 / 3).waitFor({state: 'attached'});
  assert.equal((await source(page)).match(/aux:/g)?.length, 1);
});

test('upstream and computed roles cannot be changed through the construction toggle', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const type = 'aux:line' as const;
const base = sketch([['point',1,[0,0]],['point',2,[20,0]],['aux:line',3,[1,2]]]);
const value = base.derive([['point',1,[0,10]],['point',2,[20,10]],[type,3,[1,2]]]);`,
  );
  const original = await source(page);
  await click(page, 10, 0);
  assert.equal(await construction(page).isDisabled(), true);
  await click(page, 10, 10);
  assert.equal(await construction(page).isDisabled(), true);
  assert.equal(await source(page), original);
  assert.equal(
    await page.locator('.sketch-canvas line.construction').count(),
    2,
  );
});

test('the reported arc with an auxiliary radius and a tiny open tail previews one closed face', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([
 ['point',1,[0,0]], ['arc',2,[1,10,15,10,'cw']], ['aux:line',4,[1,10]],
 ['point',6,[0.0033782497,9.99999942867]], ['line',8,[6,11]],
 ['point',10,[-7.07106781204,7.0710678113]], ['point',11,[-4.1421361947,9.99999942867]], ['line',12,[10,11]],
 ['point',13,[0.0033782497,-10]], ['line',14,[6,13]], ['point',15,[0.0033782497,-9.99999942937]],
], {constraints: [['fixed',1],['radius',2,10],['angle',4,135],['horizontal',8],['perpendicular',[4,12]]]});`,
  );
  await page.waitForFunction(
    () => document.querySelectorAll('.sketch-region').length === 1,
  );
  assert.equal(await page.locator('.sketch-region').count(), 1);
  await page.screenshot({path: '/tmp/code3d-244-arc-region.png'});
});

for (const kind of ['circle', 'arc'])
  test(`auxiliary ${kind} radius editing keeps the prefix and undoes in one step`, async t => {
    const curve =
      kind === 'circle'
        ? "['aux:circle',2,[1,10]]"
        : "['aux:arc',2,[1,10,3,4,'ccw']]";
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['point',3,[10,0]],['point',4,[0,10]],${curve}], {constraints: [['fixed',1],['radius',2,10]]});`,
    );
    const original = await source(page);
    await page.locator('.constraint-badge[data-kind="radius"]').click();
    await page.getByRole('textbox', {name: 'Radius', exact: true}).fill('20');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const {sketchEditor, previewState} = window.sketchTestRuntime;
      const curve = [...previewState.module!.sketches.values()]
        .at(-1)!
        .entities.find(e => e.id === 2)!;
      return (
        !sketchEditor.isStale &&
        (curve.kind === 'circle' || curve.kind === 'arc') &&
        curve.radius === 20 &&
        curve.construction
      );
    });
    assert.match(await source(page), new RegExp(`aux:${kind}`));
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      () => !window.sketchTestRuntime.sketchEditor.isStale,
    );
    assert.equal(await source(page), original);
  });
