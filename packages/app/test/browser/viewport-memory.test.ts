import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {chromium, type Page} from './browser-connection.ts';
import {appIsolationHeaders} from '../../build/response-headers.ts';

declare const window: Window & {
  viewportMemoryUi: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
  };
  viewportMemory: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    client: import('../../src/model/compiler-client.ts').ModelCompilerClient;
    source: string;
    file: string;
    module: import('../../src/model/compiler.ts').ModelModule;
  };
};

test(
  'the App restores mode buttons and the selected scene across files and edits',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1400, height: 900},
      reducedMotion: 'reduce',
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export const defaultProject = ${JSON.stringify({
          files: [
            {
              path: '/model.ts',
              source: `import {box, group} from '@code3d/core';\nconst a = box(20, 8, 12).material('#8ed5d1');\nexport const result = group([a]);`,
            },
            {
              path: '/other.ts',
              source: `import {box} from '@code3d/core';\nexport const other = box(80, 80, 80);`,
            },
            {path: '/empty.ts', source: '// Empty file'},
          ],
        })};`,
      }),
    );
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.viewportMemoryUi = {viewport, codeEditor};',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await page.evaluate(() => {
      const {codeEditor} = window.viewportMemoryUi;
      const model = codeEditor.editor.getModel()!;
      codeEditor.editor.setPosition(
        model.getPositionAt(model.getValue().indexOf('a =') + 1),
      );
    });
    await page.waitForFunction(() => {
      const {codeEditor, viewport} = window.viewportMemoryUi;
      return (
        viewport['inspectionSource']?.offset ===
        codeEditor.editor
          .getModel()!
          .getOffsetAt(codeEditor.editor.getPosition()!)
      );
    });
    await page.evaluate(() => {
      const {viewport} = window.viewportMemoryUi;
      const controls = viewport['controls'];
      controls.focus.set(2, 3, 4);
      viewport['camera'].position.set(2, 3, 104);
      viewport['camera'].up.set(0, 1, 0);
      controls.syncCamera();
    });
    await page.locator('#viewport-mode-render').click();
    const original = await uiState(page);
    await switchFile(page, '/other.ts');
    await page
      .locator('#viewport-mode-modeling[aria-pressed="true"]')
      .waitFor();
    await switchFile(page, '/model.ts');
    await page.locator('#viewport-mode-render[aria-pressed="true"]').waitFor();
    nearState(await uiState(page), original);
    await page.evaluate(() => {
      const {codeEditor} = window.viewportMemoryUi;
      const model = codeEditor.editor.getModel()!;
      const start = model.getPositionAt(model.getValue().indexOf('20, 8, 12'));
      codeEditor.editor.executeEdits('test', [
        {
          range: {
            ...start,
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: start.lineNumber,
            endColumn: start.column + 2,
          },
          text: '30',
        },
      ]);
    });
    await page.waitForFunction(() =>
      [
        ...(window.viewportMemoryUi.viewport['module']?.objects.values() ?? []),
      ].some(
        node =>
          node.kind === 'solid' &&
          node.mesh &&
          Math.max(
            ...Array.from(node.mesh.topologyVertices).filter(
              (_, i) => i % 3 === 0,
            ),
          ) === 15,
      ),
    );
    nearState(await uiState(page), original);
    await switchFile(page, '/empty.ts');
    await page.getByText('Select to preview', {exact: true}).waitFor();
    await switchFile(page, '/model.ts');
    nearState(await uiState(page), original);
    if (process.env.CODE3D_VIEWPORT_MEMORY_SCREENSHOT)
      await page.screenshot({
        path: process.env.CODE3D_VIEWPORT_MEMORY_SCREENSHOT,
      });
    assert.deepEqual(errors, []);
  },
);

async function uiState(page: Page) {
  return page.evaluate(() => {
    const {viewport} = window.viewportMemoryUi;
    return {
      distance: viewport['camera'].position.distanceTo(
        viewport['controls'].focus,
      ),
      focus: viewport['controls'].focus.toArray(),
      orientation: viewport['camera'].quaternion.toArray(),
      mode: viewport['rendering'].mode,
      projection: viewport['controls'].capturePose().projection,
      viewHeight: viewport['controls'].capturePose().viewHeight,
    };
  });
}

async function switchFile(page: Page, file: string): Promise<void> {
  await page
    .getByRole('treeitem', {name: file.split('/').at(-1)!, exact: true})
    .click();
  await page.waitForFunction(file => {
    const {viewport, codeEditor} = window.viewportMemoryUi;
    return (
      codeEditor.currentFile() === file &&
      (file === '/empty.ts'
        ? !viewport['module']?.fallback
        : viewport['module']?.catalog.some(
            entry => entry.sourceRef.file === file,
          )) &&
      document.querySelector('#viewport-status')?.getAttribute('data-state') !==
        'busy' &&
      !viewport['controls']['transition']
    );
  }, file);
}

const assembly = `import {on, offset, box, group, point} from '@code3d/core';
const a = box(10, 8, 6).originOffset(-30, 0, 0).relate(self => on(self, point([15,20,30]).up));
const b = box(8, 6, 4).relate(self => [on(self, a.up), offset(0, 5, 0)]);
const members = [a, b];
export const assembled = group(members);
`;

for (const projection of ['perspective', 'orthographic'] as const) {
  test(
    `resized geometry fits while deliberate local views survive in ${projection}`,
    {timeout: 120_000},
    async t => {
      const page = await open(t);
      const source = (size: number) => `import {box} from '@code3d/core';
