import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {
  open,
  text,
  waitForSource,
  segment,
  clickSegment,
} from './sketch-test.ts';

async function preview(
  page: Page,
  target: Locator,
  count: number,
): Promise<void> {
  const bounds = await target.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  assert.equal(
    await page.locator('.sketch-canvas line.trim-preview').count(),
    count,
  );
  assert.match(
    await page.locator('.sketch-editor output').innerText(),
    new RegExp(`${count} overlapping segments`),
  );
}

test('Trim and Select + Delete remove reversed duplicates and their orphan points in one undo step', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([
  ['point', 1, [0, 0]], ['point', 2, [40, 0]],
  ['point', 3, [0, 0]], ['point', 4, [40, 0]],
  ['line', 5, [1, 2]], ['line', 6, [4, 3]], ['point', 7, [60, 20]],
], {constraints: [['fixed', 1], ['length', [5, 40]], ['angle', [6, 180]],
  ['coincident', [1, 3]], ['x', [4, 40]], ['y', [7, 20]]]});`,
  );
  for (const mode of ['Trim', 'Select']) {
    await page.getByRole('button', {name: mode, exact: true}).click();
    const before = await text(page);
    const target = segment(page, 5, 0, 1);
    if (mode === 'Trim') await preview(page, target, 2);
    assert.equal(await text(page), before);
    await clickSegment(page, target);
    if (mode === 'Select') {
      assert.equal(
        await page.locator('.sketch-canvas line.selected').count(),
        2,
      );
      assert.match(
        await page.locator('.sketch-editor output').innerText(),
        /2 overlapping segments/,
      );
      assert.equal(await text(page), before);
      await page.keyboard.press('Delete');
    }
    await waitForSource(page, /sketch\(\[\s*\['point',\s*7,/);
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.equal(await page.locator('.sketch-canvas line.local').count(), 0);
    assert.equal(await page.locator('.sketch-canvas circle.local').count(), 1);
    assert.doesNotMatch(
      await text(page),
      /'fixed'|'length'|'angle'|'coincident'|'x'/,
    );
    assert.match(await text(page), /'y',\s*\[7,\s*20\]/);
    await page.keyboard.press('Control+z');
    await segment(page, 5, 0, 1).waitFor({state: 'attached'});
    await waitForSource(page, /'length',\s*\[5,\s*40\]/);
    assert.equal(await page.locator('.sketch-canvas line.local').count(), 2);
    assert.equal(await page.locator('.sketch-canvas circle.local').count(), 5);
    assert.equal(await page.locator('.constraint-badge').count(), 6);
  }
});

test('one overlap Trim shares computed cut points and keeps cutting lines and direction expressions', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const theta = 0;
const value = sketch([
  ['point', 1, [0, 0]], ['point', 2, [40, 0]],
  ['point', 3, [0, 0]], ['point', 4, [40, 0]],
  ['point', 5, [10, -10]], ['point', 6, [10, 10]],
  ['point', 7, [30, -10]], ['point', 8, [30, 10]],
  ['line', 9, [1, 2]], ['line', 10, [4, 3]],
  ['line', 11, [5, 6]], ['line', 12, [7, 8]],
], {constraints: [['angle', [10, theta + 180]], ['length', [9, 40]],
  ['angle', [9, theta]], ['length', [10, 40]]]});`,
  );
  const before = await text(page);
  await page.getByRole('button', {name: 'Trim', exact: true}).click();
  const middle = segment(page, 9, 0.25, 0.75);
  await preview(page, middle, 2);
  assert.equal(await text(page), before);
  await clickSegment(page, middle);
  await waitForSource(page, /'line',\s*18,\s*\[13,\s*3\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 10);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 8);
  const source = await text(page);
  assert.match(source, /'point',\s*13,\s*\[10,\s*0\]/);
  assert.match(source, /'point',\s*15,\s*\[30,\s*0\]/);
  for (const id of [17, 18])
    assert.match(
      source,
      new RegExp(`'angle',\\s*\\[${id},\\s*theta \\+ 180\\]`),
    );
  for (const id of [14, 16])
    assert.match(source, new RegExp(`'angle',\\s*\\[${id},\\s*theta\\]`));
  assert.doesNotMatch(source, /'length'|'line',\s*(9|10),/);
  for (const id of [11, 12])
    assert.equal(
      await page.locator(`.sketch-canvas line.local[data-id="${id}"]`).count(),
      2,
    );
  await page.keyboard.press('Control+z');
  await segment(page, 9, 0.25, 0.75).waitFor({state: 'attached'});
  await waitForSource(page, /'length',\s*\[10,\s*40\]/);
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 8);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 10);
});

