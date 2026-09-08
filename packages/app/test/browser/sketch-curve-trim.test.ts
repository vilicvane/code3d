import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  open,
  segment,
  clickSegment,
  text,
  waitForSource,
} from './sketch-test.ts';

test('circle crossings delimit one atomic trim of reversed overlapping lines without modifying the circle', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core'; const r = 5; const value = sketch([['point', 1, [-10, 0]], ['point', 2, [10, 0]], ['line', 3, [1, 2]], ['point', 5, [0, 3]], ['circle', 6, [5, r]], ['line', 7, [2, 1]]]);",
  );
  const circle = page.locator(
    '.sketch-canvas circle.local[data-kind="circle"]',
  );
  const radius = await circle.getAttribute('r');
  await segment(page, 3, 0.3, 0.7).waitFor({state: 'attached'});
  await page.getByRole('button', {name: 'Trim', exact: true}).click();
  const bounds = (await segment(page, 3, 0.3, 0.7).boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  assert.equal(
    await page.locator('.sketch-canvas line.trim-preview').count(),
    2,
  );
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await segment(page, 3, 0.3, 0.7).waitFor({state: 'detached'});
  await waitForSource(page, /'point',\s*8,/);
  assert.equal(
    await page.locator('.sketch-canvas line.local[data-kind="line"]').count(),
    4,
  );
  assert.equal(await circle.getAttribute('r'), radius);
  assert.match(await text(page), /'circle',\s*6,\s*\[5,\s*r\]/);
  await page.keyboard.press('Control+z');
  await segment(page, 3, 0.3, 0.7).waitFor({state: 'attached'});
  await segment(page, 7, 0.3, 0.7).waitFor({state: 'attached'});
  assert.equal(await circle.getAttribute('r'), radius);
});

for (const direction of ['cw', 'ccw'])
  test(`finite ${direction} arc crossings trim a line without cutting through the arc gap`, async t => {
    const page = await open(
      t,
      `import {sketch} from '@code3d/core'; const value = sketch([['point', 1, [-10, 0]], ['point', 2, [10, 0]], ['line', 3, [1, 2]], ['point', 4, [0, 3]], ['point', 5, [-5, 3]], ['point', 6, [0, -2]], ['arc', 7, [4, 5, 5, 6, '${direction}']]]);`,
    );
    const cut = direction === 'cw' ? 0.7 : 0.3;
    const right = segment(page, 3, cut, 1);
    await right.waitFor({state: 'attached'});
    assert.equal(
      await page.locator('.sketch-canvas line.local[data-id="3"]').count(),
      2,
    );
    const arc = page.locator('.sketch-canvas path.local[data-kind="arc"]');
    const path = await arc.getAttribute('d');
    await clickSegment(page, right);
    await page.keyboard.press('Delete');
    await right.waitFor({state: 'detached'});
    await waitForSource(page, /'line',\s*3,\s*\[1,\s*8\]/);
    assert.equal(await arc.getAttribute('d'), path);
    assert.equal(
      await page.locator('.sketch-canvas line.local[data-id="3"]').count(),
      1,
    );
    await page.keyboard.press('Control+z');
    await segment(page, 3, cut, 1).waitFor({state: 'attached'});
    assert.equal(await arc.getAttribute('d'), path);
  });

test('a read-only upstream circle delimits local trimming and survives source undo', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core'; const base = sketch([['point', 1, [0, 3]], ['circle', 2, [1, 5]]]); const value = base.derive([['point', 1, [-10, 0]], ['point', 2, [10, 0]], ['line', 3, [1, 2]]]);",
  );
  const upstream = page.locator(
    '.sketch-canvas circle.upstream[data-kind="circle"]',
  );
  await upstream.waitFor();
  await page.getByRole('button', {name: 'Trim', exact: true}).click();
  await clickSegment(page, segment(page, 3, 0.3, 0.7));
  await segment(page, 3, 0.3, 0.7).waitFor({state: 'detached'});
  assert.equal(await upstream.count(), 1);
  await page.keyboard.press('Control+z');
  await segment(page, 3, 0.3, 0.7).waitFor({state: 'attached'});
  assert.equal(await upstream.count(), 1);
});
