import assert from 'node:assert/strict';
import {test} from 'node:test';
import {open, point, text, waitForSource} from './sketch-test.ts';

test('a related sketch shows read-only context, edits local data and undoes without losing the relation', async t => {
  const source = `import {sketch, rectangle} from '@code3d/core';
const host = rectangle(40, 30).rotate(0, 0, 90).originOffset(-15, 0, 0);
const profile = sketch([['point', 1, [0, 0]], ['point', 2, [10, 0]], ['line', 3, [1, 2]]]);
const placed = profile.relate(s => s.plane.align(host.plane));
placed;`;
  const page = await open(t, source);
  await page.getByText('Ready', {exact: true}).waitFor();
  await page
    .locator('.sketch-context-edge')
    .first()
    .waitFor({state: 'attached'});
  const appearance = await page
    .locator('.sketch-context-edge')
    .first()
    .evaluate(e => ({
      width: getComputedStyle(e).strokeWidth,
      pointer: getComputedStyle(e).pointerEvents,
    }));
  assert.deepEqual(appearance, {width: '1px', pointer: 'none'});
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  const p1 = (await point(page, 1).boundingBox())!;
  const p2 = (await point(page, 2).boundingBox())!;
  const unit = (p2.x - p1.x) / 10;
  await page.mouse.move(p2.x + p2.width / 2, p2.y + p2.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    p2.x + p2.width / 2 + unit * 2,
    p2.y + p2.height / 2 - unit * 3,
    {steps: 8},
  );
  await page.mouse.up();
  await waitForSource(page, /'point',\s*2,\s*\[12[.,]/);
  const position = (await text(page)).match(
    /'point',\s*2,\s*\[([^,]+),\s*([^\]]+)\]/,
  )!;
  // SVG screen coordinates are fractional; snapping is disabled for this drag.
  assert.ok(Math.abs(Number(position[1]) - 12) < 1e-4);
  assert.ok(Math.abs(Number(position[2]) - 3) < 1e-4);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.match(
    await text(page),
    /profile\.relate\(s => s\.plane\.align\(host\.plane\)\)/,
  );
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'point',\s*2,\s*\[10,\s*0\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.ok(await page.locator('.sketch-context-edge').count());
});

test('empty related sketches can draw without an array and keep the host relation', async t => {
  const page = await open(
    t,
    `import {sketch, rectangle} from '@code3d/core';
const host = rectangle(40, 30).originOffset(0, -10, 0);
const profile = sketch().relate(s => s.plane.align(host.plane));
profile;`,
  );
  await page
    .locator('.sketch-context-edge')
    .first()
    .waitFor({state: 'attached'});
  const box = (await page.locator('.sketch-canvas').boundingBox())!;
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'line'/);
  await page.keyboard.press('Escape');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.match(await text(page), /'length',\s*3,\s*10/);
  assert.match(
    await text(page),
    /\.relate\(s => s\.plane\.align\(host\.plane\)\)/,
  );
  assert.equal(await point(page, 1).count(), 1);
  assert.equal(await point(page, 2).count(), 1);
});
