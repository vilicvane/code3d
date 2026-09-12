import assert from 'node:assert/strict';
import {after, before, test, type TestContext} from 'node:test';
import {chromium, type Browser, type Page} from 'playwright-core';
import {previewOperations} from '../../src/ui/viewport-empty-state.ts';

declare const window: Window & {
  emptyViewportApp: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
    previewState: import('../../src/model/preview-state.ts').ModelPreviewState;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
    runModel: () => Promise<void>;
    previousModule?: import('../../src/model/compiler.ts').ModelModule | null;
  };
};

let browser: Browser;
before(async () => {
  assert.ok(process.env.CODE3D_TEST_URL);
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

async function open(
  t: TestContext,
  source = '// Choose a preview',
  state: 'ready' | 'error' = 'ready',
): Promise<Page> {
  const context = await browser.newContext({
    viewport: {width: 1400, height: 900},
    reducedMotion: 'reduce',
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/src/project/default-project.ts*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const defaultProject = ${JSON.stringify({files: [{path: '/model.ts', source}]})};`,
    }),
  );
  // Unrelated example design contexts used to mask empty-program failures.
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
        '\nwindow.emptyViewportApp = {codeEditor, viewport, compiler, runModel, previewState};\n',
    });
  });
  await page.goto(process.env.CODE3D_TEST_URL!);
  await page
    .locator(`#viewport-status[data-state="${state}"]`)
    .waitFor({timeout: 40_000});
  return page;
}

async function select(page: Page, text: string): Promise<void> {
  await page.evaluate(text => {
    const editor = window.emptyViewportApp.codeEditor.editor;
    const model = editor.getModel()!;
    const offset = model.getValue().indexOf(text);
    if (offset < 0) throw new Error(`Missing source selection: ${text}`);
    editor.setPosition(model.getPositionAt(offset + 1));
    editor.focus();
  }, text);
}

async function setSource(
  page: Page,
  source: string,
  selection: string,
  state = 'ready',
): Promise<void> {
  await page.evaluate(source => {
    const app = window.emptyViewportApp;
    app.previousModule = app.viewport['module'];
    app.codeEditor.editor.getModel()!.setValue(source);
  }, source);
  await select(page, selection);
  await page.waitForFunction(
    state =>
      (state === 'error'
        ? !!window.emptyViewportApp.previewState.diagnostic
        : window.emptyViewportApp.viewport['module'] !==
          window.emptyViewportApp.previousModule) &&
      document.querySelector('#viewport-status')?.getAttribute('data-state') ===
        state,
    state,
  );
}

async function expectEmpty(page: Page): Promise<void> {
  await page.locator('#viewport-empty-state').waitFor();
  assert.equal(await page.locator('.viewport-canvas').isVisible(), false);
  assert.equal(await page.locator('.sketch-editor').isVisible(), false);
  assert.equal(await page.locator('.viewport-mode').isVisible(), false);
  assert.equal(
    await page.locator('.viewport-coordinate-reference').isVisible(),
    false,
  );
  assert.equal(await page.locator('.viewport-dock-panels').isVisible(), false);
  assert.equal(
    await page.evaluate(() => window.emptyViewportApp.viewport.getSelected()),
    undefined,
  );
}

test('an empty file opens ready and recovers from errors without a model', async t => {
  const page = await open(t, '');
  await expectEmpty(page);
  assert.equal(await page.locator('#error-bar').isVisible(), false);
  for (const source of [
    'throw new Error("unfinished model");',
    "import {box} from '@code3d/core'; box(0);",
  ]) {
    await setSource(page, source, '', 'error');
    assert.ok(
      await page.evaluate(
        () => window.emptyViewportApp.previewState.diagnostic,
      ),
    );
    await setSource(page, '', '');
    await expectEmpty(page);
    assert.equal(await page.locator('#error-bar').isVisible(), false);
    assert.equal(
      await page.locator('#viewport-diagnostic-stack').isVisible(),
      false,
    );
  }
});

test('clearing a previewed model removes its geometry without reporting an error', async t => {
  const page = await open(
    t,
    "import {box} from '@code3d/core'; box(10, 10, 10);",
  );
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.viewport.hasRenderableGeometry(),
    ),
    true,
  );
  await setSource(page, '', '');
  assert.equal(await page.locator('#error-bar').isVisible(), false);
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.viewport.hasRenderableGeometry(),
    ),
    false,
  );
  assert.equal(
    await page.evaluate(() => window.emptyViewportApp.viewport.getSelected()),
    undefined,
  );
  // The initial hint stays dismissed until another file is opened.
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), false);
});