const body = box(${size}, ${size}, ${size});
const other = box(8, 12, 16);`;
      await load(page, source(20), 'body =');
      if (projection === 'orthographic') {
        await page.evaluate(() => {
          const controls = window.viewportMemory.viewport['controls'];
          const pose = controls.capturePose();
          controls.restorePose({
            ...pose,
            projection: 'orthographic',
            projectionMix: 0,
          });
        });
      }
      const initial = await state(page);
      await load(page, source(200), 'body =');
      const grown = await state(page);
      assert.ok(grown.viewHeight > initial.viewHeight * 5);
      assert.equal(grown.projection, projection);
      grown.orientation.forEach((value, i) =>
        near(value, initial.orientation[i]),
      );
      assert.equal(await fits(page), true);
      assert.equal(
        await localView(page),
        false,
        'Automatic zoom must not record local intent',
      );

      await select(page, 'box(', 4);
      nearState(await state(page), grown);
      await select(page, '200, 200', 6);
      nearState(await state(page), grown);
      await load(page, source(20), 'body =');
      nearState(await state(page), grown);
      await load(page, source(200), 'body =');

      await wheel(page, -1800);
      assert.equal(await fits(page), false);
      assert.equal(await localView(page), true);
      const local = await state(page);
      await load(page, source(300), 'body =');
      nearState(await state(page), local);
      await select(page, 'other =');
      assert.equal(await localView(page), false);
      await select(page, 'body =');
      assert.equal(await localView(page), true);
      nearState(await state(page), local);

      await wheel(page, 2400);
      assert.equal(await fits(page), true);
      assert.equal(await localView(page), false);
      await load(page, source(3000), 'body =');
      assert.equal(await fits(page), true);
      assert.equal(await localView(page), false);

      const canvas = (await page.locator('.viewport-canvas').boundingBox())!;
      await page.mouse.move(
        canvas.x + canvas.width / 2,
        canvas.y + canvas.height / 2,
      );
      await page.mouse.down({button: 'right'});
      await page.mouse.move(
        canvas.x + canvas.width * 1.4,
        canvas.y + canvas.height / 2,
        {steps: 5},
      );
      await page.mouse.up({button: 'right'});
      assert.equal(
        await localView(page),
        true,
        'User panning can deliberately crop the model',
      );
      const panned = await state(page);
      await load(page, source(4000), 'body =');
      nearState(await state(page), panned);
      await page.evaluate(() => window.viewportMemory.viewport.fit());
      assert.equal(await localView(page), false);
      assert.equal(await fits(page), true);
      await load(page, source(40000), 'body =');
      assert.equal(await fits(page), true);
      await page.screenshot({
        path: `/tmp/code3d-auto-framing-${projection}.png`,
      });
    },
  );
}

async function fits(page: Page): Promise<boolean> {
  return page.evaluate(() => window.viewportMemory.viewport['geometryFits'](0));
}

test(
  'accepted geometry is checked even when its world bounds stay the same',
  {timeout: 120_000},
  async t => {
    const page = await open(t);
    const source = (sign: number) => `import {line} from '@code3d/core';
