import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {chromium, type Page} from 'playwright-core';

declare const window: Window & {
  sketchNavigationApp: {
    sketchEditor: import('../../src/tools/sketch-editor-controller.ts').SketchEditorController;
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
  };
  sketchActivations: boolean[];
};

const source = [
  "import {box, sketch} from '@code3d/core';",
  'export const solid = box(24, 6, 14);',
  'export const huge = box(2400, 600, 1400);',
  "export const small = sketch([['point', 1, [0, 0]], ['point', 2, [10, 0]], ['line', 3, [1, 2]]]);",
  "export const large = sketch([['point', 1, [2000, 1000]], ['point', 2, [4000, 1000]], ['line', 3, [1, 2]]]);",
].join('\n');

async function open(
  t: TestContext,
  reducedMotion: 'reduce' | 'no-preference' = 'no-preference',
) {
  const browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: {width: 1440, height: 1000},
    reducedMotion,
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (
      ['error', 'warning'].includes(message.type()) &&
      /mobx|reaction/i.test(message.text())
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
        '\nwindow.sketchNavigationApp = {sketchEditor, viewport, codeEditor};',
    });
  });
  assert.ok(process.env.CODE3D_TEST_URL);
  await page.goto(process.env.CODE3D_TEST_URL);
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
  await page.evaluate(source => {
    const editor = window.sketchNavigationApp.codeEditor.editor;
    editor.getModel()!.setValue(source);
    editor.setPosition(
      editor.getModel()!.getPositionAt(source.indexOf('small = sketch') + 10),
    );
  }, source);
  await page.locator('.sketch-editor:not([hidden])').waitFor();
  // Other CDP clients can override context media emulation on shared Chrome.
  await page.emulateMedia({reducedMotion});
  assert.equal(
    await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
    reducedMotion === 'reduce',
  );
  return page;
}

async function choose(page: Page, name: string) {
  return page.evaluate(name => {
    const {codeEditor, sketchEditor, viewport} = window.sketchNavigationApp;
    const before = sketchEditor.navigation.pose;
    const editor = codeEditor.editor;
    editor.setPosition(
      editor
        .getModel()!
        .getPositionAt(
          editor.getValue().indexOf(`${name} = `) + name.length + 5,
        ),
    );
    return {
      before,
      after: sketchEditor.navigation.pose,
      sketchAnimation: sketchEditor.navigation['frame'] !== undefined,
      modelAnimation: viewport['controls']['transition'] !== undefined,
    };
  }, name);
}

async function settled(page: Page) {
  await page.waitForFunction(
    () =>
      window.sketchNavigationApp.sketchEditor.navigation['frame'] === undefined,
  );
}

async function pose(page: Page) {
  return page.evaluate(
    () => window.sketchNavigationApp.sketchEditor.navigation.pose,
  );
}

test('sketch switches animate remembered views, preserve edits and yield to wheel and pan', async t => {
  const page = await open(t);
  assert.equal(
    await page.evaluate(
      () => window.sketchNavigationApp.sketchEditor.navigation['frame'],
    ),
    undefined,
  );
  const bounds = await page.locator('.sketch-canvas').boundingBox();
  assert.ok(bounds);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x + 70, y + 60);
  await page.mouse.wheel(0, -500);
  await page.waitForFunction(
    () => window.sketchNavigationApp.sketchEditor.navigation.pose.scale > 20,
  );
  await page.mouse.down({button: 'right'});
  await page.mouse.move(x + 100, y + 90, {steps: 4});
  await page.mouse.up({button: 'right'});
  const small = await pose(page);
  const start = await choose(page, 'large');
  assert.equal(start.sketchAnimation, true);
  assert.deepEqual(start.after, start.before);
  await page.waitForFunction(scale => {
    const nav = window.sketchNavigationApp.sketchEditor.navigation;
    return nav.pose.scale !== scale && nav['frame'] !== undefined;
  }, small.scale);
  const mid = await page.evaluate(() => {
    const nav = window.sketchNavigationApp.sketchEditor.navigation;
    const label = Number(
      document
        .querySelector('.viewport-grid-scale-value')!
        .textContent!.split(' ')[0],
    );
    const x = (id: number) =>
      Number(
        document
          .querySelector(`.sketch-canvas circle.local[data-id="${id}"]`)!
          .getAttribute('cx'),
      );
    return {
      label,
      grid: nav.gridStep,
      scale: nav.pose.scale,
      drawnScale: (x(2) - x(1)) / 2000,
    };
  });
  assert.equal(mid.label, mid.grid);
  assert.ok(Math.abs(mid.drawnScale / mid.scale - 1) < 1e-8);
  await settled(page);
  const large = await pose(page);
  await choose(page, 'small');
  await page.waitForTimeout(80);
  const redirected = await choose(page, 'large');
  assert.deepEqual(redirected.after, redirected.before);
  await page.mouse.wheel(0, 200);
  await settled(page);
  const takenOver = await pose(page);
  await page.waitForTimeout(350);
  assert.deepEqual(await pose(page), takenOver);
  assert.notDeepEqual(takenOver, large);
  await choose(page, 'small');
  await settled(page);
  assert.deepEqual(await pose(page), small);
  await page.evaluate(() => {
    const editor = window.sketchNavigationApp.codeEditor.editor;
    editor
      .getModel()!
      .setValue(editor.getValue().replace('[10, 0]', '[12, 0]'));
    editor.setPosition(
      editor
        .getModel()!
        .getPositionAt(editor.getValue().indexOf('small = sketch') + 10),
    );
  });
  await page.waitForFunction(scale => {
    const x = (id: number) =>
      Number(
        document
          .querySelector(`.sketch-canvas circle.local[data-id="${id}"]`)!
          .getAttribute('cx'),
      );
    return Math.abs((x(2) - x(1)) / scale - 12) < 1e-6;
  }, small.scale);
  assert.deepEqual(await pose(page), small);
  await choose(page, 'large');
  await page.mouse.down({button: 'right'});
  await page.mouse.move(x + 120, y + 120, {steps: 4});
  await page.mouse.up({button: 'right'});
  const panned = await pose(page);
  await page.waitForTimeout(350);
  assert.deepEqual(await pose(page), panned);
  await page.screenshot({path: '/tmp/code3d-123-sketch-navigation.png'});
});

