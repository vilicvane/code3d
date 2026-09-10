import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {chromium, type Page} from 'playwright-core';

declare const window: Window & {
  filePreview: {
    codeEditor: import('../../src/editor.ts').CodeEditor;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
    viewport: import('../../src/viewport.ts').ModelViewport;
    sketchEditor: import('../../src/tools/sketch-editor-controller.ts').SketchEditorController;
    previewState: import('../../src/model/preview-state.ts').ModelPreviewState;
  };
  pendingCompiles: Array<{file: string; release(): void}>;
  watching: boolean;
  blankFrames: number;
};

const files = [
  {
    path: '/model.ts',
    source:
      "import {box} from '@code3d/core'; export const model = box(10, 6, 8);",
  },
  {
    path: '/other/large.ts',
    source:
      "import {box} from '@code3d/core'; export const model = box(1000, 600, 800);",
  },
  {
    path: '/third/model.ts',
    source:
      "import {box} from '@code3d/core'; export const model = box(30, 20, 10);",
  },
  {
    path: '/context.ts',
    source:
      "import {box} from '@code3d/core';\n/** @code3d.arguments [40] */\nexport function shape(width: number) { return box(width, 20, 30); }",
  },
  {
    path: '/sketch.ts',
    source:
      "import {sketch} from '@code3d/core'; export const model = sketch([['point', 1, [0, 0]], ['point', 2, [10, 0]], ['line', 3, [1, 2]]]);",
  },
  {
    path: '/other/sketch.ts',
    source:
      "import {sketch} from '@code3d/core'; export const model = sketch([['point', 1, [2000, 1000]], ['point', 2, [4000, 1000]], ['line', 3, [1, 2]]]);",
  },
  {path: '/empty.ts', source: ''},
  {path: '/broken.ts', source: 'const unfinished = ;'},
];

async function open(t: TestContext): Promise<Page> {
  const browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: {width: 1440, height: 1000},
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
  await page.route('**/src/project/default-project.ts*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const defaultProject = ${JSON.stringify({files})};`,
    }),
  );
  await page.route('**/src/project/bundled-examples.ts*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export const bundledExamples = {directory: "/examples", revision: "empty", files: []};',
    }),
  );
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.filePreview = {codeEditor, compiler, viewport, sketchEditor, previewState};',
    });
  });
  assert.ok(process.env.CODE3D_TEST_URL);
  await page.goto(process.env.CODE3D_TEST_URL);
  await ready(page);
  await page.emulateMedia({reducedMotion: 'no-preference'});
  return page;
}

async function ready(page: Page) {
  await page
    .locator('#viewport-status[data-state=ready]')
    .waitFor({timeout: 45_000});
}

async function holdCompiles(page: Page) {
  await page.evaluate(() => {
    const compiler = window.filePreview.compiler;
    const compile = compiler.compile.bind(compiler);
    window.pendingCompiles = [];
    compiler.compile = async (...args) => {
      const result = await compile(...args).then(
        module => ({module}),
        (error: unknown) => ({error}),
      );
      await new Promise<void>(release =>
        window.pendingCompiles.push({file: args[1], release}),
      );
      if ('error' in result) throw result.error;
      return result.module;
    };
  });
}

async function switchAndHold(page: Page, file: string) {
  await page.evaluate(async file => {
    const code = window.filePreview.codeEditor;
    await code.openFile(file);
    const model = code.editor.getModel()!;
    const sketch = model.getValue().indexOf('sketch([');
    if (sketch >= 0) code.editor.setPosition(model.getPositionAt(sketch + 1));
  }, file);
  await page.waitForFunction(
    file => window.pendingCompiles.some(pending => pending.file === file),
    file,
  );
}

async function release(page: Page, file: string) {
  await page.evaluate(file => {
    const index = window.pendingCompiles.findIndex(
      pending => pending.file === file,
    );
    window.pendingCompiles.splice(index, 1)[0].release();
  }, file);
}

