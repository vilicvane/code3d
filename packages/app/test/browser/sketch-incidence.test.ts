import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, point, text, waitForSource} from './sketch-test.ts';

async function center(page: Page, id: number, layer = 'local') {
  const box = await point(page, id, layer).boundingBox();
  assert.ok(box);
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}
const near = (a: {x: number; y: number}, b: {x: number; y: number}) =>
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.1);
async function online(page: Page) {
  const [a, b, p] = await Promise.all([1, 2, 4].map(id => center(page, id)));
  const distance =
    Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) /
    Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(distance < 0.1, String(distance));
}
const source = `import {sketch} from '@code3d/core';
const s = sketch([
  ['point', 1, [0, 0]], ['point', 2, [20, 0]], ['line', 3, [1, 2]],
  ['point', 4, [10, 0]],
]);`;

test('an unconstrained line endpoint carries its interior point through Worker preview, source replay, cancellation and undo', async t => {
  const page = await open(t, source);
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  const before = await text(page),
    start = await center(page, 2),
    follower = await center(page, 4);
  for (const cancel of [true, false]) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y - 60, {steps: 8});
    assert.equal(await text(page), before);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    if (cancel) {
      near(await center(page, 2), start);
      near(await center(page, 4), follower);
      assert.equal(await text(page), before);
    }
  }
  await waitForSource(page, /\['point', 2, \[20, (?!0\])/);
  await page.getByText('Ready', {exact: true}).waitFor();
  await online(page);
  near(await center(page, 2), {x: start.x, y: start.y - 60});
  assert.ok((await center(page, 4)).y < follower.y - 10);
  assert.match(await text(page), /\['line', 3, \[1, 2\]\]/);
  assert.doesNotMatch(await text(page), /constraints/);
  await page.keyboard.press('Control+z');
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 2), start);
  near(await center(page, 4), follower);
  assert.equal(await text(page), before);
});

test('a local point slides on a read-only upstream line and stops at its finite end', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const base = sketch([['point', 1, [0, 0]], ['point', 2, [20, 0]], ['line', 3, [1, 2]]]);
const s = base.derive([['point', 4, [10, 0]]]);`,
  );
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  const a = await center(page, 1, 'upstream'),
    b = await center(page, 2, 'upstream');
  const start = await center(page, 4);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + (b.x - start.x) / 2, start.y - 40, {
    steps: 8,
  });
  await page.mouse.up();
  await waitForSource(page, /\['point', 4, \[15, 0\]\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 4), {x: start.x + (b.x - start.x) / 2, y: start.y});
  const middle = await center(page, 4);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y - 40, {steps: 8});
  await page.mouse.up();
  await waitForSource(page, /\['point', 4, \[20, 0\]\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 4), b);
  near(await center(page, 1, 'upstream'), a);
  near(await center(page, 2, 'upstream'), b);
});

test('a point on a fixed circle follows its circumference through a half turn and undoes once', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const s=sketch([['point',1,[0,0]],['circle',2,[1,10]],['point',3,[10,0]]],{constraints:[['fixed',1],['radius',[2,10]]]});`,
  );
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  const origin = await center(page, 1),
    start = await center(page, 3);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(origin.x - (start.x - origin.x) * 1.5, origin.y, {
    steps: 8,
  });
  await page.mouse.up();
  await waitForSource(page, /\['point',3,\[-10,0\]\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 3), {x: 2 * origin.x - start.x, y: origin.y});
  near(await center(page, 1), origin);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /\['point',3,\[10,0\]\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 3), start);
});

test('circle radius and center gestures carry contacting points through recompilation and separate undo steps', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const s=sketch([['point',1,[0,0]],['circle',2,[1,10]],['point',3,[10,0]]]);`,
  );
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  const origin = await center(page, 1),
    start = await center(page, 3);
  const radius = start.x - origin.x;
  await page.mouse.move(origin.x, origin.y + radius);
  await page.mouse.down();
  await page.mouse.move(origin.x, origin.y + radius * 1.5, {steps: 8});
  await page.mouse.up();
  await waitForSource(page, /\['circle',2,\[1,15\]\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  const resized = await center(page, 3);
  near(resized, {x: origin.x + radius * 1.5, y: origin.y});
  near(await center(page, 1), origin);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 40, origin.y - 20, {steps: 8});
  await page.mouse.up();
  await waitForSource(page, /\['point',1,\[(?!0,0)/);
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 3), {x: resized.x + 40, y: resized.y - 20});
  assert.match(await text(page), /\['circle',2,\[1,15\]\]/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /\['point',1,\[0,0\]\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 3), resized);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /\['circle',2,\[1,10\]\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 3), start);
});

test('a point on an upstream arc stays within its finite branch, with cancellation leaving source untouched', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const base=sketch([['point',1,[0,0]],['point',2,[10,0]],['point',3,[0,10]],['arc',4,[1,10,2,3,'ccw']]]);
const s=base.derive([['point',5,[6,8]]]);`,
  );
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  const original = await text(page),
    start = await center(page, 5);
  const origin = await center(page, 1, 'upstream'),
    end = await center(page, 3, 'upstream');
  for (const cancel of [true, false]) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(origin.x - 80, end.y - 40, {steps: 8});
    assert.equal(await text(page), original);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    if (cancel) {
      assert.equal(await text(page), original);
      near(await center(page, 5), start);
    }
  }
  await waitForSource(page, /\['point',5,\[0,10\]\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  near(await center(page, 5), end);
  near(await center(page, 1, 'upstream'), origin);
  assert.match(await text(page), /\['arc',4,\[1,10,2,3,'ccw'\]\]/);
});
