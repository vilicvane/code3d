import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from './browser-connection.ts';
import {open, point, selectTool} from './sketch-test.ts';

const guide = `import {sketch} from '@code3d/core';
const height = 10;
const value = sketch([
  ['point',1,[0,height]],['point',2,[30,height]],['line',3,[1,2]],
  ['point',4,[8,0]],
], {constraints:[['fixed',1],['fixed',2]]});`;
const source = (page: Page) =>
  page.evaluate(() => window.sketchTestEditor.getValue());

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const {previewState, codeEditor, sketchEditor} = window.sketchTestRuntime;
    return (
      !sketchEditor.isStale &&
      previewState.sourceVersion === codeEditor.sourceVersion()
    );
  });
  await page.getByText('Ready', {exact: true}).waitFor();
}

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

async function position(page: Page, id: number) {
  await settled(page);
  return page.evaluate(id => {
    const local = [
      ...window.sketchTestRuntime.previewState.module!.sketches.values(),
    ].at(-1)!;
    const entity = local.entities.find(e => e.kind === 'point' && e.id === id)!;
    if (entity.kind !== 'point') throw new Error('Expected a point');
    return entity.position;
  }, id);
}

async function drag(page: Page, id: number, x: number, y: number) {
  const before = await source(page);
  const box = (await point(page, id).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, x, y)), {steps: 5});
  await page.mouse.up();
  await page.waitForFunction(
    before => window.sketchTestEditor.getValue() !== before,
    before,
  );
  await settled(page);
}

test('drawing onto a curve persists the accepted relation with undo, redo and parameter replay', async t => {
  const page = await open(t, guide);
  const before = await source(page);
  await selectTool(page, 'Line');
  await point(page, 4).click();
  await page.mouse.move(...(await screen(page, 21, 10)));
  assert.match((await page.locator('.snap-label').textContent())!, /On curve/);
  await page.mouse.click(...(await screen(page, 21, 10)));
  await settled(page);
  const after = await source(page);
  assert.match(after, /'pointOn',\s*\[5,\s*3\]/);
  await page.keyboard.press('Control+z');
  await settled(page);
  assert.equal(await source(page), before);
  await page.keyboard.press('Control+y');
  await settled(page);
  assert.equal(await source(page), after);
  const replay = await open(t, after.replace('height = 10', 'height = 18'));
  assert.ok(Math.abs((await position(replay, 5))[1] - 18) < 1e-7);
});

test('a dragged snap is saved, and deleting its marker releases the point on the next drag', async t => {
  const page = await open(t, guide);
  const before = await source(page);
  await drag(page, 4, 21, 10);
  const attached = await source(page);
  assert.match(attached, /'pointOn',\s*\[4,\s*3\]/);
  await page.keyboard.press('Control+z');
  await settled(page);
  assert.equal(await source(page), before);
  await page.keyboard.press('Control+y');
  await settled(page);
  assert.equal(await source(page), attached);
  await page.locator('.constraint-badge[data-kind="pointOn"]').first().click();
  await page
    .getByRole('toolbar', {name: 'Selection constraints'})
    .getByRole('button', {name: 'Point on curve', exact: true})
    .click();
  await settled(page);
  assert.doesNotMatch(await source(page), /'pointOn'/);
  await page.keyboard.down('Alt');
  await drag(page, 4, 21, 2);
  await page.keyboard.up('Alt');
  assert.ok(Math.abs((await position(page, 4))[1] - 2) < 1e-5);
  assert.doesNotMatch(await source(page), /'pointOn'/);
});

test('cancelling a curve snap leaves geometry and relationships untouched', async t => {
  const page = await open(t, guide);
  const before = await source(page);
  const box = (await point(page, 4).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, 21, 10)), {steps: 5});
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settled(page);
  assert.equal(await source(page), before);
  assert.deepEqual(await position(page, 4), [8, 0]);
});

test('pressing Alt before release discards the snap without requiring another pointer movement', async t => {
  const page = await open(t, guide);
  const before = await source(page);
  const box = (await point(page, 4).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, 21, 10)), {steps: 5});
  await page.keyboard.down('Alt');
  await page.locator('.snap-label').waitFor({state: 'hidden'});
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForFunction(
    before => window.sketchTestEditor.getValue() !== before,
    before,
  );
  await settled(page);
  assert.doesNotMatch(await source(page), /'pointOn'/);
  assert.ok(Math.abs((await position(page, 4))[1] - 10) < 1e-5);
});

test('releasing Alt without moving the pointer accepts the current curve snap', async t => {
  const page = await open(t, guide);
  const before = await source(page);
  const box = (await point(page, 4).boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, 21, 10)), {steps: 5});
  await page.locator('.snap-label').waitFor({state: 'hidden'});
  await page.keyboard.up('Alt');
  await page.locator('.snap-label').filter({hasText: 'On curve'}).waitFor();
  await page.mouse.up();
  await page.waitForFunction(
    before => window.sketchTestEditor.getValue() !== before,
    before,
  );
  await settled(page);
  assert.match(await source(page), /'pointOn',\s*\[4,\s*3\]/);
  assert.ok(Math.abs((await position(page, 4))[1] - 10) < 1e-5);
});

test('accepting a tangent while drawing a line persists it through a radius change', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const radius = 10;
const value = sketch([
  ['point',1,[0,0]],['circle',2,[1,10]],['point',3,[20,0]],
], {constraints:[['fixed',1],['fixed',3],['radius',2,radius]]});`,
  );
  await selectTool(page, 'Line');
  await point(page, 3).click();
  await page.mouse.move(...(await screen(page, 5, Math.sqrt(75))));
  assert.match((await page.locator('.snap-label').textContent())!, /Tangent/);
  await page.mouse.click(...(await screen(page, 5, Math.sqrt(75))));
  await settled(page);
  const after = await source(page);
  assert.match(after, /'tangent',\s*\[(?:5,\s*2|2,\s*5)\]/);
  const replay = await open(t, after.replace('radius = 10', 'radius = 12'));
  const [x, y] = await position(replay, 4);
  assert.ok(Math.abs(Math.hypot(x, y) - 12) < 1e-7);
  assert.ok(
    Math.abs(x * (20 - x) - y * y) < 1e-6,
    JSON.stringify({contact: [x, y], start: await position(replay, 3), after}),
  );
});

test('horizontal snap writes a direction constraint while bypassed snapping only places coordinates', async t => {
  for (const bypass of [false, true]) {
    const page = await open(t, guide);
    await selectTool(page, 'Line');
    await point(page, 4).click();
    if (bypass) await page.keyboard.down('Alt');
    await page.mouse.click(...(await screen(page, 20, 0)));
    if (bypass) await page.keyboard.up('Alt');
    await settled(page);
    if (bypass) assert.doesNotMatch(await source(page), /'horizontal'/);
    else assert.match(await source(page), /'horizontal',\s*6/);
  }
});
