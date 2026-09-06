import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'align direction markers, offset writeback and undo work in the App',
  {timeout: 120_000},
  async t => {
    const appUrl = process.env.CODE3D_TEST_URL;
    assert.ok(appUrl, 'Set CODE3D_TEST_URL to the task development server');
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.alignmentTest = {viewport, codeEditor};\n',
      });
    });
    await page.goto(appUrl);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 30000});
    const source = `import {arc, box, group, line} from '@code3d/core';
const base=arc([20,0,0],[0,20,0],[-20,0,0]);
const part=arc([0,20,0],[-20,0,0],[0,-20,0]).relate(self=>self.align(base).offset(0,0,8));
const axis=box(1,1,1);
const rail=line([30,0,0],[30,20,0]).relate(self=>self.align(axis.axis.reverse()));
export default group([base,part,rail]);`;
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(source);
    const select = async text => {
      await page.evaluate(text => {
        const editor = window.alignmentTest.codeEditor.editor,
          model = editor.getModel();
        editor.setPosition(
          model.getPositionAt(model.getValue().indexOf(text) + 2),
        );
        editor.focus();
      }, text);
    };
    await select('offset(0,0,8)');
    await page.locator('[data-parameter=z]').waitFor();
    await page.waitForFunction(
      () =>
        window.alignmentTest.viewport.sourceEvaluation()?.evaluation
          .constraintId,
    );
    const inspect = () =>
      page.evaluate(() => {
        const viewport = window.alignmentTest.viewport,
          markers = [];
        viewport.decorationRoot.traverse(object => {
          const decoration = object.userData.decoration;
          if (decoration?.arrowStyle) {
            let arrows = 0;
            object.traverse(child => {
              if (child.type === 'ArrowHelper') arrows++;
            });
            markers.push({
              style: decoration.arrowStyle,
              curve: !!decoration.arrowOnly,
              arrows,
              position: decoration.transform.position,
              direction: decoration.direction,
            });
          }
        });
        return markers;
      });
    const curves = await inspect();
    assert.equal(curves.length, 2);
    assert.deepEqual(curves.map(m => m.style).sort(), ['outline', 'solid']);
    assert.ok(curves.every(m => m.curve && m.arrows === 1));
    if (process.env.CODE3D_TEST_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_TEST_SCREENSHOT});
    const z = page.locator('[data-parameter=z]');
    await z.fill('16');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      window.alignmentTest.codeEditor.editor
        .getValue()
        .replace(/\s/g, '')
        .includes('offset(0,0,16)'),
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() =>
      window.alignmentTest.codeEditor.editor
        .getValue()
        .replace(/\s/g, '')
        .includes('offset(0,0,8)'),
    );
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() =>
      window.alignmentTest.codeEditor.editor
        .getValue()
        .replace(/\s/g, '')
        .includes('offset(0,0,16)'),
    );
    await select('self.align(axis');
    await page.waitForFunction(() => {
      const vp = window.alignmentTest.viewport,
        scope = vp.sourceEvaluation();
      const owner = scope?.evaluation.constraintOwnerNodeId;
      return vp.module?.objects
        .get(owner)
        ?.constraints.some(c => c.targetElement.name === 'axis');
    });
    const axes = await inspect();
    assert.equal(axes.length, 2);
    assert.ok(axes.every(m => m.arrows === 1));
    assert.ok(axes.some(m => !m.curve && m.direction === -1));
    assert.deepEqual(errors, []);
  },
);