test('switching between folders retains visible 3D geometry until its replacement is ready', async t => {
  const page = await open(t);
  await holdCompiles(page);
  await page.evaluate(() => {
    window.watching = true;
    window.blankFrames = 0;
    const watch = () => {
      if (!window.watching) return;
      if (
        !window.filePreview.viewport.hasRenderableGeometry() ||
        document.querySelector<HTMLElement>('#viewport-host')!.dataset.empty ===
          'true'
      )
        window.blankFrames++;
      requestAnimationFrame(watch);
    };
    watch();
  });
  await switchAndHold(page, '/other/large.ts');
  const held = await page.evaluate(() => ({
    geometry: window.filePreview.viewport.hasRenderableGeometry(),
    module: window.filePreview.previewState.module,
    inert: document.querySelector<HTMLElement>('.viewport-canvas')!.inert,
    retaining: window.filePreview.previewState.retainingView,
  }));
  assert.deepEqual(held, {
    geometry: true,
    module: null,
    inert: true,
    retaining: true,
  });
  await page.waitForTimeout(200);
  await release(page, '/other/large.ts');
  await ready(page);
  assert.equal(
    await page.evaluate(
      () => window.filePreview.viewport['controls']['transition'] !== undefined,
    ),
    true,
  );
  await page.waitForFunction(
    () => window.filePreview.viewport['controls']['transition'] === undefined,
  );
  await switchAndHold(page, '/context.ts');
  await page.evaluate(() => {
    const code = window.filePreview.codeEditor;
    const model = code.editor.getModel()!;
    code.editor.setPosition(
      model.getPositionAt(model.getValue().indexOf('box(width') + 1),
    );
  });
  await release(page, '/context.ts');
  await page.waitForFunction(() =>
    window.pendingCompiles.some(pending => pending.file === '/context.ts'),
  );
  assert.equal(
    await page.evaluate(() =>
      window.filePreview.viewport.hasRenderableGeometry(),
    ),
    true,
  );
  await release(page, '/context.ts');
  await ready(page);
  const result = await page.evaluate(() => {
    window.watching = false;
    return {
      blankFrames: window.blankFrames,
      inert: document.querySelector<HTMLElement>('.viewport-canvas')!.inert,
    };
  });
  assert.deepEqual(result, {blankFrames: 0, inert: false});
});

test('sketches remain visible through file compilation and empty results replace them with the hint', async t => {
  const page = await open(t);
  await page.evaluate(async () => {
    const code = window.filePreview.codeEditor;
    await code.openFile('/sketch.ts');
    const model = code.editor.getModel()!;
    code.editor.setPosition(
      model.getPositionAt(model.getValue().indexOf('sketch([') + 1),
    );
  });
  await page.locator('.sketch-editor:not([hidden])').waitFor();
  await holdCompiles(page);
  const before = await page.evaluate(
    () => window.filePreview.sketchEditor.navigation.pose,
  );
  await switchAndHold(page, '/other/sketch.ts');
  assert.equal(await page.locator('.sketch-editor').isVisible(), true);
  assert.deepEqual(
    await page.evaluate(() => window.filePreview.sketchEditor.navigation.pose),
    before,
  );
  assert.equal(
    await page
      .locator('.sketch-editor')
      .evaluate(element => (element as HTMLElement).inert),
    true,
  );
  await release(page, '/other/sketch.ts');
  await ready(page);
  assert.equal(
    await page.evaluate(
      () => window.filePreview.sketchEditor.navigation['frame'] !== undefined,
    ),
    true,
  );
  await page.waitForFunction(
    () => window.filePreview.sketchEditor.navigation['frame'] === undefined,
  );
  await switchAndHold(page, '/empty.ts');
  assert.equal(await page.locator('.sketch-editor').isVisible(), true);
  await release(page, '/empty.ts');
  await ready(page);
  await page.locator('#viewport-empty-state').waitFor();
  assert.equal(await page.locator('.sketch-editor').isVisible(), false);
});

test('rapid switches ignore superseded results and clear retained views on failure or closing all files', async t => {
  const page = await open(t);
  await holdCompiles(page);
  await switchAndHold(page, '/other/large.ts');
  await switchAndHold(page, '/third/model.ts');
  await release(page, '/third/model.ts');
  await ready(page);
  const current = await page.evaluate(() =>
    window.filePreview.viewport['module']!.sourceTargets.map(
      target => target.id,
    ),
  );
  await release(page, '/other/large.ts');
  await page.waitForTimeout(100);
  assert.deepEqual(
    await page.evaluate(() =>
      window.filePreview.viewport['module']!.sourceTargets.map(
        target => target.id,
      ),
    ),
    current,
  );
  await switchAndHold(page, '/broken.ts');
  assert.equal(
    await page.evaluate(() =>
      window.filePreview.viewport.hasRenderableGeometry(),
    ),
    true,
  );
  await release(page, '/broken.ts');
  await page.locator('#viewport-status[data-state=error]').waitFor();
  await page.locator('#viewport-empty-state').waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.filePreview.viewport.hasRenderableGeometry(),
    ),
    false,
  );
  await switchAndHold(page, '/model.ts');
  await page.evaluate(() =>
    window.filePreview.codeEditor.switchFile(undefined),
  );
  await ready(page);
  await release(page, '/model.ts');
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.filePreview.viewport['module']),
    null,
  );
});