test('switching to a syntactically broken file clears the previous preview when the error arrives', async t => {
  const page = await open(
    t,
    "import {box} from '@code3d/core'; box(10, 6, 8);",
  );
  await select(page, 'box(10');
  await page.locator('[data-parameter=x]').waitFor();
  const retained = await page.evaluate(() => {
    const {codeEditor, viewport} = window.emptyViewportApp;
    const previous = viewport['module'];
    codeEditor.createFile('/broken.ts', 'const unfinished = ;');
    return {
      geometry: viewport.hasRenderableGeometry(),
      sameModule: viewport['module'] === previous,
    };
  });
  assert.deepEqual(retained, {geometry: true, sameModule: true});
  await page.locator('#viewport-status[data-state=error]').waitFor();
  await expectEmpty(page);
  assert.equal(await page.locator('[data-parameter=x]').isVisible(), false);
  await page.evaluate(() =>
    window.emptyViewportApp.codeEditor.switchFile('/model.ts'),
  );
  await page.locator('#viewport-status[data-state=ready]').waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.viewport.hasRenderableGeometry(),
    ),
    true,
  );
});

test('a same-file syntax error retains the last display until a successful empty result clears it', async t => {
  const source = "import {box} from '@code3d/core'; box(10, 6, 8);";
  const page = await open(t, source);
  await select(page, 'box(10');
  await page.locator('[data-parameter=x]').waitFor();
  await page.evaluate(source => {
    const app = window.emptyViewportApp;
    app.previousModule = app.viewport['module'];
    app.codeEditor.editor
      .getModel()!
      .setValue(source + '\nconst unfinished = ;');
  }, source);
  await page.locator('#viewport-status[data-state=error]').waitFor();
  assert.equal(
    await page.evaluate(() => {
      const app = window.emptyViewportApp;
      return (
        app.viewport['module'] === app.previousModule &&
        app.viewport.hasRenderableGeometry()
      );
    }),
    true,
  );
  assert.equal(await page.locator('[data-parameter=x]').isVisible(), false);
  await setSource(page, '', '');
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.viewport.hasRenderableGeometry(),
    ),
    false,
  );
  assert.equal(await page.locator('#error-bar').isVisible(), false);
});

test('preparation failure without source edits closes stale tools, and replacing the file clears its snapshot', async t => {
  const page = await open(
    t,
    "import {box} from '@code3d/core'; box(10, 6, 8);",
  );
  await select(page, 'box(10');
  await page.locator('[data-parameter=x]').waitFor();
  await page.evaluate(async () => {
    const {compiler, runModel} = window.emptyViewportApp;
    const compile = compiler.compile.bind(compiler);
    compiler.compile = async () => {
      throw new Error('Project preparation failed');
    };
    try {
      await runModel();
    } finally {
      compiler.compile = compile;
    }
  });
  assert.equal(await page.locator('[data-parameter=x]').isVisible(), false);
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.viewport.hasRenderableGeometry(),
    ),
    true,
  );
  assert.equal(
    await page.locator('#viewport-status').getAttribute('data-state'),
    'error',
  );
  const cleared = await page.evaluate(() => {
    const {codeEditor, viewport} = window.emptyViewportApp;
    codeEditor.replaceDirectory(
      {files: [{path: '/model.ts', source: 'const incomplete = ;'}]},
      '/',
    );
    return viewport.hasRenderableGeometry();
  });
  assert.equal(cleared, false);
  await page.locator('#viewport-status[data-state=error]').waitFor();
  await expectEmpty(page);
});

