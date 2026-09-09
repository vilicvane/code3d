import assert from 'node:assert/strict';
import {test} from 'node:test';
import {open, point, text, waitForSource} from './sketch-test.ts';

const source = (x = '20') =>
  [
    "import {sketch} from '@code3d/core';",
    'const width = 30;',
    `const s = sketch([['point',1,[0,0]],['point',2,[${x},0]],['line',3,[1,2]]], {constraints:[['fixed',1],['horizontal',3],['length',3,width]]});`,
  ].join('\n');
const message = 'Sketch source data differs from the constraint solution.';

test('solved-data warnings mark code, synchronize explicitly and support one-step undo/redo', async t => {
  const page = await open(
    t,
    source().replace("'length',3,width", "'length',3,20"),
  );
  const warning = page.locator('.viewport-diagnostic[data-severity="warning"]');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await warning.count(), 0);
  // Replace the literal in Monaco: normal author edits must diagnose the next solve.
  await page.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.press('Control+End');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await page.keyboard.insertText('width');
  // Completion candidates have transient previews; dismiss before awaiting the
  // accepted source compilation and its diagnostics.
  await page.locator('.monaco-editor .suggest-widget.visible').waitFor();
  await page.keyboard.press('Escape');
  await waitForSource(page, /\['length',3,width\]/);
  await warning.getByText(message, {exact: true}).waitFor();
  await page.locator('.monaco-editor .squiggly-warning').first().waitFor();
  await page.getByText('Ready', {exact: true}).waitFor();
  const before = await text(page);
  const geometry = await point(page, 2).getAttribute('cx');
  const fix = warning.getByRole('button', {name: 'Fix', exact: true});
  const style = await fix.evaluate(el => {
    const css = getComputedStyle(el);
    const card = el.closest('.viewport-diagnostic')!;
    const box = card.getBoundingClientRect();
    const cardStyle = getComputedStyle(card);
    return {
      decoration: css.textDecorationLine,
      background: css.backgroundColor,
      border: css.borderWidth,
      width: el.getBoundingClientRect().width,
      rightGap:
        box.right -
        el.getBoundingClientRect().right -
        parseFloat(cardStyle.paddingRight) -
        parseFloat(cardStyle.borderRightWidth),
    };
  });
  assert.equal(style.decoration, 'underline');
  assert.equal(style.background, 'rgba(0, 0, 0, 0)');
  assert.equal(style.border, '0px');
  assert.ok(style.width < 60, JSON.stringify(style));
  assert.ok(Math.abs(style.rightGap) < 0.1, JSON.stringify(style));
  await fix.focus();
  await page.keyboard.press('Enter');
  await warning.waitFor({state: 'detached'});
  await page.getByText('Ready', {exact: true}).waitFor();
  await waitForSource(page, /\['point',2,\[30,0\]\]/);
  assert.match(await text(page), /\['length',3,width\]/);
  assert.equal(
    await page.locator('.monaco-editor .squiggly-warning').count(),
    0,
  );
  assert.equal(await point(page, 2).getAttribute('cx'), geometry);
  await page.keyboard.press('Control+z');
  await warning.waitFor();
  assert.equal(await text(page), before);
  assert.equal(await point(page, 2).getAttribute('cx'), geometry);
  await page.keyboard.press('Control+y');
  await warning.waitFor({state: 'detached'});
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await point(page, 2).getAttribute('cx'), geometry);
});

test('changed coordinate expressions stay visible as warnings without a destructive repair', async t => {
  const page = await open(t, source('width / 2'));
  const warning = page.locator('.viewport-diagnostic[data-severity="warning"]');
  await warning.getByText(message, {exact: true}).waitFor();
  assert.match(
    await warning.innerText(),
    /coordinates or radii are expressions/,
  );
  assert.equal(await warning.getByRole('button').count(), 0);
  assert.match(await text(page), /\[width \/ 2,0\]/);
});

test('upstream warnings cannot be repaired through a read-only derived sketch', async t => {
  const page = await open(t, source() + '\nconst child = s.derive([]);');
  const warning = page.locator('.viewport-diagnostic[data-severity="warning"]');
  await warning.getByText(message, {exact: true}).waitFor();
  const button = warning.getByRole('button', {name: 'Fix', exact: true});
  assert.equal(await button.isDisabled(), true);
  assert.equal(
    await button.getAttribute('title'),
    'Open the owning sketch to apply this fix.',
  );
});
