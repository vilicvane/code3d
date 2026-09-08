import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, point, text, waitForSource} from './sketch-test.ts';

async function center(page: Page, id: number) {
  const box = await point(page, id).boundingBox();
  assert.ok(box);
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

async function waitAt(
  page: Page,
  id: number,
  position: {x: number; y: number},
) {
  await page.waitForFunction(
    ({id, x, y}) => {
      const box = document
        .querySelector(`.sketch-canvas circle.local[data-id="${id}"]`)!
        .getBoundingClientRect();
      return (
        Math.hypot(box.x + box.width / 2 - x, box.y + box.height / 2 - y) < 0.1
      );
    },
    {id, ...position},
  );
}

for (const radius of ['free', 'dimension', 'expression'] as const) {
  test(`both arc endpoints retain their center with ${radius} radius through preview, cancellation, source replay and undo`, async t => {
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';
const r = 10;
const s = sketch([
  ['point', 1, [0, 0]], ['point', 2, [10, 0]], ['point', 3, [0, 10]],
  ['arc', 4, [1, ${radius === 'expression' ? 'r /* keep radius */' : '10'}, 2, 3, 'ccw']],
  ['point', 99, [-20, -20]],
]${radius === 'dimension' ? ", {constraints: [['radius', 4, 10]]}" : ''});`,
    );
    await page.getByRole('button', {name: 'Snap', exact: true}).click();
    const original = await text(page);
    const origin = await center(page, 1);
    const scale = ((await center(page, 2)).x - origin.x) / 10;
    for (const id of [2, 3]) {
      const start = await center(page, id);
      const direction = id === 2 ? [0.8, -0.6] : [-0.6, 0.8];
      const destination = {
        x: origin.x + direction[0] * 20 * scale,
        y: origin.y - direction[1] * 20 * scale,
      };
      const reached =
        radius === 'free'
          ? destination
          : {
              x: origin.x + direction[0] * 10 * scale,
              y: origin.y - direction[1] * 10 * scale,
            };
      for (const cancel of [true, false]) {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(destination.x, destination.y, {steps: 8});
        await waitAt(page, id, reached);
        await waitAt(page, 1, origin);
        assert.equal(await text(page), original);
        if (cancel) await page.keyboard.press('Escape');
        await page.mouse.up();
        if (cancel) {
          await waitAt(page, id, start);
          assert.equal(await text(page), original);
        }
      }
      // Chrome quantizes pointer coordinates; check geometry before and after
      // replay rather than requiring a particular decimal spelling in source.
      const originalCoordinates = id === 2 ? '10, 0' : '0, 10';
      await waitForSource(
        page,
        new RegExp(`\\['point', ${id}, \\[(?!${originalCoordinates}\\])`),
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      await waitAt(page, id, reached);
      await waitAt(page, 1, origin);
      const updated = await text(page);
      assert.match(updated, /\['point', 1, \[0, 0\]\]/);
      assert.doesNotMatch(updated, /'fixed'/);
      if (radius === 'expression')
        assert.match(updated, /r \/\* keep radius \*\//);
      if (radius === 'dimension') assert.match(updated, /\['radius', 4, 10\]/);
      await page.keyboard.press('Control+z');
      await waitForSource(
        page,
        new RegExp(`\\['point', ${id}, \\[${originalCoordinates}\\]\\]`),
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      await waitAt(page, id, start);
      await waitAt(page, 1, origin);
      assert.equal(await text(page), original);
    }
  });
}

for (const kind of ['circle', 'arc'] as const) {
  test(`dragging a ${kind} center preserves concentric radii with a fixed endpoint through cancellation, replay and undo`, async t => {
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';
const s = sketch([
  ['point', 1, [0, 0]], ['point', 2, [10, 0]], ['point', 3, [0, 10]],
  ${kind === 'arc' ? "['arc', 4, [1, 10, 2, 3, 'ccw']]" : "['circle', 4, [1, 10]]"},
  ['circle', 5, [1, 3]],
  ['point', 98, [-25, -25]], ['point', 99, [30, 30]],
], {constraints: [['fixed', 2]]});`,
    );
    await page.getByRole('button', {name: 'Snap', exact: true}).click();
    const original = await text(page);
    const start = await center(page, 1),
      fixed = await center(page, 2);
    const scale = (fixed.x - start.x) / 10;
    const destination = {x: start.x + 10 * scale, y: start.y - 20 * scale};
    const reached = {x: start.x + 10 * scale, y: start.y - 10 * scale};
    for (const cancel of [true, false]) {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(destination.x, destination.y, {steps: 8});
      await waitAt(page, 1, reached);
      await waitAt(page, 2, fixed);
      assert.equal(await text(page), original);
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
      if (cancel) {
        await waitAt(page, 1, start);
        assert.equal(await text(page), original);
      }
    }
    await waitForSource(page, /\['point', 1, \[(?!0, 0\])/);
    await page.getByText('Ready', {exact: true}).waitFor();
    await waitAt(page, 1, reached);
    await waitAt(page, 2, fixed);
    const updated = await text(page);
    assert.match(updated, new RegExp(`\\['${kind}', 4, \\[1, 10(?:,|\\])`));
    assert.match(updated, /\['circle', 5, \[1, 3\]\]/);
    assert.match(updated, /\['point', 2, \[10, 0\]\]/);
    assert.match(updated, /constraints:\s*\[\['fixed', 2\]\]/);
    assert.doesNotMatch(updated, /'radius'/);
    await page.keyboard.press('Control+z');
    await waitForSource(page, /\['point', 1, \[0, 0\]\]/);
    await page.getByText('Ready', {exact: true}).waitFor();
    await waitAt(page, 1, start);
    assert.equal(await text(page), original);
  });
}