test('a failed tool call reveals the viewport before any geometry has been rendered', async t => {
  const page = await open(
    t,
    "import {box} from '@code3d/core';\nbox(0);",
    'error',
  );
  await expectEmpty(page);
  await select(page, 'box(0)');
  const x = page.locator('[data-parameter=x]');
  await x.waitFor();
  assert.equal(await x.inputValue(), '0');
  assert.equal(await x.isEnabled(), true);
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), false);
  assert.equal(await page.locator('.viewport-canvas').isVisible(), true);
  assert.equal(await page.locator('.viewport-mode').isVisible(), true);
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.viewport.hasRenderableGeometry(),
    ),
    false,
  );
  await x.fill('10');
  await x.press('Enter');
  await page.locator('#viewport-status[data-state=ready]').waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.viewport.hasRenderableGeometry(),
    ),
    true,
  );
});

test('a fresh incomplete primitive previews defaults without filling source or relaxing its signature', async t => {
  const source = "import {box} from '@code3d/core';\nbox();";
  const page = await open(t, source);
  await select(page, 'box()');
  const x = page.locator('[data-parameter=x]');
  await x.waitFor();
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), false);
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.viewport.hasRenderableGeometry(),
    ),
    true,
  );
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.codeEditor.hasLanguageError(),
    ),
    true,
  );
  for (const name of ['x', 'y', 'z']) {
    const input = page.locator(`[data-parameter=${name}]`);
    assert.equal(await input.inputValue(), '');
    assert.equal(await input.getAttribute('placeholder'), '10');
    assert.equal(await input.isEnabled(), name === 'x');
  }
  await x.focus();
  await x.press('Enter');
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.codeEditor.editor.getValue(),
    ),
    source,
  );
  await x.fill('10');
  await x.press('Tab');
  await page.waitForFunction(
    () => (document.activeElement as HTMLElement)?.dataset.parameter === 'y',
  );
  assert.match(
    await page.evaluate(() =>
      window.emptyViewportApp.codeEditor.editor.getValue(),
    ),
    /box\(10\)/,
  );
});

async function expectDefaults(
  page: Page,
  defaults: Readonly<Record<string, number>>,
) {
  const names = Object.keys(defaults);
  await page.locator(`[data-parameter=${names[0]}]`).waitFor();
  for (const [index, name] of names.entries()) {
    const input = page.locator(`[data-parameter=${name}]`);
    assert.equal(await input.inputValue(), '', name);
    assert.equal(
      await input.getAttribute('placeholder'),
      String(defaults[name]),
      name,
    );
    assert.equal(await input.isEnabled(), index === 0, name);
  }
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.viewport.hasRenderableGeometry(),
    ),
    true,
  );
}

test('incomplete object rotation previews defaults and only writes explicitly entered angles', async t => {
  const source = "import {box} from '@code3d/core';\nbox(20, 30, 40).rotate();";
  const page = await open(t, source);
  await select(page, 'rotate()');
  await expectDefaults(page, {x: 0, y: 0, z: 0});
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.codeEditor.hasLanguageError(),
    ),
    true,
  );
  const x = page.locator('[data-parameter=x]');
  await x.focus();
  await x.press('Enter');
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.codeEditor.editor.getValue(),
    ),
    source,
  );
  await x.fill('0');
  await x.press('Tab');
  await page.waitForFunction(
    () => (document.activeElement as HTMLElement)?.dataset.parameter === 'y',
  );
  const y = page.locator('[data-parameter=y]');
  await y.fill('30');
  await y.press('Enter');
  await page.waitForFunction(() =>
    /\.rotate\(0,\s*30\)/.test(
      window.emptyViewportApp.codeEditor.editor.getValue(),
    ),
  );
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    source => window.emptyViewportApp.codeEditor.editor.getValue() === source,
    source,
  );
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLInputElement>('[data-parameter=x]')
        ?.disabled === false,
  );
  await expectDefaults(page, {x: 0, y: 0, z: 0});
});

