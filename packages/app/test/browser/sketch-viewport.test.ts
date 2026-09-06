import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from 'playwright-core';
import {open, point, text, waitForSource} from './sketch-test.ts';

async function cursor(page: Page, line: number, column: number): Promise<void> {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+Home');
  for (let i = 1; i < line; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  for (let i = 1; i < column; i++) await page.keyboard.press('ArrowRight');
}
const sketch =
  "const value = sketch([['point', 1, [0, 0]], ['point', 2, [40, 0]], ['line', 3, [1, 2]]]);";

for (const [name, failure] of [
  ['another sketch', "const other = sketch([['line', 1, [9, 10]]]);"],
  [
    'a downstream derivation',
    "const child = value.derive([['line', 1, [9, 10]]]);",
  ],
  ['a 3D model', 'const solid = box(10, 10, 10);\nsolid.fillet(2, [999]);'],
] as const) {
  test(`a selected sketch excludes Model error and error cards from ${name}`, async t => {
    const page = await open(
      t,
      `import {sketch, box} from '@code3d/core';\n${sketch}\n${failure}`,
      {line: 2, column: 8},
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.equal(
      await page.locator('#viewport-diagnostic-stack').isVisible(),
      false,
    );
    assert.equal(await page.getByText('Model error', {exact: true}).count(), 0);
    assert.ok(await page.locator('.monaco-editor .squiggly-error').count());
    assert.equal(await point(page, 1).count(), 1);
    if (name === 'a 3D model') {
      await cursor(page, 3, 8);
      await page.getByText('Model error', {exact: true}).waitFor();
      assert.equal(await page.locator('.sketch-editor').isVisible(), false);
      assert.equal(
        await page.locator('#viewport-diagnostic-stack').isVisible(),
        true,
      );
      await cursor(page, 2, 8);
      await page.getByText('Ready', {exact: true}).waitFor();
      assert.equal(
        await page.locator('#viewport-diagnostic-stack').isVisible(),
        false,
      );
    }
  });
}

test('the current failing sketch retains last-good geometry, reports its own error and recovers with undo', async t => {
  const source = `import {sketch} from '@code3d/core';
const value = sketch([
  ['point', 1, [0, 0]], ['point', 2, [40, 0]], ['line', 3, [1, 2]],
], {constraints: [
  ['length', [3, 40]],
  ['length', [3, 40]],
]});`;
  const page = await open(t, source);
  await cursor(page, 6, 1);
  // Monaco indents pasted lines. Locate the value from the stable `]],` suffix.
  await page.keyboard.press('End');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.insertText('50');
  await waitForSource(page, /\['length', \[3, 50\]\]/);
  await page.getByText('Model error', {exact: true}).waitFor();
  assert.equal(await page.locator('.sketch-editor').isVisible(), true);
  assert.equal(await page.locator('.sketch-canvas line.local').count(), 1);
  assert.equal(
    await page.getByRole('button', {name: 'Trim', exact: true}).isDisabled(),
    true,
  );
  assert.match(
    await page.locator('.sketch-editor output').innerText(),
    /Last successful sketch/,
  );
  assert.match(
    await page.locator('#viewport-diagnostic-stack').innerText(),
    /sketch constraints/i,
  );
  await page.keyboard.press('Control+z');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(
    await page.getByRole('button', {name: 'Trim', exact: true}).isEnabled(),
    true,
  );
  assert.equal(
    await page.locator('#viewport-diagnostic-stack').isVisible(),
    false,
  );
  assert.doesNotMatch(await text(page), /50/);
});

test('the sketch canvas fills the viewport with floating controls at wide and narrow sizes', async t => {
  const page = await open(t, `import {sketch} from '@code3d/core';\n${sketch}`);
  for (const width of [1400, 1000, 680]) {
    await page.setViewportSize({width, height: 900});
    await page.waitForFunction(() => {
      const viewport = document
        .querySelector('#viewport-host')!
        .getBoundingClientRect();
      const canvas = document
        .querySelector('.sketch-canvas')!
        .getBoundingClientRect();
      return (
        Math.abs(viewport.width - canvas.width) < 0.5 &&
        Math.abs(viewport.height - canvas.height) < 0.5
      );
    });
    const geometry = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return {x: r.x, y: r.y, width: r.width, height: r.height};
      };
      return {
        viewport: bounds('#viewport-host'),
        canvas: bounds('.sketch-canvas'),
        root: bounds('.sketch-editor'),
        toolbar: bounds('.sketch-editor header'),
        status: bounds('.viewport-status'),
        rootBorder: getComputedStyle(document.querySelector('.sketch-editor')!)
          .borderWidth,
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    assert.deepEqual(geometry.canvas, geometry.viewport);
    assert.deepEqual(geometry.root, geometry.viewport);
    assert.equal(geometry.rootBorder, '0px');
    assert.ok(geometry.toolbar.x > geometry.canvas.x);
    assert.ok(geometry.toolbar.y > geometry.canvas.y);
    assert.ok(geometry.toolbar.width < geometry.canvas.width);
    assert.equal(
      geometry.canvas.x +
        geometry.canvas.width -
        geometry.toolbar.x -
        geometry.toolbar.width,
      14,
    );
    if (geometry.canvas.width <= 540) {
      assert.ok(
        geometry.toolbar.y > geometry.status.y + geometry.status.height,
      );
    } else {
      assert.equal(geometry.toolbar.y, geometry.status.y);
      assert.ok(geometry.status.x + geometry.status.width < geometry.toolbar.x);
    }
    assert.equal(geometry.pageWidth, width);
    assert.equal(await page.locator('.viewport-canvas').isVisible(), false);
    await page.getByRole('button', {name: 'Line', exact: true}).click();
    const canvas = geometry.canvas;
    await page.mouse.click(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    const input = page.locator('.drawing-inputs input').first();
    assert.equal(await input.isVisible(), true);
    const inputs = await page.locator('.drawing-inputs').boundingBox();
    const footer = await page.locator('.sketch-editor output').boundingBox();
    assert.ok(inputs && footer && inputs.y + inputs.height < footer.y);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
});

test('icon toolbar groups tools and supports one Tab stop, arrow navigation and native labels', async t => {
  const page = await open(t, `import {sketch} from '@code3d/core';\n${sketch}`);
  const toolbar = page.getByRole('toolbar', {name: 'Sketch tools'});
  assert.equal(await toolbar.innerText(), '');
  assert.deepEqual(
    await toolbar
      .getByRole('group')
      .evaluateAll(groups =>
        groups.map(group => group.getAttribute('aria-label')),
      ),
    ['Edit', 'Draw', 'View'],
  );
  for (const name of [
    'Select',
    'Trim',
    'Line',
    'Rectangle',
    'Center rectangle',
    'Fit',
    'Snap',
    'Constraints',
  ]) {
    const button = toolbar.getByRole('button', {name, exact: true});
    assert.match((await button.getAttribute('title'))!, new RegExp(name, 'i'));
    assert.equal(await button.locator('svg').count(), 1);
    const bounds = await button.boundingBox();
    assert.equal(bounds?.width, 30);
    assert.equal(bounds?.height, 30);
  }
  assert.equal(await toolbar.locator('button[tabindex="0"]').count(), 1);
  await toolbar.getByRole('button', {name: 'Select', exact: true}).focus();
  await page.keyboard.press('End');
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label'),
    ),
    'Constraints',
  );
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label'),
    ),
    'Select',
  );
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label'),
    ),
    'Trim',
  );
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.equal(
    await toolbar
      .getByRole('button', {name: 'Line', exact: true})
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label'),
    ),
    'Sketch drawing',
  );
  await page.keyboard.press('Escape');
  await toolbar.getByRole('button', {name: 'Snap', exact: true}).click();
  assert.equal(
    await toolbar
      .getByRole('button', {name: 'Snap', exact: true})
      .getAttribute('aria-pressed'),
    'false',
  );
  await toolbar.getByRole('button', {name: 'Select', exact: true}).focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label'),
    ),
    'Sketch drawing',
  );
  await page.keyboard.press('Shift+Tab');
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label'),
    ),
    'Select',
  );
  assert.equal(await toolbar.locator('button[tabindex="0"]').count(), 1);
});

