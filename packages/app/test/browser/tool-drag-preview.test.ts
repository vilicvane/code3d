import assert from 'node:assert/strict';
import {test} from 'node:test';
import {open, point, text} from './sketch-test.ts';

for (const finish of ['Escape', 'release']) {
  test(`point drag shows solved coordinates and clears on ${finish}`, async t => {
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';
const value = sketch([
  ['point', 1, [0, 0]],
  ['point', 2, [40, 0]],
  ['line', 3, [1, 2]],
]);`,
    );
    const warnings: string[] = [];
    page.on('console', message => {
      if (message.text().includes('[MobX]')) warnings.push(message.text());
    });
    const source = await text(page);
    await point(page, 2).waitFor();
    const anchor = (await point(page, 1).boundingBox())!;
    const handle = (await point(page, 2).boundingBox())!;
    const scale = (handle.x - anchor.x) / 40;
    await page.getByRole('button', {name: 'Snap', exact: true}).click();
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.width / 2 - 10 * scale,
      handle.y + handle.height / 2 - 5 * scale,
      {steps: 3},
    );
    const readout = page.locator('.tool-drag-preview');
    await page.waitForFunction(() =>
      document
        .querySelector('.tool-drag-preview')
        ?.textContent?.includes('− 10'),
    );
    assert.match(await readout.innerText(), /X: 40 − 10 = 30 unit/);
    assert.match(await readout.innerText(), /Y: 0 \+ 5 = 5 unit/);
    assert.equal(await text(page), source);
    const position = await readout.boundingBox();
    const stack = await page.locator('.viewport-tool-stack').boundingBox();
    assert.equal(position?.y, stack?.y);
    await page.screenshot({path: `/tmp/code3d-drag-preview-${finish}.png`});
    if (finish === 'Escape') await page.keyboard.press('Escape');
    await page.mouse.up();
    await readout.waitFor({state: 'hidden'});
    if (finish === 'Escape') assert.equal(await text(page), source);
    assert.deepEqual(warnings, []);
  });
}

test('radius drag shows the solved radius and its signed change', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 20]],
]);`,
  );
  const circle = page.locator(
    '.sketch-canvas circle.local[data-kind="circle"][data-id="2"]',
  );
  await circle.waitFor();
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  const bounds = (await circle.boundingBox())!;
  const scale = Number(await circle.getAttribute('r')) / 20;
  await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width - 5 * scale,
    bounds.y + bounds.height / 2,
    {steps: 3},
  );
  const readout = page.locator('.tool-drag-preview');
  await page.waitForFunction(() =>
    document.querySelector('.tool-drag-preview')?.textContent?.includes('− 5'),
  );
  assert.match(await readout.innerText(), /Radius/);
  assert.match(await readout.innerText(), /Radius: 20 − 5 = 15 unit/);
  await page.mouse.up();
  await readout.waitFor({state: 'hidden'});
});