test('model method defaults appear for groups and geometry operations without rewriting source', async t => {
  const page = await open(t);
  for (const [expression, selection, defaults] of [
    ['group([box(20, 30, 40)]).rotate()', 'rotate()', {x: 0, y: 0, z: 0}],
    [
      'group([box(20, 30, 40)]).originOffset()',
      'originOffset()',
      {dx: 0, dy: 0, dz: 0},
    ],
    ['box(20, 30, 40).scaled()', 'scaled()', {factor: 1}],
    ['rectangle(20, 30).extrude()', 'extrude()', {distance: 10}],
    ['extrude(rectangle(20, 30))', 'extrude(rectangle', {distance: 10}],
    ['box(20, 30, 40).fillet()', 'fillet()', {radius: 1}],
    ['box(20, 30, 40).chamfer()', 'chamfer()', {distance: 1}],
    ['box(20, 30, 40).shell()', 'shell()', {thickness: 1}],
  ] as const) {
    const source = `import {box, group, rectangle, extrude} from '@code3d/core';\n${expression};`;
    await setSource(page, source, selection);
    await expectDefaults(page, defaults);
    const input = page.locator(`[data-parameter=${Object.keys(defaults)[0]}]`);
    await input.focus();
    await input.press('Enter');
    assert.equal(
      await page.evaluate(() =>
        window.emptyViewportApp.codeEditor.editor.getValue(),
      ),
      source,
    );
  }
});

test('constraint method defaults are available on offset, pivot and rotation chains', async t => {
  const page = await open(t);
  for (const [chain, selection, defaults] of [
    ['offset()', 'offset()', {x: 0, y: 0, z: 0}],
    ['rotate()', 'rotate()', {x: 0, y: 0, z: 0}],
    ['pivot().rotate(0, 0, 25)', 'pivot()', {x: 0, y: 0, z: 0}],
    ['pivot([1, 2, 3]).rotate()', 'rotate()', {x: 0, y: 0, z: 0}],
    ['pivotVertex(1).rotate()', 'rotate()', {x: 0, y: 0, z: 0}],
    ['around(base.axis).rotate()', 'rotate()', {angle: 0}],
  ] as const) {
    const source = `import {box, group} from '@code3d/core';\nconst base = box(20, 30, 40);\nconst part = box(4, 6, 8).relate(self => self.on(base.up).${chain});\ngroup([base, part]);`;
    await setSource(page, source, selection);
    await expectDefaults(page, defaults);
    const input = page.locator(`[data-parameter=${Object.keys(defaults)[0]}]`);
    await input.focus();
    await input.press('Enter');
    assert.equal(
      await page.evaluate(() =>
        window.emptyViewportApp.codeEditor.editor.getValue(),
      ),
      source,
    );
    if (chain === 'pivot().rotate(0, 0, 25)') {
      await input.fill('2');
      await input.press('Tab');
      await page.waitForFunction(
        () =>
          (document.activeElement as HTMLElement)?.dataset.parameter === 'y',
      );
      const y = page.locator('[data-parameter=y]');
      await y.fill('0');
      await y.press('Tab');
      await page.waitForFunction(
        () =>
          (document.activeElement as HTMLElement)?.dataset.parameter === 'z',
      );
      const z = page.locator('[data-parameter=z]');
      await z.fill('5');
      await z.press('Enter');
      await page.waitForFunction(() =>
        /\.pivot\(\[2,\s*0,\s*5\]\)/.test(
          window.emptyViewportApp.codeEditor.editor.getValue(),
        ),
      );
      await page.keyboard.press('Control+z');
      await page.waitForFunction(
        source =>
          window.emptyViewportApp.codeEditor.editor.getValue() === source,
        source,
      );
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLInputElement>('[data-parameter=x]')
            ?.disabled === false,
      );
      await expectDefaults(page, defaults);
    }
  }
});

