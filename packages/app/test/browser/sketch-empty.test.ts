import assert from 'node:assert/strict';
import {test} from 'node:test';
import {open, point, selectTool, text, waitForSource} from './sketch-test.ts';

const tools = ['Line', 'Rectangle', 'Center rectangle', 'Circle', 'Arc'];
for (const [index, tool] of tools.entries())
  test(`${tool} draws into omitted entries, cancels without writes and restores the original call on undo`, async t => {
    const args = ['', '/* keep */', '', '// keep\n', '/* keep */'][index];
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';\nconst value = sketch(${args});`,
      {line: 2, column: 8},
    );
    const original = await text(page);
    for (const name of tools.filter(name => name !== 'Center rectangle'))
      assert.equal(
        await page.getByRole('button', {name, exact: true}).isEnabled(),
        true,
      );
    await selectTool(page, tool);
    const bounds = (await page.locator('.sketch-canvas').boundingBox())!;
    const x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    await page.mouse.click(x, y);
    await page.keyboard.press('Escape');
    assert.equal(await text(page), original);
    await page.mouse.click(x, y);
    await page.mouse.move(x + 60, y - 30);
    const field = (name: string) =>
      page.getByRole('textbox', {name, exact: true});
    if (tool === 'Line') await field('Length').fill('10');
    else if (tool.endsWith('rectangle') || tool === 'Rectangle') {
      await field('Width').fill('10');
      await field('Height').fill('8');
    } else await field('Radius').fill('5');
    await page.keyboard.press('Enter');
    if (tool === 'Arc') {
      await field('Sweep').fill('90');
      await page.keyboard.press('Enter');
    }
    await waitForSource(page, /constraints:/);
    await point(page, 1).waitFor();
    const created = await text(page);
    assert.match(created, /'point',\s*1/);
    assert.match(created, /'line'|'circle'|'arc'/);
    if (args) assert.match(created, /keep/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await waitForSource(page, /sketch\((?:\s|\/\* keep \*\/|\/\/ keep)*\)/);
    assert.equal(await text(page), original);
    await point(page, 1).waitFor({state: 'detached'});
    await page.keyboard.press('Control+Shift+z');
    await point(page, 1).waitFor();
    await waitForSource(page, /constraints:/);
    assert.equal(await text(page), created);
  });

test('a standalone sketch() expression supports its first freehand line without options', async t => {
  const page = await open(t, "import {sketch} from '@code3d/core';\nsketch();");
  const original = await text(page);
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  const bounds = (await page.locator('.sketch-canvas').boundingBox())!;
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await page.mouse.click(x, y);
  await page.mouse.click(x + 60, y - 30);
  await waitForSource(page, /'line',\s*3,\s*\[1,\s*2\]/);
  assert.doesNotMatch(await text(page), /constraints:/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await waitForSource(page, /sketch\(\)/);
  assert.equal(await text(page), original);
});

test('an empty derived layer first draws using a named upstream point and undoes without changing its base', async t => {
  const base = "const base = sketch([['point', 1, [0, 0]]]);";
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';\n${base}\nconst child = base.derive();`,
  );
  const original = await text(page);
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await point(page, 1, 'upstream').click();
  await page.getByRole('textbox', {name: 'Length', exact: true}).fill('10');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'line',\s*2,\s*\[base\.point\(1\),\s*1\]/);
  assert.ok((await text(page)).includes(base));
  await point(page, 1).waitFor();
  assert.equal(await point(page, 1, 'upstream').count(), 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await waitForSource(page, /base\.derive\(\)/);
  assert.equal(await text(page), original);
  await point(page, 1).waitFor({state: 'detached'});
  assert.equal(await point(page, 1, 'upstream').count(), 1);
});
