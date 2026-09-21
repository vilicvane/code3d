import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from './browser-connection.ts';
declare const window: Window & {
  alignmentTest: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
  };
};

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
    const errors: string[] = [];
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
    await page.goto(appUrl!, {timeout: 60_000});
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    const source = `import {align, offset, arc, box, group, line} from '@code3d/core';
const base=arc([20,0,0],[0,20,0],[-20,0,0]);
const part=arc([0,20,0],[-20,0,0],[0,-20,0]).relate(self=>[align(self, base), offset(0,0,8)]);
const axis=box(1,1,1);
const rail=line([30,0,0],[30,20,0]).relate(self=>align(self, axis.axis.reverse()));
export default group([base,part,rail]);`;
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(source);
    const select = async (text: string) => {
      await page.evaluate(text => {
        const editor = window.alignmentTest.codeEditor.editor,
          model = editor.getModel();
        editor.setPosition(
          model!.getPositionAt(model!.getValue().indexOf(text) + 2),
        );
        editor.focus();
      }, text);
    };
    await select('self, base');
    await page.waitForFunction(
      () =>
        window.alignmentTest.viewport.sourceContext?.evaluation.constraintId,
    );
    const inspect = () =>
      page.evaluate(async () => {
        const {inspectDirectionMarkers} =
          await import('/test/browser/direction-marker-fixture.ts');
        return inspectDirectionMarkers(
          window.alignmentTest.viewport['decorationRoot'],
        );
      });
    const curves = await inspect();
    assert.equal(curves.length, 2);
    assert.ok(curves.every(m => m.heads.every(h => h.visible)));
    const at = (position: readonly number[], expected: readonly number[]) =>
      position.every((value, i) => Math.abs(value - expected[i]) < 1e-6);
    const sourceMarker = curves.find(m => at(m.position, [0, -20, 0]));
    const targetMarker = curves.find(m => at(m.position, [-20, 0, 0]));
    assert.ok(sourceMarker);
    assert.ok(targetMarker);
    const sourceOpacity = sourceMarker.heads[0].opacity;
    const targetOpacity = targetMarker.heads[0].opacity;
    assert.deepEqual(
      curves.map(m => m.heads[0].size),
      [
        [6, 10],
        [6, 10],
      ],
    );
    assert.ok(sourceOpacity > 0.9);
    assert.ok(targetOpacity > 0 && targetOpacity < sourceOpacity);
    assert.ok(
      curves.every(m => m.curve && m.heads.length === 1 && m.shafts === 0),
    );
    const passiveWidths = await page.evaluate(async () => {
      const {lineWidths} =
        await import('/test/browser/direction-marker-fixture.ts');
      const widths: number[] = [];
      window.alignmentTest.viewport['decorationRoot'].traverse(object => {
        if (object.userData.decoration?.kind === 'edges')
          widths.push(...lineWidths(object));
      });
      return widths;
    });
    assert.deepEqual(passiveWidths, [1, 1]);
    assert.ok(curves.every(m => Math.abs(m.heads[0].tip) < 1e-6));
    const endpoint = targetMarker.position;
    endpoint.forEach((v, i) => assert.ok(Math.abs(v - [-20, 0, 0][i]) < 1e-6));
    if (process.env.CODE3D_TEST_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_TEST_SCREENSHOT});
    await select('offset(0,0,8)');
    const z = page.locator('[data-parameter=z]');
    await z.waitFor();
    await page.waitForFunction(() => {
      const scope = window.alignmentTest.viewport.sourceContext;
      return (
        scope?.target.kind === 'transformation' &&
        !!scope.evaluation.relationOwnerNodeId
      );
    });
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
    await select('self, axis.axis');
    await page.waitForFunction(() => {
      const vp = window.alignmentTest.viewport,
        scope = vp.sourceContext;
      const owner = scope?.evaluation.relationOwnerNodeId;
      return vp['module']?.objects
        .get(owner!)
        ?.constraints.some(c => c.targetElement.name === 'axis');
    });
    const axes = await inspect();
    assert.equal(axes.length, 2);
    assert.ok(axes.every(m => m.heads.length === 1));
    assert.ok(axes.filter(m => m.curve).every(m => m.shafts === 0));
    assert.ok(axes.filter(m => !m.curve).every(m => m.shafts === 1));
    assert.ok(axes.some(m => !m.curve && m.direction === -1));
    const interactiveWidths = await page.evaluate(async () => {
      const {lineWidths} =
        await import('/test/browser/direction-marker-fixture.ts');
      const vp = window.alignmentTest.viewport;
      const selected = vp.getSelected();
      vp.beginTopologySelection(
        selected!.key,
        selected!.node.nodeId,
        'edge',
        false,
      );
      const widths: number[] = [];
      widths.push(...lineWidths(vp['topologySelection']!.guide));
      vp.endTopologySelection();
      return widths;
    });
    assert.deepEqual(interactiveWidths, [2]);
    assert.deepEqual(errors, []);
  },
);