test('the initial hint disappears after previewing and moving the cursor preserves the last 3D view', async t => {
  const page = await open(t);
  await expectEmpty(page);
  assert.equal(
    await page.locator('#viewport-empty-state strong').innerText(),
    'Select to preview',
  );
  assert.equal(await page.locator('#viewport-empty-state p').count(), 0);
  await setSource(
    page,
    `import {box} from '@code3d/core';
const body = box(24, 30, 20);
// No target here`,
    '// No target',
  );
  // The compiler still automatically previews its last model when no source target is focused.
  await page.locator('.viewport-canvas').waitFor();
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), false);
  await select(page, 'body =');
  await page.locator('.viewport-canvas').waitFor();
  await page.getByRole('button', {name: 'Render', exact: true}).click();
  await page.evaluate(() => {
    const viewport = window.emptyViewportApp.viewport;
    viewport['camera'].position.set(60, 40, 80);
    viewport['controls'].syncCamera();
  });
  const before = await page.evaluate(() => {
    const viewport = window.emptyViewportApp.viewport;
    return {
      key: viewport.getSelected()!.key,
      nodeId: viewport.getSelected()!.node.nodeId,
      camera: viewport['camera'].position.toArray(),
    };
  });
  await select(page, '// No target');
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), false);
  assert.equal(await page.locator('.viewport-canvas').isVisible(), true);
  assert.deepEqual(
    await page.evaluate(() => {
      const viewport = window.emptyViewportApp.viewport;
      return {
        key: viewport.getSelected()!.key,
        nodeId: viewport.getSelected()!.node.nodeId,
        camera: viewport['camera'].position.toArray(),
      };
    }),
    before,
  );
  assert.equal(
    await page
      .getByRole('button', {name: 'Render', exact: true})
      .getAttribute('aria-pressed'),
    'true',
  );
});

test('an empty sketch dismisses the hint for that file and a new file gets its own hint', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const profile = sketch([]);
// No target here`,
  );
  await expectEmpty(page);
  await select(page, 'profile =');
  await page.getByRole('region', {name: 'Sketch editor'}).waitFor();
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), false);
  assert.equal(
    await page.getByRole('button', {name: 'Line', exact: true}).isEnabled(),
    true,
  );
  await select(page, '// No target');
  await page.locator('.sketch-editor').waitFor({state: 'hidden'});
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), false);
  await page.evaluate(() => {
    const app = window.emptyViewportApp;
    app.previousModule = app.viewport['module'];
    app.codeEditor.createFile('/empty.ts', '// No target');
  });
  await page.waitForFunction(
    () =>
      window.emptyViewportApp.viewport['module'] !==
        window.emptyViewportApp.previousModule &&
      document.querySelector('#viewport-status')?.getAttribute('data-state') ===
        'ready',
  );
  await expectEmpty(page);
});

test('creating an empty file after a 3D preview shows the hint and switching files resets it', async t => {
  const page = await open(
    t,
    "import {box} from '@code3d/core';\nbox(20, 20, 20);",
  );
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), false);
  await page.evaluate(() => {
    const app = window.emptyViewportApp;
    app.previousModule = app.viewport['module'];
  });
  await page.getByRole('button', {name: 'New file', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'New file', exact: true});
  await dialog.getByRole('textbox', {name: 'Name'}).fill('new.ts');
  await dialog.getByRole('button', {name: 'Create', exact: true}).click();
  await page.waitForFunction(
    () =>
      window.emptyViewportApp.codeEditor.currentFile() === '/new.ts' &&
      window.emptyViewportApp.viewport['module'] !==
        window.emptyViewportApp.previousModule &&
      document.querySelector('#viewport-status')?.getAttribute('data-state') ===
        'ready',
  );
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), true);
  await expectEmpty(page);

  await page.evaluate(() =>
    window.emptyViewportApp.codeEditor.switchFile('/model.ts'),
  );
  await page.waitForFunction(
    () =>
      window.emptyViewportApp.viewport.hasRenderableGeometry() &&
      document.querySelector('#viewport-status')?.getAttribute('data-state') ===
        'ready',
  );
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), false);

  await page.evaluate(() =>
    window.emptyViewportApp.codeEditor.switchFile('/new.ts'),
  );
  await page.waitForFunction(
    () =>
      !window.emptyViewportApp.viewport.hasRenderableGeometry() &&
      document.querySelector('#viewport-status')?.getAttribute('data-state') ===
        'ready',
  );
  await expectEmpty(page);
});