test('overlap Trim reuses named upstream boundaries without trimming the coincident upstream line', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const base = sketch([
  ['point', 1, [0, 0]], ['point', 2, [40, 0]],
  ['point', 3, [10, 0]], ['point', 4, [30, 0]], ['line', 5, [1, 2]],
]);
const child = base.derive([
  ['point', 1, [0, 0]], ['point', 2, [40, 0]],
  ['line', 3, [1, 2]], ['line', 4, [2, 1]],
]);`,
  );
  const trim = page.getByRole('button', {name: 'Trim', exact: true});
  await trim.click();
  const middle = segment(page, 3, 0.25, 0.75);
  await preview(page, middle, 2);
  assert.equal(
    await page.locator('.sketch-canvas .upstream.trim-preview').count(),
    0,
  );
  await clickSegment(page, middle);
  await waitForSource(page, /'line',\s*8,\s*\[base\.point\(3\),\s*1\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 2);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 4);
  assert.equal(await page.locator('.sketch-canvas circle.upstream').count(), 4);
  assert.equal(await page.locator('.sketch-canvas line.upstream').count(), 3);
  const after = await text(page);
  assert.match(after, /'line',\s*5,\s*\[1,\s*base\.point\(3\)\]/);
  assert.match(after, /'line',\s*6,\s*\[base\.point\(4\),\s*2\]/);
  assert.match(after, /'line',\s*7,\s*\[2,\s*base\.point\(4\)\]/);
  await clickSegment(page, segment(page, 5, 0.25, 0.75, 'upstream'));
  assert.equal(await page.locator('.sketch-canvas .trim-preview').count(), 0);
  assert.equal(await text(page), after);
  await page.keyboard.press('Control+z');
  await segment(page, 3, 0.25, 0.75).waitFor({state: 'attached'});
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 6);
  assert.equal(await page.locator('.sketch-canvas line.upstream').count(), 3);
});

test('an uneditable constraint on a later overlapping line rejects the whole Trim without partial edits', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const hidden = [6, 180] as const;
const value = sketch([
  ['point', 1, [0, 0]], ['point', 2, [40, 0]],
  ['point', 3, [10, 0]], ['point', 4, [30, 0]],
  ['line', 5, [1, 2]], ['line', 6, [2, 1]],
], {constraints: [['angle', [5, 0]], ['angle', hidden]]});`,
  );
  const before = await text(page);
  await page.getByRole('button', {name: 'Trim', exact: true}).click();
  const middle = segment(page, 5, 0.25, 0.75);
  await preview(page, middle, 2);
  await clickSegment(page, middle);
  assert.match(
    await page.locator('.sketch-editor output').innerText(),
    /could not be deleted; its source or references are not editable/,
  );
  assert.equal(await text(page), before);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 6);
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 4);
});

test('successive overlap trims before recompilation retain constraint order and undo one group at a time', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([
  ['point', 1, [0, 0]], ['point', 2, [40, 0]],
  ['point', 3, [10, 0]], ['point', 4, [30, 0]],
  ['line', 5, [1, 2]], ['line', 6, [2, 1]],
], {constraints: [['angle', [6, 180]], ['fixed', 1], ['length', [5, 40]],
  ['angle', [5, 0]], ['length', [6, 40]]]});`,
  );
  await page.getByRole('button', {name: 'Trim', exact: true}).click();
  await page.locator('.sketch-canvas').evaluate(canvas => {
    const trim = (selector: string) => {
      const bounds = canvas.querySelector(selector)!.getBoundingClientRect();
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 1,
          button: 0,
          buttons: 1,
          clientX: bounds.x + bounds.width / 2,
          clientY: bounds.y + bounds.height / 2,
        }),
      );
    };
    trim('line.local[data-id="5"][data-start="0.25"][data-end="0.75"]');
    trim('line.local[data-id="8"]');
  });
  await waitForSource(page, /'line',\s*10,\s*\[3,\s*1\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 2);
  assert.equal(await page.locator('.sketch-canvas circle.local').count(), 2);
  const source = await text(page);
  assert.match(source, /'angle',\s*\[10,\s*180\]/);
  assert.match(source, /'angle',\s*\[7,\s*0\]/);
  assert.match(source, /'fixed',\s*1/);
  assert.doesNotMatch(source, /'line',\s*[5689],|'length'|'angle',\s*\[[689],/);
  await page.keyboard.press('Control+z');
  await segment(page, 8, 0, 1).waitFor({state: 'attached'});
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 4);
  await page.keyboard.press('Control+z');
  await segment(page, 5, 0.25, 0.75).waitFor({state: 'attached'});
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 6);
});