const sign = ${sign};
const body = line([-50, -50 * sign, 0], [50, 50 * sign, 0]);`;
    await load(page, source(1), 'body =');
    await page.evaluate(() => {
      const controls = window.viewportMemory.viewport['controls'];
      const pose = controls.capturePose();
      controls.restorePose({
        focus: pose.focus.clone().set(0, 0, 0),
        distance: 150,
        viewHeight: 120,
        projection: 'orthographic',
        projectionMix: 0,
        orientation: pose.orientation
          .clone()
          .setFromAxisAngle(pose.focus.clone().set(0, 0, 1), Math.PI / 4),
      });
    });
    await wheel(page, -1);
    assert.equal(await fits(page), true);
    assert.equal(await localView(page), false);
    const initial = await state(page);
    await load(page, source(-1), 'body =');
    assert.equal(await fits(page), true);
    assert.ok((await state(page)).viewHeight > initial.viewHeight);
    assert.equal(await localView(page), false);
  },
);

test(
  'source focus leaves an automatic camera transition running from its displayed pose',
  {timeout: 120_000},
  async t => {
    const page = await open(t, true);
    await page.emulateMedia({reducedMotion: 'no-preference'});
    const source = (size: number) =>
      `import {box} from '@code3d/core'; const body = box(${size}, ${size}, ${size});`;
    await load(page, source(20), 'body =');
    await load(page, source(200), 'body =');
    const result = await page.evaluate(() => {
      const {viewport, module, file, source} = window.viewportMemory;
      const controls = viewport['controls'];
      const before = controls.capturePose().viewHeight;
      const target = controls.savedPose().viewHeight;
      const transition = controls['transition'];
      // Publish a same-scene focus update within the current animation frame.
      viewport.renderInspection(module, viewport['inspectionScene'], {
        file,
        offset: source.indexOf('200, 200') + 6,
      });
      return {
        before,
        after: controls.capturePose().viewHeight,
        target,
        transitioning: controls.transitioning,
        sameTransition: controls['transition'] === transition,
      };
    });
    assert.ok(result.target > result.before);
    assert.equal(result.transitioning, true);
    assert.equal(result.sameTransition, true);
    near(result.after, result.before);
    await page.waitForFunction(
      () => !window.viewportMemory.viewport['controls'].transitioning,
    );
    near((await state(page)).viewHeight, result.target);
    assert.equal(await fits(page), true);
  },
);

test(
  'automatic framing waits for navigation to end and animates the accepted geometry',
  {timeout: 120_000},
  async t => {
    const page = await open(t, true);
    await page.emulateMedia({reducedMotion: 'no-preference'});
    const source = (size: number) =>
      `import {box} from '@code3d/core'; const body = box(${size}, ${size}, ${size});`;
    await load(page, source(20), 'body =');
    const initial = await state(page);
    const canvas = (await page.locator('.viewport-canvas').boundingBox())!;
    await page.mouse.move(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    await page.mouse.down();
    await load(page, source(200), 'body =');
    // A source focus update must not lose an already deferred geometry check.
    await select(page, '200, 200', 6);
    await sampleFrames(page, 350);
    nearState(await state(page), initial);
    assert.equal(await fits(page), false);
    await page.mouse.up();
    const samples = await page.evaluate(async () => {
      const controls = window.viewportMemory.viewport['controls'];
      const target = controls.savedPose().viewHeight;
      const heights: number[] = [];
      await new Promise<void>(resolve => {
        const sample = () => {
          heights.push(controls.capturePose().viewHeight);
          if (controls.transitioning) requestAnimationFrame(sample);
          else resolve();
        };
        sample();
      });
      return {target, heights};
    });
    assert.ok(samples.target > initial.viewHeight * 5);
    assert.ok(
      samples.heights.some(
        height =>
          height > initial.viewHeight * 1.1 && height < samples.target * 0.9,
      ),
    );
    near(samples.heights.at(-1)!, samples.target);
    assert.equal(await fits(page), true);
    assert.equal(await localView(page), false);
    (await state(page)).orientation.forEach((value, i) =>
      near(value, initial.orientation[i]),
    );
  },
);

async function localView(page: Page): Promise<boolean> {
  return page.evaluate(
    () => window.viewportMemory.viewport['viewState'].keepLocalView,
  );
}

async function wheel(page: Page, delta: number): Promise<void> {
  const canvas = (await page.locator('.viewport-canvas').boundingBox())!;
  const before = (await state(page)).viewHeight;
  await page.mouse.move(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  await page.mouse.wheel(0, delta);
  await page.waitForFunction(
    before =>
      window.viewportMemory.viewport['controls'].capturePose().viewHeight !==
      before,
    before,
  );
}

test(
  'objects, collections and recompiled instances retain independent viewport states',
  {timeout: 120_000},
  async t => {
    const page = await open(t);
    await load(page, assembly, 'a =');
    await pose(page, 90, [3, 4, 5], 'render', 'orthographic');
    assert.equal(await fits(page), false);
    // This deliberately cropped view must be owned by a user gesture.
    await wheel(page, -1);
    assert.equal(await localView(page), true);
    const a = await state(page);
    await select(page, 'b =');
    assert.equal((await state(page)).mode, 'modeling');
    await pose(page, 180, [-8, 12, 2]);
    const b = await state(page);
    await select(page, 'a =');
    nearState(await state(page), a);
    await select(page, 'b =');
    nearState(await state(page), b);

    await select(page, 'members =');
    await pose(page, 240, [1, 2, 3], 'render');
    const members = await state(page);
    // The same collection can use the result's coordinate frame without moving its image.
    const beforeGroupInputs = await projectedVertex(page);
    await select(page, 'group(members)', 'group('.length);
    const groupInputs = await state(page);
    near(groupInputs.distance, members.distance);
    assert.equal(groupInputs.mode, members.mode);
    (await projectedVertex(page)).forEach((value, i) =>
      near(value, beforeGroupInputs[i]),
    );
    await load(page, '\n\n' + assembly.replace('10, 8, 6', '12, 8, 6'), 'a =');
    nearState(await state(page), a);
    await select(page, 'members =');
    nearState(await state(page), members);

    await load(page, assembly.replace('[a, b]', '[b, a, a]'), 'members =');
    nearState(await state(page), members);

    await load(page, assembly, 'a =', '/other.ts');
    assert.equal((await state(page)).mode, 'modeling');
    assert.notEqual((await state(page)).distance, a.distance);
    await load(page, assembly, 'a =');
    nearState(await state(page), a);
  },
);

for (const first of ['group', 'collection'] as const) {
  test(
    `first ${first} view seeds the counterpart once with a converted coordinate frame`,
    {timeout: 120_000},
    async t => {
      const page = await open(t);
      const firstSelection = first === 'group' ? 'assembled =' : 'members =';
      const secondSelection = first === 'group' ? 'members =' : 'assembled =';
      const source =
        first === 'group' ? assembly.replace('[a, b]', '[a, b, a]') : assembly;
      await load(page, source, firstSelection);
      await pose(page, 175, [2, 3, 4], 'render', 'orthographic');
      const original = await state(page);
      const before = await projectedVertex(page);
      await select(page, secondSelection);
      const seeded = await state(page);
      assert.equal(seeded.mode, 'render');
      assert.equal(seeded.projection, 'orthographic');
      near(seeded.viewHeight, original.viewHeight);
      near(seeded.distance, original.distance);
      const after = await projectedVertex(page);
      after.forEach((value, index) => near(value, before[index]));
      assert.notDeepEqual(
        seeded.focus,
        original.focus,
        'group origin requires a translated focus',
      );
      await pose(page, 350, [8, 9, 10]);
      const independent = await state(page);
      await select(page, firstSelection);
      nearState(await state(page), original);
      await select(page, secondSelection);
      nearState(await state(page), independent);
    },
  );
}

test(
  'repeated source executions and temporary completion previews keep their own state',
  {timeout: 120_000},
  async t => {
    const page = await open(t);
    const source = `import {box, group} from '@code3d/core';