test('the initial hint fits narrow viewports and geometry of every dimension dismisses it', async t => {
  const page = await open(
    t,
    "import {group} from '@code3d/core';\nconst empty = group([]);",
  );
  await page.locator('#viewport-empty-state').waitFor();
  for (const width of [1400, 960, 680]) {
    await page.setViewportSize({width, height: 900});
    const layout = await page.evaluate(() => {
      const host = document
        .querySelector('#viewport-host')!
        .getBoundingClientRect();
      const prompt = document
        .querySelector('#viewport-empty-state')!
        .getBoundingClientRect();
      const animation = document
        .querySelector('.viewport-preview-selection')!
        .getBoundingClientRect();
      return {
        centered:
          Math.abs(
            (prompt.left + prompt.right) / 2 - (host.left + host.right) / 2,
          ) < 1,
        fits: animation.left >= host.left && animation.right <= host.right,
        pageFits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    assert.deepEqual(layout, {centered: true, fits: true, pageFits: true});
  }
  await setSource(
    page,
    `import {group, rectangle, line, point} from '@code3d/core';
const empty = group([]);
const face = rectangle(10, 20);
const edge = line([0, 0, 0], [10, 0, 0]);
const vertex = point([0, 0, 0]);`,
    'empty =',
  );
  for (const target of ['face =', 'edge =', 'vertex =']) {
    await select(page, target);
    await page.locator('.viewport-canvas').waitFor();
    assert.equal(
      await page.locator('#viewport-empty-state').isVisible(),
      false,
    );
  }
  await setSource(page, 'const scalar = 42;', 'scalar');
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), false);
});

test('an exported initial model keeps its existing automatic preview', async t => {
  const page = await open(
    t,
    "import {box} from '@code3d/core';\nexport default box(20, 20, 20);",
  );
  await page.locator('.viewport-canvas').waitFor();
  assert.equal(await page.locator('#viewport-empty-state').isVisible(), false);
  assert.equal(
    await page.evaluate(() =>
      window.emptyViewportApp.viewport.hasRenderableGeometry(),
    ),
    true,
  );
});

test('the animation preserves selection timing and visits the hint vocabulary after model and sketch', async t => {
  const page = await open(t);
  const catalog = previewOperations;
  assert.equal(
    await page.locator('.viewport-preview-text').textContent(),
    'model',
  );
  assert.equal(
    await page
      .locator('.viewport-preview-selection')
      .evaluate(element => element.getAnimations({subtree: true}).length),
    0,
  );
  await page.emulateMedia({reducedMotion: 'no-preference'});
  const sample = (time: number) =>
    page.evaluate(async time => {
      const selection = document.querySelector('.viewport-preview-selection')!;
      for (const animation of selection.getAnimations({subtree: true})) {
        animation.pause();
        animation.currentTime =
          (animation as CSSAnimation).animationName === 'viewport-preview-blink'
            ? 0
            : time;
      }
      // CSS iteration events advance the word on the rendering timeline.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const word = selection.querySelector<HTMLElement>(
        '.viewport-preview-word',
      )!;
      const text = word.querySelector('.viewport-preview-text')!;
      const caret = word.querySelector('.viewport-preview-caret')!;
      const bounds = word.getBoundingClientRect();
      const caretBounds = caret.getBoundingClientRect();
      return {
        word: text.textContent,
        width: bounds.width,
        textWidth: text.getBoundingClientRect().width,
        highlightWidth: parseFloat(getComputedStyle(word, '::before').width),
        caret: caretBounds.x + caretBounds.width / 2 - bounds.x,
      };
    }, time);
  const near = (a: number, b: number) =>
    assert.ok(Math.abs(a - b) < 0.1, `${a} ≈ ${b}`);
  const selected = await sample(0);
  assert.equal(selected.word, 'model');
  near(selected.highlightWidth, selected.width);
  near(selected.caret, selected.width);
  for (const time of [861, 1179]) {
    const blank = await sample(time);
    assert.equal(blank.textWidth, 0);
    assert.equal(blank.highlightWidth, 0);
    near(blank.caret, 0);
  }
  const typing = await sample(1541);
  assert.equal(typing.word, 'sketch');
  near(typing.textWidth, typing.width / 2);
  near(typing.caret, typing.textWidth);
  assert.equal(typing.highlightWidth, 0);
  for (const time of [1901, 2499]) {
    const waiting = await sample(time);
    near(waiting.textWidth, waiting.width);
    near(waiting.caret, waiting.width);
    assert.equal(waiting.highlightWidth, 0);
  }
  for (const time of [2501, 3359]) {
    const selected = await sample(time);
    near(selected.highlightWidth, selected.width);
    near(selected.caret, selected.width);
  }
  const seen: string[] = [];
  const longest = catalog.reduce((a, b) => (a.length > b.length ? a : b));
  for (let index = 0; index < catalog.length; index++) {
    const operation = await sample((index + 2) * 2500 + 1);
    seen.push(operation.word!);
    near(operation.highlightWidth, operation.width);
    near(operation.caret, operation.width);
    if (operation.word === longest) {
      for (const width of [680, 960, 1400]) {
        await page.setViewportSize({width, height: 900});
        assert.ok(
          await page
            .locator('.viewport-preview-selection')
            .evaluate(element => {
              const word = element.getBoundingClientRect();
              const host = document
                .querySelector('#viewport-host')!
                .getBoundingClientRect();
              return word.left >= host.left && word.right <= host.right;
            }),
        );
      }
    }
  }
  assert.deepEqual(seen.sort(), [...catalog].sort());
  assert.equal((await sample((catalog.length + 2) * 2500 + 1)).word, 'model');
  assert.equal((await sample((catalog.length + 3) * 2500 + 1)).word, 'sketch');
  await setSource(
    page,
    "import {box} from '@code3d/core';\nbox(10, 10, 10);",
    'box(10',
  );
  assert.equal(
    await page
      .locator('.viewport-preview-selection')
      .evaluate(element => element.getAnimations({subtree: true}).length),
    0,
  );
});