test('crossing 3D/sketch skips animations while same-type switches animate', async t => {
  const page = await open(t);
  await choose(page, 'large');
  await settled(page);
  const remembered = await pose(page);
  assert.equal((await choose(page, 'solid')).modelAnimation, false);
  assert.equal((await choose(page, 'huge')).modelAnimation, true);
  const sketch = await choose(page, 'large');
  assert.equal(sketch.sketchAnimation, false);
  assert.deepEqual(sketch.after, remembered);
  assert.equal((await choose(page, 'small')).sketchAnimation, true);
  assert.equal((await choose(page, 'solid')).modelAnimation, false);
  assert.equal((await choose(page, 'small')).sketchAnimation, false);
});

test('files have independent sketch views and re-enter immediately after empty previews', async t => {
  const page = await open(t);
  const original = await page.evaluate(() => {
    const {codeEditor, sketchEditor} = window.sketchNavigationApp;
    const nav = sketchEditor.navigation;
    nav.zoom(2, [0, 0]);
    nav.pan([7, 11]);
    window.sketchActivations = [];
    Object.defineProperty(nav['clock'], 'requestFrame', {
      value: (callback: (time: number) => void) => {
        window.sketchActivations.push(true);
        return requestAnimationFrame(callback);
      },
    });
    return {file: codeEditor.currentFile()!, pose: nav.pose};
  });
  await page.evaluate(source => {
    window.sketchNavigationApp.codeEditor.createFile('/other.ts', source);
  }, source);
  await choose(page, 'small');
  await page.waitForFunction(() =>
    window.sketchNavigationApp.sketchEditor.navigation['activeKey']?.includes(
      '/other.ts',
    ),
  );
  await settled(page);
  assert.notDeepEqual(await pose(page), original.pose);
  await page.evaluate(() => {
    window.sketchNavigationApp.sketchEditor.navigation.pan([-5, -10]);
    window.sketchNavigationApp.codeEditor.createFile('/empty.ts');
  });
  await page.locator('#viewport-empty-state').waitFor();
  await page.evaluate(() => {
    window.sketchActivations = [];
  });
  await page.evaluate(
    file => window.sketchNavigationApp.codeEditor.openFile(file),
    original.file,
  );
  await page.waitForFunction(
    file =>
      window.sketchNavigationApp.sketchEditor.navigation['activeKey']?.includes(
        file,
      ),
    original.file,
  );
  assert.deepEqual(await pose(page), original.pose);
  assert.deepEqual(await page.evaluate(() => window.sketchActivations), []);
  await choose(page, 'solid');
  await page.evaluate(() =>
    window.sketchNavigationApp.codeEditor.openFile('/empty.ts'),
  );
  await page.locator('#viewport-empty-state').waitFor();
  await page.evaluate(
    file => window.sketchNavigationApp.codeEditor.openFile(file),
    original.file,
  );
  await page.locator('#viewport-empty-state').waitFor({state: 'hidden'});
  assert.equal((await choose(page, 'solid')).modelAnimation, false);
});

test('reduced motion restores sketch views immediately', async t => {
  const page = await open(t, 'reduce');
  const small = await pose(page);
  assert.equal((await choose(page, 'large')).sketchAnimation, false);
  assert.notDeepEqual(await pose(page), small);
  assert.equal((await choose(page, 'small')).sketchAnimation, false);
  assert.deepEqual(await pose(page), small);
});