const copies = [10, 50].map(size => box(size, size, size));
export const first = copies[0];
export const second = copies[1];`;
    await load(page, source, 'first =');
    await pose(page, 95, [1, 2, 3], 'render', 'orthographic');
    const first = await state(page);
    await select(page, 'second =');
    await pose(page, 450, [9, 8, 7]);
    const second = await state(page);
    await select(page, 'first =');
    nearState(await state(page), first);
    await page.evaluate(() => {
      const {viewport} = window.viewportMemory;
      viewport['captureTransientPreviewRestore']();
      viewport['camera'].position.set(1000, 2000, 3000);
      viewport['controls'].syncCamera();
      viewport.setRenderMode('modeling');
      viewport.restoreTransientPreview();
    });
    nearState(await state(page), first);
    await select(page, 'second =');
    nearState(await state(page), second);
  },
);

async function open(t: TestContext, animateViewChanges = false): Promise<Page> {
  assert.ok(process.env.CODE3D_TEST_URL);
  const browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: {width: 1000, height: 740},
    reducedMotion: 'reduce',
  });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.text().includes('[mobx]'))
      errors.push(message.text());
  });
  t.after(() => assert.deepEqual(errors, []));
  const url = new URL('/__viewport-memory__', process.env.CODE3D_TEST_URL).href;
  await page.route(url, route =>
    route.fulfill({
      contentType: 'text/html',
      headers: appIsolationHeaders,
      body: '<main style="width:960px;height:700px"></main>',
    }),
  );
  await page.goto(url);
  await page.evaluate(async animateViewChanges => {
    const {ModelCompilerClient} = await import('/src/model/compiler-client.ts');
    const {browserPackageFiles} =
      await import('/src/project/browser-packages.ts');
    const {ModelViewport} = await import('/src/viewport.ts');
    const client = new ModelCompilerClient(browserPackageFiles);
    const viewport = new ModelViewport(document.querySelector('main')!, {
      onSelect() {},
      onDrillDown() {},
      onNavigateSource() {},
      onPositionTool() {},
      onTopologySelection() {},
      // State restoration is tested independently of animated navigation.
      animateViewChanges,
    });
    window.viewportMemory = {
      client,
      viewport,
      source: '',
      file: '',
      module: undefined!,
    };
  }, animateViewChanges);
  return page;
}

test(
  'scope changes animate scale, retarget from the displayed pose and yield to navigation',
  {timeout: 120_000},
  async t => {
    const page = await open(t, true);
    await page.emulateMedia({reducedMotion: 'no-preference'});
    const source = `import {box} from '@code3d/core';
