import assert from 'node:assert/strict';
import {test} from 'node:test';
import {open, point, text, waitForSource} from './sketch-test.ts';

const cases = [
  {
    kind: 'x',
    name: 'X coordinate',
    entries: "['point',1,[5,8]]",
    target: 1,
    value: 5,
    next: 7,
    selected: 'circle',
  },
  {
    kind: 'y',
    name: 'Y coordinate',
    entries: "['point',1,[5,8]]",
    target: 1,
    value: 8,
    next: 12,
    selected: 'circle',
  },
  {
    kind: 'length',
    name: 'Length',
    entries: "['point',1,[0,0]],['point',2,[20,0]],['line',3,[1,2]]",
    target: 3,
    value: 20,
    next: 30,
    selected: 'line',
  },
  {
    kind: 'angle',
    name: 'Angle',
    entries: "['point',1,[0,0]],['point',2,[20,0]],['line',3,[1,2]]",
    target: 3,
    value: 0,
    next: 45,
    selected: 'line',
  },
  {
    kind: 'radius',
    name: 'Radius',
    entries: "['point',1,[0,0]],['circle',2,[1,5]]",
    target: 2,
    value: 5,
    next: 8,
    selected: 'circle',
  },
  {
    kind: 'sweep',
    name: 'Sweep',
    entries:
      "['point',1,[0,0]],['point',2,[10,0]],['point',3,[0,10]],['arc',4,[1,10,2,3,'ccw']]",
    target: 4,
    value: 90,
    next: 120,
    selected: 'path',
  },
];

for (const c of cases)
  test(`${c.name} marker selects its geometry, focuses its value and edits in place with undo`, async t => {
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';
const value = sketch([${c.entries}], {constraints: [/* keep */ ['${c.kind}',${c.target},${c.value}]]});`,
    );
    const before = await text(page);
    await page.getByRole('button', {name: 'Trim', exact: true}).click();
    const badge = page.locator(`.constraint-badge[data-kind="${c.kind}"]`);
    assert.equal(await badge.getAttribute('role'), 'button');
    await badge.click();
    const input = page.getByRole('textbox', {name: c.name, exact: true});
    assert.equal(
      await input.evaluate(el => document.activeElement === el),
      true,
    );
    assert.equal(await input.inputValue(), String(c.value));
    assert.deepEqual(
      await input.evaluate((el: HTMLInputElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
      [0, String(c.value).length],
    );
    assert.equal(
      await page
        .locator(`.sketch-canvas ${c.selected}.selected[data-id="${c.target}"]`)
        .count(),
      1,
    );
    assert.equal(await text(page), before);
    assert.equal(
      await page
        .getByRole('button', {name: 'Select', exact: true})
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.keyboard.insertText(String(c.next));
    await page.keyboard.press('Enter');
    const expected = new RegExp(`'${c.kind}',\\s*${c.target},\\s*${c.next}\\]`);
    await waitForSource(page, expected);
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.equal(await input.count(), 0);
    assert.match(await text(page), /\/\* keep \*\//);
    assert.equal(
      await page.locator(`.constraint-badge[data-kind="${c.kind}"]`).count(),
      1,
    );
    await badge.click();
    assert.equal(await input.inputValue(), String(c.next));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await waitForSource(
      page,
      new RegExp(`'${c.kind}',\\s*${c.target},\\s*${c.value}\\]`),
    );
    assert.equal(await text(page), before);
  });

test('a midpoint marker selects all three points and its active relation can be removed', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['point',2,[-10,-5]],['point',3,[10,5]]], {constraints:[['midpoint',[1,2,3]]]});`,
  );
  const before = await text(page);
  const badge = page.locator('.constraint-badge[data-kind="midpoint"]');
  await badge.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.sketch-canvas circle.selected').count(), 3);
  assert.equal(
    await page.getByRole('form', {name: 'Constraint value'}).count(),
    0,
  );
  assert.equal(await text(page), before);
  const action = page
    .getByRole('toolbar', {name: 'Selection constraints'})
    .getByRole('button', {name: 'Midpoint', exact: true});
  assert.equal(await action.getAttribute('aria-pressed'), 'true');
  await action.click();
  await badge.waitFor({state: 'detached'});
  assert.doesNotMatch(await text(page), /'midpoint'/);
  await page.keyboard.press('Control+z');
  await badge.waitFor();
  assert.equal(await text(page), before);
});

