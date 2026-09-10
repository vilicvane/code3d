import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, point, text, waitForSource} from './sketch-test.ts';

const source = `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['point',2,[20,0]],['point',3,[0,15]],['point',4,[20,15]],['line',5,[1,2]],['line',6,[3,4]]]);`;
const toolbar = (page: Page) =>
  page.getByRole('toolbar', {name: 'Selection constraints'});
const button = (page: Page, name: string) =>
  toolbar(page).getByRole('button', {name, exact: true});
async function selectLine(page: Page, id: number, shift = false) {
  const r = (await page
    .locator(`.sketch-canvas line.local[data-id="${id}"]`)
    .boundingBox())!;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(r.x + r.width / 4, r.y + r.height / 4);
  if (shift) await page.keyboard.up('Shift');
}

test('three selected lines add parallel pairs once, expose no two-line tools, and undo the batch', async t => {
  const page = await open(
    t,
    source.replace(
      "['line',6,[3,4]]",
      "['line',6,[3,4]],['point',7,[0,30]],['point',8,[20,30]],['line',9,[7,8]]",
    ),
  );
  const before = await text(page);
  await selectLine(page, 9);
  await selectLine(page, 6, true);
  await selectLine(page, 5, true);
  assert.equal(await button(page, 'Angle between lines').count(), 0);
  assert.equal(await button(page, 'Perpendicular').count(), 0);
  await button(page, 'Parallel').click();
  await waitForSource(page, /'parallel',\s*\[5,\s*9\]/);
  assert.match(await text(page), /'parallel',\s*\[5,\s*6\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  const markers = page.locator('.constraint-badge[data-kind="parallel"]');
  assert.equal(await markers.count(), 4);
  for (const [index, id] of [5, 6, 5, 9].entries())
    await assertBesideLine(page, index, id, 'parallel');
  assert.equal(await page.locator('.constraint-guides > *').count(), 0);
  const key = await markers.first().getAttribute('data-key');
  await markers.first().hover();
  assert.deepEqual(
    await page
      .locator('.constraint-badge.constraint-active')
      .evaluateAll(elements =>
        elements.map(e => (e as SVGElement).dataset.key),
      ),
    [key, key],
  );
  await page.mouse.move(10, 10);
  await markers.nth(3).focus();
  const secondKey = await markers.nth(3).getAttribute('data-key');
  assert.notEqual(secondKey, key);
  assert.deepEqual(
    await page
      .locator('.constraint-badge.constraint-active')
      .evaluateAll(elements =>
        elements.map(e => (e as SVGElement).dataset.key),
      ),
    [secondKey, secondKey],
  );
  await page.keyboard.press('Enter');
  assert.deepEqual(
    await page
      .locator('.sketch-canvas line.selected')
      .evaluateAll(elements =>
        elements.map(e => Number((e as SVGElement).dataset.id)).sort(),
      ),
    [5, 9],
  );
  await page.screenshot({path: '/tmp/code3d-parallel-markers-browser.png'});
  await page.keyboard.press('Control+z');
  await waitForSource(page, /\[7,\s*8\]\]\]\)/);
  assert.equal(await text(page), before);
});