test('Model error shows details and navigates to the source across files with mouse and keyboard', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    const {codeEditor} = window.emptyViewportApp;
    codeEditor.createFile(
      '/fault.ts',
      "import {box} from '@code3d/core';\nexport const part = box(0);",
    );
    codeEditor.switchFile('/model.ts');
    codeEditor.editor
      .getModel()!
      .setValue("import {part} from './fault';\nexport default part;");
  });
  const status = page.locator('#viewport-status');
  for (const key of ['click', 'Enter', 'Space']) {
    if (key !== 'click') {
      await page.evaluate(() =>
        window.emptyViewportApp.codeEditor.switchFile('/model.ts'),
      );
    }
    await page.waitForFunction(
      () =>
        window.emptyViewportApp.previewState.statusDiagnostic?.sourceRef
          ?.file === '/fault.ts',
    );
    assert.equal(await status.getAttribute('role'), 'button');
    const message = await page.evaluate(
      () => window.emptyViewportApp.previewState.statusDiagnostic!.summary,
    );
    assert.ok((await status.getAttribute('title'))?.includes(message));
    if (key === 'click') await status.click();
    else {
      await status.focus();
      await status.press(key);
    }
    await page.waitForFunction(
      () => window.emptyViewportApp.codeEditor.currentFile() === '/fault.ts',
    );
    const selection = await page.evaluate(() => {
      const {editor} = window.emptyViewportApp.codeEditor;
      return {
        focused: editor.hasTextFocus(),
        text: editor.getModel()!.getValueInRange(editor.getSelection()!),
      };
    });
    assert.equal(selection.focused, true);
    assert.match(selection.text, /box\(0\)/);
  }
  await page.evaluate(() => {
    const {editor} = window.emptyViewportApp.codeEditor;
    editor
      .getModel()!
      .setValue(
        "import {box} from '@code3d/core';\nexport const part = box(10);",
      );
  });
  await page.getByText('Ready', {exact: true}).waitFor();
  assert.equal(await status.getAttribute('title'), null);
  assert.equal(await status.getAttribute('role'), 'status');
  assert.equal(await status.getAttribute('tabindex'), null);
});

