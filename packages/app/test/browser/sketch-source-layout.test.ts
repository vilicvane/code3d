import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openPage, point, text, waitForSource} from './sketch-test.ts';

for (const options of ['', ', {}', ', {constraints: []}']) {
  test(`constraint writeback inherits a nested sketch's indentation before Prettier (${options || 'no options'})`, async t => {
    const page = await openPage(t);
    const fixture = `import {sketch} from '@code3d/core';
{
  const value = sketch(
    [
      ['point', 1, [0, 0]],
      ['point', 2, [20, 0]],
      ['line', 3, [1, 2]],
    ]${options}
  );
}`;
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Control+a');
    // Input.insertText uses EditContext's typing path, which auto-indents every
    // newline. Use the actual paste handler for this whitespace-sensitive fixture
    // without replacing the user's system clipboard or bypassing editor events.
    await page.evaluate(source => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', source);
      document.activeElement!.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData,
        }),
      );
    }, fixture);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.getByRole('region', {name: 'Sketch editor'}).waitFor();
    await page.getByText('Ready', {exact: true}).waitFor();
    const before = await text(page);
    assert.equal(before, fixture);
    await point(page, 1).click();
    await page.getByRole('button', {name: 'Fixed', exact: true}).click();
    await waitForSource(page, /\['fixed', 1\]/);
    await page.getByText('Ready', {exact: true}).waitFor();
    const after = await text(page);
    assert.ok(after.split('\n').includes("        ['fixed', 1],"), after);
    assert.ok(
      after
        .split('\n')
        .includes(options.includes('constraints') ? '      ]}' : '      ],'),
      after,
    );
    // Focus has remained inside the sketch: the source formatter has not run.
    // The original inline options/wrapping and untouched tuples remain intact.
    assert.equal(
      await page.evaluate(
        () => !!document.activeElement?.closest('.sketch-editor'),
      ),
      true,
    );
    assert.match(after, /\['point', 2, \[20, 0\]\]/);
    if (options) assert.match(after, /\], \{/);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      () => !document.querySelector('.constraint-badge[data-kind="fixed"]'),
    );
    assert.equal(await text(page), before);
  });
}