test('toolbar navigation skips read-only drawing tools but leaves view controls accessible', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';\nconst entries = [['point', 1, [0, 0]]];\nconst value = sketch(entries);`,
    {line: 3, column: 8},
  );
  const toolbar = page.getByRole('toolbar', {name: 'Sketch tools'});
  assert.equal(await toolbar.locator('button:disabled').count(), 4);
  await toolbar.getByRole('button', {name: 'Select', exact: true}).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label'),
    ),
    'Fit',
  );
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label'),
    ),
    'Select',
  );
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.equal(
    await toolbar
      .getByRole('button', {name: 'Constraints', exact: true})
      .getAttribute('aria-pressed'),
    'false',
  );
});

test('syntax errors retain an explicitly stale sketch without a model error, and leaving its source exits the view', async t => {
  const page = await open(
    t,
    `import {sketch, box} from '@code3d/core';\n${sketch}\nconst solid = box(10, 10, 10);`,
    {line: 2, column: 8},
  );
  await cursor(page, 2, 1);
  await page.keyboard.press('End');
  // Stay inside the selected sketch array, not after the call's closing `)`.
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.insertText('?');
  await page.getByText('Last valid sketch', {exact: true}).waitFor();
  assert.equal(await point(page, 1).count(), 1);
  assert.equal(
    await page.locator('#viewport-diagnostic-stack').isVisible(),
    false,
  );
  assert.equal(await page.getByText('Model error', {exact: true}).count(), 0);
  assert.ok(await page.locator('.monaco-editor .squiggly-error').count());
  await cursor(page, 3, 8);
  await page
    .getByRole('region', {name: 'Sketch editor'})
    .waitFor({state: 'hidden'});
  await page.keyboard.press('Control+z');
  await page.getByText('Ready', {exact: true}).waitFor();
  await cursor(page, 2, 8);
  await page.getByRole('region', {name: 'Sketch editor'}).waitFor();
  assert.equal(
    await page.getByRole('button', {name: 'Trim', exact: true}).isEnabled(),
    true,
  );
});