test('disjoint line angle markers share editing and highlighting without replacing orientation', async t => {
  const page = await open(
    t,
    source.replace(']]);', "]], {constraints:[['angle',5,0]]});"),
  );
  const before = await text(page);
  await selectLine(page, 5);
  await selectLine(page, 6, true);
  await button(page, 'Angle between lines').click();
  const input = page.getByRole('textbox', {
    name: 'Angle between lines',
    exact: true,
  });
  await input.fill('120');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'angle',\s*\[5,\s*6\],\s*120/);
  await page.getByText('Ready', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Fit', exact: true}).click();
  const marker = page.locator('.constraint-badge[data-tool="angle"]');
  assert.equal(await marker.count(), 2);
  assert.equal(
    await page.locator('.constraint-badge[data-tool="orientation"]').count(),
    1,
  );
  assert.match(
    (await marker.first().getAttribute('aria-label')) ?? '',
    /line 5 → line 6.*120°/,
  );
  assert.equal(await page.locator('.constraint-guides > *').count(), 0);
  await assertBesideLine(page, 0, 5, 'angle');
  await assertBesideLine(page, 1, 6, 'angle');
  await marker.nth(1).hover();
  assert.equal(
    await page
      .locator('.constraint-badge.constraint-active[data-tool="angle"]')
      .count(),
    2,
  );
  assert.equal(
    await page
      .locator('.constraint-badge.constraint-active[data-tool="orientation"]')
      .count(),
    0,
  );
  await page.screenshot({path: '/tmp/code3d-line-angle-browser.png'});
  await page.keyboard.press('Escape');
  await marker.nth(1).click();
  assert.equal(await page.locator('.sketch-canvas line.selected').count(), 2);
  assert.equal(await input.inputValue(), '120');
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await input.fill('-60');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'angle',\s*\[5,\s*6\],\s*-60/);
  assert.match(await text(page), /'angle',\s*5,\s*0/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'angle',\s*\[5,\s*6\],\s*120/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /constraints:\s*\[\['angle',\s*5,\s*0\]\]/);
  assert.equal(await text(page), before);
});