export const small = box(2, 2, 2);
export const large = box(200, 200, 200);`;
    await load(page, source, 'small =');
    const small = await state(page);
    const transition = await page.evaluate(async () => {
      const {viewport, source, file, client, module} = window.viewportMemory;
      const {inspectSource} =
        await import('/test/browser/inspection-fixture.ts');
      const controls = viewport['controls'];
      await inspectSource(
        client,
        viewport,
        module,
        file,
        source.indexOf('large =') + 1,
      );
      // The first queued RAF may belong to a frame preceding transition startup.
      controls.updateTransition(controls['transition']!.startedAt - 8);
      const start = controls.capturePose().distance;
      const end = controls.savedPose().distance;
      const samples: number[] = [];
      await new Promise<void>(resolve => {
        const sample = () => {
          samples.push(controls.capturePose().distance);
          if (controls['transition']) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
      return {start, end, samples};
    });
    near(transition.start, small.distance);
    assert.ok(transition.end > small.distance * 50);
    assert.ok(
      transition.samples.some(
        value => value > transition.start * 1.1 && value < transition.end * 0.9,
      ),
    );
    near(transition.samples.at(-1)!, transition.end);
    for (let i = 1; i < transition.samples.length; i++)
      assert.ok(transition.samples[i] >= transition.samples[i - 1]);

    const redirected = await page.evaluate(async () => {
      const {viewport, source, file, client, module} = window.viewportMemory;
      const {inspectSource} =
        await import('/test/browser/inspection-fixture.ts');
      const controls = viewport['controls'];
      await inspectSource(
        client,
        viewport,
        module,
        file,
        source.indexOf('small =') + 1,
      );
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const before = controls.capturePose();
      await inspectSource(
        client,
        viewport,
        module,
        file,
        source.indexOf('large =') + 1,
      );
      const after = controls.capturePose();
      return {before: before.distance, after: after.distance};
    });
    near(redirected.before, redirected.after);
    const canvas = (await page
      .locator('canvas.viewport-canvas')
      .boundingBox())!;
    await page.mouse.move(
      canvas.x + canvas.width * 0.6,
      canvas.y + canvas.height * 0.5,
    );
    await page.mouse.down();
    const grabbed = await state(page);
    await sampleFrames(page, 350);
    nearState(await state(page), grabbed);
    await page.mouse.up();

    await select(page, 'small =');
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(
      () => !window.viewportMemory.viewport['controls']['transition'],
    );
    const wheeled = await state(page);
    await sampleFrames(page, 350);
    nearState(await state(page), wheeled);

    await page.emulateMedia({reducedMotion: 'reduce'});
    await select(page, 'large =');
    assert.equal(
      await page.evaluate(
        () =>
          window.viewportMemory.viewport['controls']['transition'] ===
          undefined,
      ),
      true,
    );
  },
);

async function sampleFrames(page: Page, duration: number): Promise<void> {
  await page.evaluate(
    duration =>
      new Promise<void>(resolve => {
        const end = performance.now() + duration;
        const frame = () =>
          performance.now() >= end ? resolve() : requestAnimationFrame(frame);
        requestAnimationFrame(frame);
      }),
    duration,
  );
}

async function load(
  page: Page,
  source: string,
  selection: string,
  file = '/model.ts',
): Promise<void> {
  const diagnostic = await page.evaluate(
    async ({source, selection, file}) => {
      const data = window.viewportMemory;
      const module = await data.client.compile(
        {files: [{path: file, source}]},
        file,
      );
      data.source = source;
      data.file = file;
      data.module = module;
      const {inspectSource} =
        await import('/test/browser/inspection-fixture.ts');
      await inspectSource(
        data.client,
        data.viewport,
        module,
        file,
        source.indexOf(selection) + 1,
      );
      return module.diagnostic;
    },
    {source, selection, file},
  );
  assert.equal(diagnostic, undefined);
}

async function select(page: Page, selection: string, shift = 1): Promise<void> {
  assert.equal(
    await page.evaluate(
      async ({selection, shift}) => {
        const {inspectSource} =
          await import('/test/browser/inspection-fixture.ts');
        const {source, file, viewport, client, module} = window.viewportMemory;
        return inspectSource(
          client,
          viewport,
          module,
          file,
          source.indexOf(selection) + shift,
        );
      },
      {selection, shift},
    ),
    true,
  );
}

async function pose(
  page: Page,
  distance: number,
  focus: number[],
  mode: 'modeling' | 'render' = 'modeling',
  projection: 'perspective' | 'orthographic' = 'perspective',
): Promise<void> {
  await page.evaluate(
    ({distance, focus, mode, projection}) => {
      const {viewport} = window.viewportMemory;
      const controls = viewport['controls'];
      const camera = viewport['camera'];
      controls.focus.fromArray(focus);
      camera.position.set(focus[0], focus[1], focus[2] + distance);
      camera.up.set(0, 1, 0);
      controls.syncCamera();
      controls.restorePose({
        ...controls.capturePose(),
        projection,
        projectionMix: projection === 'orthographic' ? 0 : 1,
        viewHeight: distance / 2,
      });
      viewport.setRenderMode(mode);
    },
    {distance, focus, mode, projection},
  );
}

async function state(page: Page) {
  return page.evaluate(() => {
    const {viewport} = window.viewportMemory;
    const controls = viewport['controls'];
    return {
      distance: viewport['camera'].position.distanceTo(controls.focus),
      focus: controls.focus.toArray(),
      orientation: viewport['camera'].quaternion.toArray(),
      mode: viewport['rendering'].mode,
      projection: controls.capturePose().projection,
      viewHeight: controls.capturePose().viewHeight,
    };
  });
}

async function projectedVertex(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const {viewport, module} = window.viewportMemory;
    const a = module.catalog.find(entry => entry.label === 'a')!.nodeIds[0];
    const occurrence = [
      ...viewport['occurrences'].values(),
      ...viewport['contextOccurrences'].values(),
    ].find(o => o.node.nodeId === a)!;
    const point = viewport['camera'].position
      .clone()
      .fromArray(occurrence.node.mesh!.vertices);
    occurrence.object.updateWorldMatrix(true, false);
    viewport['camera'].updateMatrixWorld();
    return point
      .applyMatrix4(occurrence.object.matrixWorld)
      .project(viewport['camera'])
      .toArray()
      .slice(0, 2);
  });
}

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
}

function nearState(
  actual: Awaited<ReturnType<typeof state>>,
  expected: Awaited<ReturnType<typeof state>>,
): void {
  near(actual.distance, expected.distance);
  actual.focus.forEach((value, index) => near(value, expected.focus[index]));
  actual.orientation.forEach((value, index) =>
    near(value, expected.orientation[index]),
  );
  assert.equal(actual.mode, expected.mode);
  assert.equal(actual.projection, expected.projection);
  near(actual.viewHeight, expected.viewHeight);
}

test(
  'completion previews restore the complete custom inspect scene and camera',
  {timeout: 120_000},
  async t => {
    const page = await open(t);
    const result = await page.evaluate(async () => {
      const {viewport, client} = window.viewportMemory;
      const file = '/inspect-completion.ts';
      const source = `import {box} from '@code3d/core';
