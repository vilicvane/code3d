import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {chromium, type Page} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';

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
      const {codeEditor, viewport} = window.viewportMemoryUi;
      const model = codeEditor.editor.getModel()!;
      codeEditor.editor.setPosition(
        model.getPositionAt(model.getValue().indexOf('a =') + 1),
      );
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

const assembly = `import {box, group} from '@code3d/core';
const a = box(10, 8, 6).originOffset(-30, 0, 0);
const b = box(8, 6, 4).relate(self => self.on(a.up).offset(0, 5, 0));
const members = [a, b];
export const assembled = group(members);
`;

test(
  'objects, collections and recompiled instances retain independent viewport states',
  {timeout: 120_000},
  async t => {
    const page = await open(t);
    await load(page, assembly, 'a =');
    await pose(page, 90, [3, 4, 5], 'render', 'orthographic');
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
    // Focusing either input of the same group keeps the displayed collection.
    await select(page, 'group(members)', 'group('.length);
    nearState(await state(page), members);
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
      const {viewport, source, file} = window.viewportMemory;
      const controls = viewport['controls'];
      viewport.selectBySourceOffset(file, source.indexOf('large =') + 1);
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
      const {viewport, source, file} = window.viewportMemory;
      const controls = viewport['controls'];
      viewport.selectBySourceOffset(file, source.indexOf('small =') + 1);
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const before = controls.capturePose();
      viewport.selectBySourceOffset(file, source.indexOf('large =') + 1);
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
      data.viewport.renderModule(module, undefined, {
        file,
        offset: source.indexOf(selection) + 1,
      });
      return module.diagnostic;
    },
    {source, selection, file},
  );
  assert.equal(diagnostic, undefined);
}

async function select(page: Page, selection: string, shift = 1): Promise<void> {
  assert.equal(
    await page.evaluate(
      ({selection, shift}) => {
        const {source, file, viewport} = window.viewportMemory;
        return viewport.selectBySourceOffset(
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