test('perpendicular can be removed from a mixed subset and highlights its unselected line partner', async t => {
  const page = await open(t, source.replace('[20,15]', '[0,35]'));
  await selectLine(page, 5);
  await selectLine(page, 6, true);
  await button(page, 'Perpendicular').click();
  await waitForSource(page, /'perpendicular',\s*\[5,\s*6\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(
    await page.locator('.constraint-badge[data-kind="perpendicular"]').count(),
    2,
  );
  await assertBesideLine(page, 0, 5, 'perpendicular');
  await assertBesideLine(page, 1, 6, 'perpendicular');
  assert.equal(await page.locator('.constraint-guides > *').count(), 0);
  await selectLine(page, 5);
  await page.keyboard.down('Shift');
  await point(page, 2).click();
  await page.keyboard.up('Shift');
  assert.equal(
    await button(page, 'Perpendicular').getAttribute('aria-pressed'),
    'mixed',
  );
  await button(page, 'Perpendicular').hover();
  assert.equal(
    await page.locator('.sketch-canvas line.constraint-related').count(),
    2,
  );
  await button(page, 'Perpendicular').click();
  await page
    .locator('.constraint-badge[data-kind="perpendicular"]')
    .waitFor({state: 'detached'});
  assert.doesNotMatch(await text(page), /'perpendicular'/);
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'perpendicular',\s*\[5,\s*6\]/);
});

async function assertBesideLine(
  page: Page,
  index: number,
  id: number,
  tool: string,
) {
  const marker = (await page
    .locator(`.constraint-badge[data-tool="${tool}"]`)
    .nth(index)
    .boundingBox())!;
  const endpoints = await page
    .locator(`.sketch-canvas line.local[data-id="${id}"]`)
    .evaluate((e: SVGLineElement) => {
      const matrix = e.getScreenCTM()!;
      return [
        new DOMPoint(e.x1.baseVal.value, e.y1.baseVal.value).matrixTransform(
          matrix,
        ),
        new DOMPoint(e.x2.baseVal.value, e.y2.baseVal.value).matrixTransform(
          matrix,
        ),
      ].map(p => [p.x, p.y]);
    });
  const [a, b] = endpoints;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const x = marker.x + marker.width / 2 - a[0],
    y = marker.y + marker.height / 2 - a[1];
  const length = Math.hypot(dx, dy);
  const clearance =
    Math.abs(x * dy - y * dx) / length -
    (Math.abs(dy) * marker.width + Math.abs(dx) * marker.height) /
      (2 * length) -
    1;
  assert.ok(
    Math.abs(clearance - 8) < 0.2,
    `marker-to-line clearance: ${clearance}`,
  );
  const t = (x * dx + y * dy) / (dx * dx + dy * dy);
  assert.ok(t >= 0 && t <= 1);
}

test('parallel and orientation markers share the same line-side layout as other line constraints', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value=sketch([['point',1,[0,0]],['point',2,[40,0]],['point',3,[40,30]],['point',4,[0,30]],['line',5,[1,2]],['line',6,[2,3]],['line',7,[4,3]],['line',8,[1,4]]],{constraints:[['parallel',[5,7]],['angle',7,0],['vertical',6],['vertical',8],['perpendicular',[5,6]],['length',6,30]]});`,
  );
  await page.getByRole('button', {name: 'Fit', exact: true}).click();
  for (const [index, id, tool] of [
    [0, 5, 'parallel'],
    [1, 7, 'parallel'],
    [0, 7, 'orientation'],
    [0, 6, 'vertical'],
    [1, 8, 'vertical'],
    [0, 6, 'length'],
  ] as const)
    await assertBesideLine(page, index, id, tool);
  const parallel = (await page
    .locator('.constraint-badge[data-tool="parallel"]')
    .nth(1)
    .boundingBox())!;
  const orientation = (await page
    .locator('.constraint-badge[data-tool="orientation"]')
    .boundingBox())!;
  assert.ok(Math.abs(parallel.y - orientation.y) < 0.2);
  assert.ok(Math.abs(orientation.x - parallel.x - parallel.width - 4) < 0.2);
  const line = (await page
    .locator('.sketch-canvas line.local[data-id="7"]')
    .boundingBox())!;
  assert.ok(
    Math.abs(
      (parallel.x + orientation.x + orientation.width) / 2 -
        (line.x + line.width / 2),
    ) < 0.2,
  );
  const vertical = (await page
    .locator('.constraint-badge[data-tool="vertical"]')
    .first()
    .boundingBox())!;
  const length = (await page
    .locator('.constraint-badge[data-tool="length"]')
    .boundingBox())!;
  const upright = (await page
    .locator('.sketch-canvas line.local[data-id="6"]')
    .boundingBox())!;
  assert.ok(Math.abs(vertical.x - length.x) < 0.2);
  assert.ok(Math.abs(length.y - vertical.y - vertical.height - 4) < 0.2);
  assert.ok(
    Math.abs(
      (vertical.y + length.y + length.height) / 2 -
        (upright.y + upright.height / 2),
    ) < 0.2,
  );
  const original = await text(page);
  await page.locator('.constraint-badge[data-tool="parallel"]').nth(1).hover();
  assert.equal(
    await page
      .locator('.constraint-badge.constraint-active[data-tool="parallel"]')
      .count(),
    2,
  );
  assert.equal(
    await page
      .locator('.constraint-badge.constraint-active[data-tool="orientation"]')
      .count(),
    0,
  );
  assert.equal(await text(page), original);
  await page.screenshot({path: '/tmp/code3d-line-side-markers-browser.png'});
});

test('an acute corner badge stays by the shared vertex instead of fitting its rectangle between both lines', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value=sketch([['point',1,[0,0]],['point',2,[40,0]],['point',3,[40,24]],['point',4,[0,24]],['point',9,[30,54]],['line',5,[1,2]],['line',6,[2,3]],['line',7,[4,3]],['line',8,[1,4]],['line',10,[4,9]],['line',11,[9,3]]],{constraints:[['parallel',[5,7]],['angle',7,0],['length',7,40],['vertical',6],['vertical',8],['perpendicular',[5,6]],['angle',[7,10],45]]});`,
  );
  await page.getByRole('button', {name: 'Fit', exact: true}).click();
  const marker = page.locator('.constraint-badge[data-tool="angle"]');
  const vertex = (await point(page, 4).boundingBox())!;
  const bounds = (await marker.boundingBox())!;
  const x = bounds.x - vertex.x - vertex.width / 2;
  const y = bounds.y + bounds.height - vertex.y - vertex.height / 2;
  const distance = Math.hypot(x, y);
  assert.ok(Math.abs(Math.atan2(y, x) + Math.PI / 8) < 0.01);
  assert.ok(distance < 13, `acute corner badge anchor distance: ${distance}`);
  assert.ok(Math.abs(x - 9) < 0.2);
  await page.screenshot({path: '/tmp/code3d-acute-corner-browser.png'});
  await marker.click();
  assert.deepEqual(
    await page
      .locator('.sketch-canvas line.selected')
      .evaluateAll(elements =>
        elements
          .map(e => Number((e as SVGElement).dataset.id))
          .sort((a, b) => a - b),
      ),
    [7, 10],
  );
  const input = page.getByRole('textbox', {
    name: 'Angle between lines',
    exact: true,
  });
  assert.equal(await input.inputValue(), '45');
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Escape');
  await point(page, 4).click();
  assert.equal(
    await point(page, 4).evaluate(el => el.classList.contains('selected')),
    true,
  );
});

