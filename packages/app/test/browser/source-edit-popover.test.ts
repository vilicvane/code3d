import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, openPage, point, text, waitForSource} from './sketch-test.ts';

const summary = (page: Page) => page.locator('.source-edit-popover-summary');
const toggle = (page: Page) => page.locator('.source-edit-popover-toggle');

test('sketch edits show actual changed lines, expand on demand and navigate to the current source', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core';\nconst value = sketch([\n['point', 1, [0, 0]],\n['point', 2, [20, 0]],\n['line', 3, [1, 2]],\n]);",
  );
  const bounds = await point(page, 2).boundingBox();
  assert.ok(bounds);
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 30,
    bounds.y + bounds.height / 2 - 20,
    {steps: 5},
  );
  assert.equal(
    await summary(page).isVisible(),
    false,
    'preview frames do not notify',
  );
  await page.mouse.up();
  await summary(page).waitFor();
  assert.equal(await summary(page).innerText(), 'model.ts\n+1\n−1');
  assert.equal(await toggle(page).getAttribute('aria-expanded'), 'false');
  assert.equal(
    await page.evaluate(
      () => !!document.activeElement?.closest('.sketch-editor'),
    ),
    true,
  );
  await toggle(page).click();
  assert.equal(await toggle(page).getAttribute('aria-expanded'), 'true');
  const added = page.locator('.source-edit-line[data-kind="+"]');
  assert.equal(await added.count(), 1);
  assert.equal(
    await page.locator('.source-edit-line[data-kind="-"]').count(),
    1,
  );
  assert.match(await added.locator('code').innerText(), /'point', 2/);
  assert.match(
    await page.locator('.source-edit-line[data-kind="-"] code').innerText(),
    /\[20, 0\]/,
  );
  await page.screenshot({path: '/tmp/code3d-23-source-diff-expanded.png'});
  // Opening feedback must not make the next drawing's numeric entry overlap it.
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await page.waitForFunction(() => {
    const notification = document
      .querySelector('.source-edit-popover')!
      .getBoundingClientRect();
    const input = document
      .querySelector('.sketch-stage .drawing-inputs')!
      .getBoundingClientRect();
    return input.height > 0 && notification.top - input.bottom >= 7;
  });
  assert.equal(await toggle(page).getAttribute('aria-expanded'), 'true');
  await added.click();
  await page.waitForFunction(
    () => !!document.activeElement?.closest('.monaco-editor'),
  );
});

test('continuous drawing retains numeric input focus above compact feedback at wide and narrow sizes', async t => {
  const page = await open(
    t,
    "import {sketch} from '@code3d/core';\nconst value = sketch([]);",
  );
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  const bounds = await page.locator('.sketch-canvas').boundingBox();
  assert.ok(bounds);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.click(x, y);
  await page.mouse.click(x + 60, y);
  await waitForSource(page, /'line', 3/);
  await page.mouse.click(x + 60, y - 60);
  await waitForSource(page, /'line', 5/);
  assert.equal(await page.locator('.source-edit-popover').count(), 1);
  assert.equal(await toggle(page).getAttribute('aria-expanded'), 'false');
  const length = page.getByRole('textbox', {name: 'Length', exact: true});
  for (const width of [1400, 1000, 680]) {
    await page.setViewportSize({width, height: 800});
    await page.waitForFunction(() => {
      const notification = document
        .querySelector('.source-edit-popover')!
        .getBoundingClientRect();
      const input = document
        .querySelector('.sketch-stage .drawing-inputs')!
        .getBoundingClientRect();
      return notification.top - input.bottom >= 7;
    });
    const popup = await page.locator('.source-edit-popover').boundingBox();
    assert.ok(popup);
    assert.ok(popup.height <= 32, `compact popup height ${popup.height}`);
    assert.ok(popup.x >= 0 && popup.x + popup.width <= width);
    await length.click();
    assert.equal(
      await length.evaluate(el => document.activeElement === el),
      true,
    );
  }
  await page.screenshot({path: '/tmp/code3d-23-source-diff-narrow.png'});
  await length.fill('12');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'length', 7, 12/);
  assert.equal(await page.locator('.source-edit-popover').isVisible(), true);
  const changed = await text(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    () => !document.querySelector('.constraint-badge[data-kind="length"]'),
  );
  assert.notEqual(await text(page), changed);
  assert.equal(await page.locator('.source-edit-popover').isVisible(), false);
});

test('3D panel commits share the compact diff without taking input focus', async t => {
  const page = await openPage(t);
  await page.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(
    "import {box} from '@code3d/core';\nconst value = box(10, 20, 30);",
  );
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const input = page.locator(
    '.contextual-tool-panel input[data-parameter="x"]',
  );
  await input.waitFor();
  await input.fill('15');
  await page.keyboard.press('Enter');
  await summary(page).waitFor();
  assert.equal(await summary(page).innerText(), 'model.ts\n+1\n−1');
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await page
    .getByRole('button', {name: 'Close source update', exact: true})
    .click();
  assert.equal(await summary(page).isVisible(), false);
});

test('multi-file summaries, no-op dismissal, keyboard expansion and auto-dismiss are accessible', async t => {
  const page = await openPage(t);
  const url = new URL(
    '/__source-edit-popover-test__',
    process.env.CODE3D_TEST_URL,
  ).href;
  await page.route(url, route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<link rel="stylesheet" href="/src/style.css"><input aria-label="Number"><main></main>',
    }),
  );
  await page.goto(url);
  await page.clock.install();
  await page.evaluate(async () => {
    const {SourceEditPopover} = await import('/src/ui/source-edit-popover.ts');
    const {sourceEditDiff} = await import('/src/source-edit-diff.ts');
    const popover = new SourceEditPopover(
      document.querySelector('main')!,
      () => {},
    );
    const diff = (file: string) =>
      sourceEditDiff(file, 'next\n', [
        {
          sourceRef: {file, start: 0, end: 4},
          expectedText: 'old\n',
          text: 'next\n',
        },
      ]);
    document.querySelector('input')!.focus();
    document.addEventListener('test-show-diff', () =>
      popover.show([diff('/one.ts'), diff('/two.ts')]),
    );
    document.addEventListener('test-show-noop', () =>
      popover.show([sourceEditDiff('/one.ts', 'same', [])]),
    );
  });
  const show = () =>
    page.evaluate(() => document.dispatchEvent(new Event('test-show-diff')));
  await show();
  assert.equal(await summary(page).innerText(), '2 files\n+2\n−2');
  assert.equal(
    await page
      .getByRole('textbox')
      .evaluate(el => document.activeElement === el),
    true,
  );
  await toggle(page).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.source-edit-block').count(), 2);
  assert.equal(await toggle(page).getAttribute('aria-expanded'), 'true');
  await page.clock.fastForward(10_000);
  assert.equal(
    await summary(page).isVisible(),
    true,
    'focused content does not auto-dismiss',
  );
  await page.keyboard.press('Escape');
  assert.equal(await toggle(page).getAttribute('aria-expanded'), 'false');
  assert.equal(
    await toggle(page).evaluate(el => document.activeElement === el),
    true,
  );
  await page.getByRole('textbox').focus();
  await page.clock.fastForward(2500);
  assert.equal(await summary(page).isVisible(), false);
  await show();
  await page.evaluate(() =>
    document.dispatchEvent(new Event('test-show-noop')),
  );
  assert.equal(await summary(page).isVisible(), false);
  await show();
  await page.clock.fastForward(7100);
  assert.equal(await summary(page).isVisible(), false);
});
