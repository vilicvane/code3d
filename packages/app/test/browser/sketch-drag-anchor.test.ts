import assert from 'node:assert/strict';
import {test} from 'node:test';
import {open, point, text, waitForSource} from './sketch-test.ts';

for (const expression of [false, true])
  test(`disconnected ${expression ? 'expression-locked' : 'free'} geometry does not steal the opposite endpoint anchor`, async t => {
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';
const x = -50, y = -40;
const value = sketch([
  ['point', 9, [${expression ? 'x, y' : '-50, -40'}]],
  ['point', 10, [-50, 40]],
  ['line', 11, [9, 10]],
  ['point', 1, [0, 0]],
  ['point', 2, [40, 0]],
  ['line', 3, [1, 2]],
], {constraints: [['length', 3, 40]]});`,
    );
    await point(page, 2).waitFor();
    await page.getByRole('button', {name: 'Snap', exact: true}).click();
    const anchor = (await point(page, 1).boundingBox())!;
    const start = (await point(page, 2).boundingBox())!;
    const unrelated = (await point(page, 9).boundingBox())!;
    const cx = anchor.x + anchor.width / 2,
      cy = anchor.y + anchor.height / 2;
    const radius = start.x - anchor.x;
    await page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await page.mouse.down();
    for (const degrees of [30, 60, 90, 120, 150, 175, 185, 210]) {
      const x = cx + radius * Math.cos((degrees * Math.PI) / 180);
      const y = cy - radius * Math.sin((degrees * Math.PI) / 180);
      await page.mouse.move(x, y, {steps: 3});
      await page.waitForFunction(
        ({x, y}) => {
          const p = document
            .querySelector('.sketch-canvas circle.local[data-id="2"]')!
            .getBoundingClientRect();
          return (
            Math.hypot(p.x + p.width / 2 - x, p.y + p.height / 2 - y) < 0.5
          );
        },
        {x, y},
      );
      const current = (await point(page, 1).boundingBox())!;
      assert.ok(Math.hypot(current.x - anchor.x, current.y - anchor.y) < 0.1);
    }
    const preview = (await point(page, 2).boundingBox())!;
    await page.mouse.up();
    await waitForSource(page, /'point',\s*2,\s*\[-/);
    await page.getByText('Ready', {exact: true}).waitFor();
    for (const [id, expected] of [
      [1, anchor],
      [2, preview],
      [9, unrelated],
    ] as const) {
      const actual = (await point(page, id).boundingBox())!;
      assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 0.1);
    }
    const persisted = (await text(page)).match(
      /'point',\s*1,\s*\[([^,]+),\s*([^\]]+)\]/,
    )!;
    // Soft stays are numerical optima, not bitwise-fixed source parameters.
    assert.ok(Math.hypot(Number(persisted[1]), Number(persisted[2])) < 1e-5);
    if (expression)
      assert.match(await text(page), /'point',\s*9,\s*\[x,\s*y\]/);
    assert.doesNotMatch(await text(page), /'fixed'/);
    await page.keyboard.press('Control+z');
    await waitForSource(page, /'point',\s*2,\s*\[40,\s*0\]/);
    await page.waitForFunction(expected => {
      const p = document
        .querySelector('.sketch-canvas circle.local[data-id="2"]')
        ?.getBoundingClientRect();
      // Selection enlarges the point marker; compare its center, not its bounds.
      return (
        p &&
        Math.hypot(
          p.x + p.width / 2 - expected.x - expected.width / 2,
          p.y + p.height / 2 - expected.y - expected.height / 2,
        ) < 0.1
      );
    }, start);
  });