for (const kind of ['angle', 'perpendicular'])
  test(`${kind} shared-endpoint marker follows its corner bisector through zoom, pan and drag cancellation`, async t => {
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';
const value=sketch([['point',1,[0,0]],['point',2,[20,0]],['point',3,[0,20]],['point',8,1],['line',5,[1,2]],['line',6,[8,3]]],{constraints:[['${kind}',[5,6]${kind === 'angle' ? ',90' : ''}]]});`,
    );
    const original = await text(page);
    const marker = page.locator(`.constraint-badge[data-tool="${kind}"]`);
    assert.equal(await marker.count(), 1);
    assert.equal(await page.locator('.constraint-guides > *').count(), 0);
    const center = async (id: number) => {
      const r = (await point(page, id).boundingBox())!;
      return [r.x + r.width / 2, r.y + r.height / 2];
    };
    const verify = async () => {
      const vertex = await center(1),
        a = await center(2),
        b = await center(3);
      const r = (await marker.boundingBox())!;
      const dx = Math.max(r.x, Math.min(vertex[0], r.x + r.width)) - vertex[0],
        dy = Math.max(r.y, Math.min(vertex[1], r.y + r.height)) - vertex[1];
      const distance = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const start = Math.atan2(a[1] - vertex[1], a[0] - vertex[0]);
      const end = Math.atan2(b[1] - vertex[1], b[0] - vertex[0]);
      const sweep = Math.atan2(Math.sin(end - start), Math.cos(end - start));
      assert.ok(Math.abs(Math.sin(angle - (start + sweep / 2))) < 0.01);
      assert.ok(Math.cos(angle - (start + sweep / 2)) > 0);
      assert.ok(distance >= 8.8 && distance < 13);
      return distance;
    };
    const initialDistance = await verify();
    const r = (await marker.boundingBox())!;
    const origin = await center(1);
    assert.ok(Math.abs(r.x - origin[0] - 1 - 8) < 0.2);
    assert.ok(Math.abs(origin[1] - r.y - r.height - 1 - 8) < 0.2);
    if (kind === 'perpendicular') assert.ok(Math.abs(r.width - 23) < 0.2);
    const vertex = await center(1);
    await page.mouse.move(vertex[0] + 100, vertex[1] - 50);
    await page.mouse.wheel(0, -200);
    await page.waitForFunction(
      x =>
        Math.abs(
          document
            .querySelector('.sketch-canvas circle.local[data-id="1"]')!
            .getBoundingClientRect().x +
            4 -
            x,
        ) > 1,
      vertex[0],
    );
    assert.ok(Math.abs((await verify()) - initialDistance) < 0.2);
    await page.mouse.down({button: 'right'});
    await page.mouse.move(vertex[0] + 125, vertex[1] - 35);
    await page.mouse.up({button: 'right'});
    assert.ok(Math.abs((await verify()) - initialDistance) < 0.2);
    const moved = await center(1);
    await page.mouse.move(...(moved as [number, number]));
    await page.mouse.down();
    await page.mouse.move(moved[0] + 15, moved[1] + 10, {steps: 3});
    await page.waitForFunction(
      () =>
        document.querySelector('.sketch-editor')?.getAttribute('aria-busy') ===
        'false',
    );
    await verify();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(await text(page), original);
    await marker.click();
    assert.equal(await page.locator('.sketch-canvas line.selected').count(), 2);
    if (kind === 'angle') {
      const input = page.getByRole('textbox', {
        name: 'Angle between lines',
        exact: true,
      });
      assert.equal(await input.inputValue(), '90');
      assert.equal(
        await input.evaluate(el => document.activeElement === el),
        true,
      );
    }
    await page.screenshot({path: `/tmp/code3d-${kind}-corner-browser.png`});
  });