test('keyboard activation, invalid input, cancellation and leaving the sketch never write unfinished values', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['circle',2,[1,5]]], {constraints:[['radius',2,5]]});`,
  );
  const before = await text(page);
  const badge = page.locator('.constraint-badge[data-kind="radius"]');
  await badge.focus();
  await page.keyboard.press('Space');
  const input = page.getByRole('textbox', {name: 'Radius', exact: true});
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await input.fill('-1');
  await page.keyboard.press('Enter');
  assert.match(
    await page.locator('.sketch-constraint-tools [role="alert"]').innerText(),
    /greater than zero/,
  );
  assert.equal(await text(page), before);
  await page.keyboard.press('Escape');
  assert.equal(await input.count(), 0);
  assert.equal(await text(page), before);
  await badge.click();
  await input.fill('9');
  await point(page, 1).click();
  assert.equal(await input.count(), 0);
  assert.equal(await text(page), before);
  await badge.click();
  await input.fill('9');
  await page.locator('.monaco-editor .view-lines').click();
  assert.equal(await input.count(), 0);
  assert.equal(await text(page), before);
});

test('expression and upstream values select related elements without exposing a writable dimension', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const width=20;
const base=sketch([['point',1,[0,0]],['circle',2,[1,5]]],{constraints:[['radius',2,5]]});
const value=base.derive([['point',1,[width,0]]],{constraints:[['x',1,width]]});`,
  );
  const before = await text(page);
  await page.locator('.constraint-badge[data-kind="x"]').click();
  assert.equal(
    await page.locator('.sketch-canvas circle.local.selected').count(),
    1,
  );
  assert.equal(
    await page.getByRole('form', {name: 'Constraint value'}).count(),
    0,
  );
  await page.locator('.constraint-badge[data-kind="radius"]').click();
  assert.equal(
    await page.locator('.sketch-canvas circle.upstream.selected').count(),
    1,
  );
  assert.equal(
    await page.getByRole('form', {name: 'Constraint value'}).count(),
    0,
  );
  assert.equal(await text(page), before);
});

test('clicking one of two dimensions edits only its own tuple and retains the other value', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value=sketch([['point',1,[-10,0]],['circle',2,[1,5]],['point',3,[10,0]],['circle',4,[3,5]]],{constraints:[['radius',2,5],/* second */['radius',4,5]]});`,
  );
  const badges = page.locator('.constraint-badge[data-kind="radius"]');
  const input = page.getByRole('textbox', {name: 'Radius', exact: true});
  await badges.nth(0).click();
  await input.fill('11');
  await badges.nth(1).click();
  assert.equal(await input.inputValue(), '5');
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await input.fill('7');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'radius',\s*4,\s*7/);
  assert.match(await text(page), /'radius',\s*2,\s*5/);
  assert.match(await text(page), /\/\* second \*\//);
});

test('a local coordinate relation on an upstream-only selection has no writable input', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const base = sketch([['point',1,[0,0]]]);
const value = base.derive([], {constraints:[['x',base.point(1),0]]});`,
  );
  const before = await text(page);
  await page.locator('.constraint-badge[data-kind="x"]').click();
  assert.equal(
    await point(page, 1, 'upstream')
      .getAttribute('class')
      .then(c => c?.includes('selected')),
    true,
  );
  assert.equal(
    await page
      .getByRole('form', {name: 'Constraint value', includeHidden: true})
      .count(),
    0,
  );
  assert.equal(await text(page), before);
});
