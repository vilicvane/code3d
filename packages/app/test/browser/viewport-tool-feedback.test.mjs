import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

async function open(t) {
  const browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
  const context = await browser.newContext({
    viewport: {width: 1440, height: 1000},
  });
  t.after(async () => {
    await context.close();
    await browser.close();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => {
    if (
      /mobx/i.test(message.text()) &&
      /error|warning|action/i.test(message.text())
    )
      errors.push(message.text());
  });
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.feedbackApp = {codeEditor, viewport, sketchEditor, toolEngine, toolFeedback, handlePositionTool, previewState};',
    });
  });
  await page.goto(process.env.CODE3D_TEST_URL, {timeout: 30000});
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 30000});
  return page;
}

async function source(page, value, selected) {
  await page.evaluate(
    ({value, selected}) => {
      const editor = window.feedbackApp.codeEditor.editor;
      editor.getModel().setValue(value);
      editor.setPosition(
        editor.getModel().getPositionAt(value.lastIndexOf(selected) + 1),
      );
    },
    {value, selected},
  );
  await page.waitForFunction(
    () =>
      window.feedbackApp.previewState.sourceVersion ===
      window.feedbackApp.codeEditor.sourceVersion(),
  );
  await page.getByText('Ready', {exact: true}).waitFor();
}
const sketch = `import {sketch} from '@code3d/core';
const profile = sketch([['point',1,[0,0]],['circle',2,[1,8]]]);
profile;`;

async function drag(page) {
  const point = page.locator('.sketch-canvas circle.local[data-id="1"]');
  const box = await point.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 30,
    box.y + box.height / 2 + 20,
    {steps: 4},
  );
}

test(
  'sketch reports failed drags only on release, cancels silently and clears after success',
  {timeout: 60000},
  async t => {
    const page = await open(t);
    await source(page, sketch, 'profile;');
    await page.locator('.sketch-editor').waitFor();
    const error = page.locator('.viewport-tool-error');
    await page.evaluate(() => {
      const editor = window.feedbackApp.sketchEditor.editor;
      window.originalSolve = editor.solve;
      editor.solve = async () => {
        throw new Error('Test drag failed');
      };
    });
    await drag(page);
    await page.waitForFunction(
      () => window.feedbackApp.sketchEditor.editor.gesture?.error,
    );
    assert.equal(await error.isVisible(), false);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(await error.isVisible(), false);
    await drag(page);
    await page.waitForFunction(
      () => window.feedbackApp.sketchEditor.editor.gesture?.error,
    );
    await page.mouse.up();
    await error.waitFor();
    assert.match(await error.innerText(), /Test drag failed/);
    assert.equal(await page.locator('#error-bar').isVisible(), false);
    assert.equal(
      await page.evaluate(() =>
        window.feedbackApp.codeEditor.editor.getValue(),
      ),
      sketch,
    );
    const scale = await page.locator('.viewport-grid-scale').boundingBox();
    const errorBox = await error.boundingBox();
    assert.ok(errorBox.y + errorBox.height <= scale.y);
    await page.screenshot({path: '/tmp/code3d-143-error.png'});
    await page.evaluate(() => {
      const editor = window.feedbackApp.sketchEditor.editor;
      editor.solve = window.originalSolve;
    });
    await drag(page);
    await page.mouse.up();
    await error.waitFor({state: 'hidden'});
    await page.waitForFunction(
      value => window.feedbackApp.codeEditor.editor.getValue() !== value,
      sketch,
    );
  },
);

test(
  '3D preview failures wait for release and share dismissible feedback',
  {timeout: 60000},
  async t => {
    const page = await open(t);
    await source(
      page,
      "import {box,group} from '@code3d/core'; const base=box(20,2,20); const part=box(4,4,4).relate(self=>self.on(base.up)); export default group([base,part]);",
      'part]',
    );
    await page.waitForFunction(() =>
      window.feedbackApp.viewport.transformGizmo.axes.some(c => c.binding),
    );
    await page.evaluate(() => {
      const app = window.feedbackApp;
      window.binding = app.viewport.transformGizmo.axes.find(
        c => c.binding?.mode === 'translate',
      ).binding;
      window.originalResolve = app.toolEngine.resolve;
      app.toolEngine.resolve = () => ({
        status: 'conflict',
        reason: 'Test source conflict',
      });
      app.handlePositionTool({
        kind: 'begin',
        binding: window.binding,
        value: 0,
      });
      app.handlePositionTool({
        kind: 'preview',
        binding: window.binding,
        value: 3,
      });
    });
    const error = page.locator('.viewport-tool-error');
    assert.equal(await error.isVisible(), false);
    await page.evaluate(() => {
      const app = window.feedbackApp;
      app.handlePositionTool({
        kind: 'cancel',
        binding: window.binding,
        value: 3,
      });
    });
    assert.equal(await error.isVisible(), false);
    await page.evaluate(() => {
      const app = window.feedbackApp;
      for (let i = 0; i < 2; i++) {
        app.handlePositionTool({
          kind: 'begin',
          binding: window.binding,
          value: 0,
        });
        app.handlePositionTool({
          kind: 'preview',
          binding: window.binding,
          value: 3,
        });
        app.handlePositionTool({
          kind: 'commit',
          binding: window.binding,
          value: 3,
        });
      }
    });
    await error.waitFor();
    assert.equal(await error.count(), 1);
    assert.match(await error.innerText(), /Test source conflict/);
    assert.equal(await page.locator('#error-bar').isVisible(), false);
    await page.getByRole('button', {name: 'Dismiss tool error'}).click();
    assert.equal(await error.isVisible(), false);
    await page.evaluate(() => {
      window.feedbackApp.toolEngine.resolve = window.originalResolve;
    });
  },
);

