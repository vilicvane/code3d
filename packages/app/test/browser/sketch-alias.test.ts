import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, point, text, waitForSource} from './sketch-test.ts';

const center = async (page: Page, id: number, layer = 'local') => {
  const box = (await point(page, id, layer).boundingBox())!;
  assert.ok(box);
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
};
const near = (a: {x: number; y: number}, b: {x: number; y: number}) =>
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.1);
const source = `import {sketch} from '@code3d/core';
const s = sketch([
  ['point', 1, [0, 0]],
  ['point', 2, [20, 0]],
  ['point', 11, [0, 10]],
  ['line', 3, [11, 2]],
]);`;

test('Worker arc endpoint snapping commits alias identity through compilation', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const r = 15;
const s = sketch([
  ['point', 1, [0, 0]], ['point', 2, [-15, 0]], ['point', 3, [0, 15]],
  ['arc', 4, [1, r, 2, 3, 'cw']], ['point', 5, [15, 0]],
]);`,
  );
  const start = await center(page, 3),
    target = await center(page, 5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, {steps: 8});
  await page.mouse.up();
  await waitForSource(page, /\['point', 3, 5\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 3), await center(page, 5));
  assert.match(await text(page), /\[1, r, 2, 3, 'cw'\]/);
});

test('point snapping merges on release only, survives recompilation and undoes once', async t => {
  const page = await open(t, source);
  const before = await text(page);
  const start = await center(page, 11),
    target = await center(page, 1);
  for (const cancel of [true, false]) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, {steps: 5});
    assert.equal(await text(page), before);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    if (cancel) {
      near(await center(page, 11), start);
      assert.equal(await text(page), before);
    }
  }
  await waitForSource(page, /\['point', 11, 1\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 11), await center(page, 1));
  await page.keyboard.press('Control+z');
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 11), start);
  assert.equal(await text(page), before);
});

test('picking an alias edits its owner and upstream aliases remain read-only', async t => {
  const page = await open(
    t,
    source.replace("['point', 11, [0, 10]]", "['point', 11, 1]"),
  );
  const start = await center(page, 11);
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y - 20, {steps: 5});
  await page.mouse.up();
  await waitForSource(page, /\['point', 1, \[(?!0, 0)/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.match(await text(page), /\['point', 11, 1\]/);
  near(await center(page, 11), await center(page, 1));

  const upstream = await open(
    t,
    `import {sketch} from '@code3d/core';
const base = sketch([['point', 1, [0, 0]]]);
const s = base.derive([['point', 11, base.point(1)], ['point', 2, [20, 0]], ['line', 3, [11, 2]]]);`,
  );
  const original = await text(upstream),
    fixed = await center(upstream, 11);
  await upstream.mouse.move(fixed.x, fixed.y);
  await upstream.mouse.down();
  await upstream.mouse.move(fixed.x + 50, fixed.y - 20, {steps: 5});
  await upstream.mouse.up();
  assert.equal(await text(upstream), original);
  near(await center(upstream, 11), fixed);
});

test('Worker arc drag persists exact grid values and leaves the radius expression intact', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const r = 15;
const s = sketch([
  ['point', 1, [0, 0]], ['point', 2, [-15, 0]], ['point', 3, [0, 15]],
  ['arc', 4, [1, r, 2, 3, 'cw']],
]);`,
  );
  const origin = await center(page, 1),
    start = await center(page, 3),
    opposite = await center(page, 2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + origin.x - opposite.x, origin.y, {steps: 8});
  await page.mouse.up();
  await waitForSource(page, /\['point', 3, \[15, 0\]\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.match(await text(page), /\[1, r, 2, 3, 'cw'\]/);
  near(await center(page, 1), origin);
});
