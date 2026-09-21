import assert from 'node:assert/strict';
import {test} from 'node:test';
import {open, point, text, waitForSource} from './sketch-test.ts';

test('a related sketch shows read-only context, edits local data and undoes without losing the relation', async t => {
  const source = `import {align, sketch, rectangle} from '@code3d/core';
const host = rectangle(40, 30).rotate(0, 0, 90).originOffset(-15, 0, 0);
const profile = sketch([['point', 1, [0, 0]], ['point', 2, [10, 0]], ['line', 3, [1, 2]]]);
const placed = profile.relate(s => align(s.plane, host.plane));
placed;`;
  const page = await open(t, source);
  await page.getByText('Ready', {exact: true}).waitFor();
  await page
    .locator('.sketch-context-edge')
    .first()
    .waitFor({state: 'attached'});
  const appearance = await page
    .locator('.sketch-context-edge')
    .first()
    .evaluate(e => ({
      width: getComputedStyle(e).strokeWidth,
      pointer: getComputedStyle(e).pointerEvents,
    }));
  assert.deepEqual(appearance, {width: '1px', pointer: 'none'});
  await page.getByRole('button', {name: 'Snap', exact: true}).click();
  const p1 = (await point(page, 1).boundingBox())!;
  const p2 = (await point(page, 2).boundingBox())!;
  const unit = (p2.x - p1.x) / 10;
  await page.mouse.move(p2.x + p2.width / 2, p2.y + p2.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    p2.x + p2.width / 2 + unit * 2,
    p2.y + p2.height / 2 - unit * 3,
    {steps: 8},
  );
  await page.mouse.up();
  await waitForSource(page, /'point',\s*2,\s*\[12[.,]/);
  const position = (await text(page)).match(
    /'point',\s*2,\s*\[([^,]+),\s*([^\]]+)\]/,
  )!;
  // SVG screen coordinates are fractional; snapping is disabled for this drag.
  assert.ok(Math.abs(Number(position[1]) - 12) < 1e-4);
  assert.ok(Math.abs(Number(position[2]) - 3) < 1e-4);
  await page.getByText('Ready', {exact: true}).waitFor();
  // Editing the shared source keeps the caret on the related usage, so the
  // contextual editor keeps showing the host geometry.
  assert.equal(
    await page.evaluate(
      () => window.sketchTestEditor.getPosition()?.lineNumber,
    ),
    5,
  );
  assert.ok(await page.locator('.sketch-context-edge').count());
  assert.match(
    await text(page),
    /profile\.relate\(s => align\(s\.plane, host\.plane\)\)/,
  );
  await page.keyboard.press('Control+z');
  await waitForSource(page, /'point',\s*2,\s*\[10,\s*0\]/);
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.ok(await page.locator('.sketch-context-edge').count());
});

test('empty related sketches can draw without an array and keep the host relation', async t => {
  const page = await open(
    t,
    `import {align, sketch, rectangle} from '@code3d/core';
const host = rectangle(40, 30).originOffset(0, -10, 0);
const profile = sketch().relate(s => align(s.plane, host.plane));
profile;`,
  );
  await page
    .locator('.sketch-context-edge')
    .first()
    .waitFor({state: 'attached'});
  const box = (await page.locator('.sketch-canvas').boundingBox())!;
  await page.getByRole('button', {name: 'Line', exact: true}).click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'line'/);
  await page.keyboard.press('Escape');
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.match(await text(page), /'length',\s*3,\s*10/);
  assert.match(
    await text(page),
    /\.relate\(s => align\(s\.plane, host\.plane\)\)/,
  );
  assert.equal(await point(page, 1).count(), 1);
  assert.equal(await point(page, 2).count(), 1);
});

test('a related sketch keeps blurred source marks without reflowing the line', async t => {
  const source = `import {align, rectangle, sketch} from '@code3d/core';
const host = rectangle(40, 30).originOffset(0, -10, 0);
const base = sketch([
  ['point', 1, [0, 0]],
  ['point', 2, [10, 0]],
  ['line', 3, [1, 2]],
]);
const placed = base.relate(s => align(s.plane, host.plane));
placed;`;
  const page = await open(t, source);
  // Monaco re-indents inserted source, so read offsets and columns from the model.
  const cursor = await page.evaluate(() => {
    const editor = window.sketchTestEditor;
    const model = editor.getModel()!;
    const offset = model.getValue().indexOf('.relate(') + 2;
    const position = model.getPositionAt(offset);
    editor.setPosition(position);
    editor.focus();
    return {offset, lineNumber: position.lineNumber};
  });
  const columnOffsets = () =>
    page.evaluate(({lineNumber}) => {
      const editor = window.sketchTestEditor;
      const length = editor.getModel()!.getLineLength(lineNumber) + 1;
      return [1, 2, length].map(column =>
        editor.getScrolledVisiblePosition({lineNumber, column}),
      );
    }, cursor);
  const focused = await columnOffsets();
  const caretHeight = await page
    .locator('.monaco-editor .cursors-layer .cursor')
    .first()
    .evaluate(element => element.getBoundingClientRect().height);
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await page.waitForFunction(offset => {
    const model = window.sketchTestEditor.getModel()!;
    return model
      .getAllDecorations()
      .some(
        mark =>
          mark.options.beforeContentClassName === 'code3d-context-caret' &&
          model.getOffsetAt(mark.range.getStartPosition()) === offset,
      );
  }, cursor.offset);
  // The blur keeps the word under the caret, not the whole sketch call.
  assert.deepEqual(
    await page.evaluate(() => {
      const model = window.sketchTestEditor.getModel()!;
      return {
        words: model
          .getAllDecorations()
          .filter(
            mark => mark.options.inlineClassName === 'code3d-context-word',
          )
          .map(mark => model.getValueInRange(mark.range)),
        tool: model
          .getAllDecorations()
          .flatMap(mark =>
            mark.options.className === 'code3d-active-tool-source' ||
            mark.options.inlineClassName === 'code3d-active-tool-source-inline'
              ? [model.getValueInRange(mark.range)]
              : [],
          ),
      };
    }),
    {words: ['relate'], tool: []},
  );
  assert.equal(await page.locator('.code3d-active-tool-source').count(), 0);
  // Simulated marks must not reflow the line they mirror.
  assert.deepEqual(await columnOffsets(), focused);
  const word = page.locator('.monaco-editor .code3d-context-word').first();
  await word.waitFor();
  const wordStyle = await word.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      borderRadius: style.borderRadius,
      height: element.getBoundingClientRect().height,
    };
  });
  assert.equal(wordStyle.outlineStyle, 'none');
  assert.equal(wordStyle.borderRadius, '0px');
  const caret = page.locator('.monaco-editor .code3d-context-caret');
  await caret.waitFor();
  // Both simulated marks span the native caret's line box.
  assert.equal(wordStyle.height, caretHeight);
  assert.equal(
    await caret.evaluate(element => element.getBoundingClientRect().height),
    caretHeight,
  );
});