test(
  'sketch arguments switch evaluated geometry and read-only sketches have no status banner',
  {timeout: 60000},
  async t => {
    const page = await open(t);
    const code = `import {sketch} from '@code3d/core';
/**
 * @code3d.arguments [4]
 * @code3d.arguments [12]
 */
export function profile(radius:number) {
  return sketch([['point',1,[0,0]],['circle',2,[1,radius]]]);
}`;
    await source(page, code, 'sketch([');
    await page.locator('.sketch-editor').waitFor();
    await page.evaluate(() =>
      window.feedbackApp.viewport.setRenderMode('render'),
    );
    await page.locator('#design-arguments-handle').waitFor();
    assert.equal(await page.locator('#elements-panel').isVisible(), false);
    await page.keyboard.press('Alt+1');
    await page.locator('.design-argument-option').first().waitFor();
    assert.equal(await page.locator('.design-argument-option').count(), 2);
    await page.getByRole('button', {name: /profile\(12\)/}).click();
    await page.waitForFunction(() =>
      window.feedbackApp.sketchEditor.diagnosticScope
        ?.at(-1)
        ?.data.some(e => e.id === 2 && e.parameters.includes(12)),
    );
    await page.getByRole('button', {name: /profile\(4\)/}).click();
    await page.waitForFunction(() =>
      window.feedbackApp.sketchEditor.diagnosticScope
        ?.at(-1)
        ?.data.some(e => e.id === 2 && e.parameters.includes(4)),
    );
    await page.screenshot({path: '/tmp/code3d-143-arguments.png'});
    await source(
      page,
      `import {sketch} from '@code3d/core'; const data = [['point',1,[0,0]],['circle',2,[1,8]]] as const; const result=sketch(data); result;`,
      'result;',
    );
    await page.locator('.sketch-editor').waitFor();
    assert.equal(await page.locator('.sketch-editor output').count(), 0);
    assert.equal(await page.locator('.viewport-tool-error').isVisible(), false);
    assert.equal(
      await page.getByRole('button', {name: 'Trim', exact: true}).isDisabled(),
      true,
    );
  },
);

for (const mode of ['3D', 'sketch']) {
  test(
    `Arguments visibility follows annotated function evaluations in ${mode}`,
    {timeout: 60000},
    async t => {
      const page = await open(t);
      const expression =
        mode === '3D'
          ? 'box(size, 4, 5)'
          : "sketch([['point',1,[0,0]],['circle',2,[1,size]]])";
      const plain =
        mode === '3D'
          ? 'box(2, 3, 4)'
          : "sketch([['point',1,[0,0]],['circle',2,[1,2]]])";
      const annotation = '/** @code3d.arguments [4] */';
      const code = `import {box, sketch} from '@code3d/core';
${annotation}
export function design(size = 6) { return ${expression}; }
const plain = ${plain};
plain;
export default design();`;
      await source(page, code, expression);
      const panel = page.locator('#design-arguments-panel');
      await panel.waitFor({state: 'visible'});
      assert.equal(
        await page.locator('#design-arguments-count').innerText(),
        '1',
      );
      await page.keyboard.press('Alt+1');
      await page.locator('.design-argument-option').waitFor();
      await page.evaluate(() => {
        const editor = window.feedbackApp.codeEditor.editor;
        editor.setPosition(
          editor
            .getModel()
            .getPositionAt(editor.getValue().lastIndexOf('plain;') + 1),
        );
      });
      await panel.waitFor({state: 'hidden'});
      const state = await panel.getAttribute('data-panel-state');
      await page.keyboard.press('Alt+1');
      assert.equal(await panel.getAttribute('data-panel-state'), state);
      assert.equal(await panel.isVisible(), false);
      await source(page, code.replace(annotation, ''), expression);
      await page.waitForFunction(mode => {
        const app = window.feedbackApp;
        return mode === 'sketch'
          ? app.sketchEditor.hasTarget
          : !!app.viewport.getSelected();
      }, mode);
      assert.equal(await panel.isVisible(), false);
      assert.equal(
        await page.locator('#design-arguments-options').innerText(),
        '',
      );
    },
  );
}