test('Model error without a source shows details but has no navigation target', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    const {previewState} = window.emptyViewportApp;
    previewState.fail({
      kind: 'project',
      summary: 'Preparation failed',
      details: 'Package unavailable',
    });
    previewState.showStatus('error', 'Model error');
  });
  const status = page.locator('#viewport-status');
  assert.equal(
    await status.getAttribute('title'),
    'Preparation failed\n\nPackage unavailable',
  );
  assert.equal(await status.getAttribute('role'), 'status');
  assert.equal(await status.getAttribute('tabindex'), null);
  await status.click();
  assert.equal(
    await page.evaluate(() => window.emptyViewportApp.codeEditor.currentFile()),
    '/model.ts',
  );
  await page.evaluate(() =>
    window.emptyViewportApp.previewState.showStatus('busy'),
  );
  assert.equal(await status.getAttribute('title'), null);
});

test('pending edits hide status and delayed preview phases cannot outlive their run', async t => {
  const page = await open(
    t,
    "import {box} from '@code3d/core'; export default box(10, 10, 10);",
  );
  const warnings: string[] = [];
  page.on('console', message => {
    if (message.text().includes('[MobX]')) warnings.push(message.text());
  });
  const status = page.locator('#viewport-status');
  await page.evaluate(() => {
    const {codeEditor} = window.emptyViewportApp;
    codeEditor.editor.focus();
    codeEditor.editor.setPosition(
      codeEditor.editor.getModel()!.getPositionAt(0),
    );
  });
  await page.keyboard.type(' ');
  assert.equal(await status.isVisible(), false);
  assert.equal(
    await page.evaluate(() => window.emptyViewportApp.previewState.busy),
    true,
  );
  await page.waitForTimeout(100);
  assert.equal(await status.isVisible(), false);
  // Cancel the scheduled edit before driving real observable phase transitions.
  await page.evaluate(() => window.emptyViewportApp.runModel());
  await status.waitFor({state: 'visible'});
  const phase = async (
    value: import('../../src/model/compilation-progress.ts').CompilationPhase,
  ) =>
    page.evaluate(async value => {
      const mobxUrl = '/node_modules/.vite/deps/mobx.js';
      const {runInAction}: typeof import('mobx') = await import(mobxUrl);
      runInAction(() => {
        window.emptyViewportApp.compiler.phase = value;
        window.emptyViewportApp.previewState.beginCompilation();
      });
    }, value);
  await phase('reading-files');
  assert.match(await status.innerText(), /Reading files/);
  assert.match((await status.getAttribute('title'))!, /source files/);
  await phase('preparing-preview');
  assert.equal(await status.isVisible(), false);
  await page.waitForTimeout(100);
  assert.equal(await status.isVisible(), false);
  await page.waitForTimeout(125);
  assert.equal(await status.isVisible(), true);
  assert.match(await status.innerText(), /Preparing preview/);
  await page.screenshot({path: '/tmp/code3d-preparing-preview.png'});
  await phase('reading-files');
  await phase('preparing-preview');
  await page.waitForTimeout(100);
  await page.evaluate(() =>
    window.emptyViewportApp.previewState.showStatus('ready', 'Ready'),
  );
  await page.waitForTimeout(300);
  assert.match(await status.innerText(), /Ready/);
  assert.equal(await status.getAttribute('title'), null);
  await phase('preparing-preview');
  await page.evaluate(() =>
    window.emptyViewportApp.previewState.showStatus('busy'),
  );
  await page.waitForTimeout(300);
  assert.equal(await status.isVisible(), false);
  assert.deepEqual(warnings, []);
});
