import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, point, text, waitForSource} from './sketch-test.ts';

const arc = (page: Page, id = 4) =>
  page.locator(`.sketch-canvas path.local[data-kind="arc"][data-id="${id}"]`);
const source = (direction = 'ccw') =>
  `import {sketch} from '@code3d/core';\nconst width = 0;\nconst value = sketch([['point', 1, [width, 0]], ['point', 2, [10, 0]], ['point', 3, [0, 10]], ['arc', 4, [1, 2, 3, '${direction}']]], {constraints: [['fixed', 1], ['radius', [4, 10]]]});`;

test('arc tool creates center/start/end with numeric radius, reverses the preview, cancels and undoes atomically', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core';\nconst value = sketch([]);",
  );
  await page.getByRole('button', {name: 'Arc', exact: true}).click();
  const box = (await page.locator('.sketch-canvas').boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await page.mouse.move(x + 60, y);
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await page.mouse.move(x, y - 60);
  await page.keyboard.press('r');
  assert.match(
    (await page.locator('.drawing-overlay path.draft').getAttribute('d')) ?? '',
    / 0 1 1 /,
  );
  await page.keyboard.press('Enter');
  await arc(page).waitFor();
  await waitForSource(page, /'arc',\s*4,\s*\[1,\s*2,\s*3,\s*'cw'\]/);
  await waitForSource(page, /'radius',\s*\[4,\s*10\]/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await arc(page).waitFor({state: 'detached'});
  assert.equal(await point(page, 1).count(), 0);
  await page.getByRole('button', {name: 'Arc', exact: true}).click();
  await page.mouse.click(x, y);
  await page.mouse.click(x + 60, y);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sketch-canvas .local').count(), 0);
  assert.doesNotMatch(await text(page), /'arc'/);
});

test('directed arcs render as finite SVG curves, expose radius relations and undo whole-arc deletion', async t => {
  for (const direction of ['cw', 'ccw']) {
    const page = await open(t, source(direction));
    await arc(page).waitFor();
    assert.equal(
      await arc(page).evaluate(e => getComputedStyle(e).fill),
      'none',
    );
    const path = await arc(page).getAttribute('d');
    assert.match(path!, direction === 'cw' ? / 0 1 1 / : / 0 0 0 /);
    const badge = page
      .locator('.constraint-badge')
      .getByText('R10', {exact: true});
    await badge.hover();
    assert.match(
      (await arc(page).getAttribute('class')) ?? '',
      /constraint-related/,
    );
    const spot = await arc(page).evaluate(e => {
      const path = e as SVGPathElement,
        p = path.getPointAtLength(path.getTotalLength() * 0.25);
      const r = path.ownerSVGElement!.getBoundingClientRect();
      return {x: r.x + p.x, y: r.y + p.y};
    });
    await page.mouse.click(spot.x, spot.y);
    assert.match((await arc(page).getAttribute('class')) ?? '', /selected/);
    await page.keyboard.press('Delete');
    await arc(page).waitFor({state: 'detached'});
    assert.equal(await point(page, 1).count(), 0);
    await page.keyboard.press('Control+z');
    await arc(page).waitFor();
    assert.equal(await point(page, 1).count(), 1);
    assert.match(await text(page), new RegExp(`'${direction}'`));
  }
});

test('arc endpoint dragging across a half turn keeps the curve, expression coordinates and replay position', async t => {
  const page = await open(t, source());
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  const c = (await point(page, 1).boundingBox())!,
    s = (await point(page, 2).boundingBox())!,
    e = (await point(page, 3).boundingBox())!;
  const cx = c.x + c.width / 2,
    cy = c.y + c.height / 2,
    radius = s.x - c.x;
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  for (const degrees of [110, 130, 150, 170, 179, 181, 190]) {
    const angle = (degrees * Math.PI) / 180;
    await page.mouse.move(
      cx + radius * Math.cos(angle),
      cy - radius * Math.sin(angle),
      {steps: 3},
    );
  }
  await page.mouse.up();
  await waitForSource(page, /'point',\s*3,\s*\[-/);
  await page.getByText('Ready', {exact: true}).waitFor();
  const end = (await point(page, 3).boundingBox())!;
  assert.ok(
    Math.abs(
      end.x + end.width / 2 - (cx + radius * Math.cos((190 * Math.PI) / 180)),
    ) < 1,
  );
  assert.ok(
    Math.abs(
      end.y + end.height / 2 - (cy - radius * Math.sin((190 * Math.PI) / 180)),
    ) < 1,
  );
  assert.match((await arc(page).getAttribute('d')) ?? '', / 0 1 0 /);
  assert.match(await text(page), /width/);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector('.sketch-canvas circle[data-id="3"]')
          ?.getAttribute('cy'),
      ) <
      Number(
        document
          .querySelector('.sketch-canvas circle[data-id="1"]')
          ?.getAttribute('cy'),
      ),
  );
});