const stock = box(20,20,20).material('#ff0000');
/** @code3d.inspect show.inspect */
function show() { return stock; }
namespace show { export function inspect() { return {ambient: [stock], target: [box(4,5,6).material('#0000ff')]}; } }
export default show();`;
      const module = await client.compile(
        {files: [{path: file, source}]},
        file,
      );
      const selection = {file, offset: source.lastIndexOf('show();')};
      const scene = await client.inspect(module, selection);
      if (!scene) throw new Error('Missing custom inspection');
      viewport.renderInspection(module, scene, selection);
      const appearance = () => {
        const opacity: number[] = [];
        viewport['root'].traverse(object => {
          if (!('isMesh' in object)) return;
          const mesh = object as import('three').Mesh;
          for (const material of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material])
            opacity.push(material.opacity);
        });
        return {
          kind: viewport['inspectionScene']?.kind,
          opacity: opacity.sort(),
          selectable: viewport['occurrences'].size,
          context: viewport['contextOccurrences'].size,
        };
      };
      const originalAppearance = appearance();
      const original = viewport['controls'].capturePose();
      const scope = viewport.sourceEvaluationAt(
        module,
        file,
        source.indexOf('stock =') + 1,
      )!;
      const previewed = viewport.previewCompletion(
        scope.target,
        scope.evaluationIndex,
        'up',
      );
      const immediate = viewport['inspectionScene']?.target[0].kind;
      viewport.restoreTransientPreview();
      const restoredImmediate = viewport['inspectionScene'] === scene;
      const stockSelection = {file, offset: source.indexOf('stock =') + 1};
      const completed = await client.inspect(module, stockSelection);
      if (!completed) throw new Error('Missing completion inspection');
      viewport.previewCompletedProject(module, completed, stockSelection);
      const completedAppearance = appearance();
      viewport.restoreTransientPreview();
      const restoredPose = viewport['controls'].capturePose();
      return {
        previewed,
        immediate,
        restoredImmediate,
        restoredCompleted: viewport['inspectionScene'] === scene,
        originalAppearance,
        completedAppearance,
        restoredAppearance: appearance(),
        pose: {
          ...restoredPose,
          orientation: restoredPose.orientation.toArray(),
        },
        original: {...original, orientation: original.orientation.toArray()},
      };
    });
    assert.equal(result.previewed, true);
    assert.equal(result.immediate, 'anchor');
    assert.equal(result.restoredImmediate, true);
    assert.equal(result.restoredCompleted, true);
    assert.equal(result.originalAppearance.kind, 'inspect');
    assert.deepEqual(result.originalAppearance.opacity, [0.18, 0.82]);
    assert.equal(
      result.originalAppearance.selectable + result.originalAppearance.context,
      2,
    );
    assert.equal(result.completedAppearance.kind, 'preview');
    assert.deepEqual(result.completedAppearance.opacity, [1]);
    assert.deepEqual(result.restoredAppearance, result.originalAppearance);
    assert.deepEqual(
      {...result.pose, orientation: []},
      {...result.original, orientation: []},
    );
    result.pose.orientation.forEach((value, index) =>
      near(value, result.original.orientation[index]),
    );
  },
);
