import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium, type Page} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';

declare const window: Window & {
  renderModeApp: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
    previousModule?: import('../../src/model/compiler.ts').ModelModule | null;
  };
};

test(
  'render mode draws authored geometry without helpers and restores modeling frames',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({reducedMotion: 'reduce'});
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL('/__render-mode-test__', process.env.CODE3D_TEST_URL)
      .href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main style="width:800px;height:600px"></main>',
      }),
    );
    await page.goto(url);
    const result = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const {browserPackageFiles} =
        await import('/src/project/browser-packages.ts');
      const {ModelViewport} = await import('/src/viewport.ts');
      const {parseModelColor} = await import('/src/model/model-color.ts');
      const {elementSourceDecoration, relationSourceDecoration} =
        await import('/src/model/element-decorations.ts');
      const client = new ModelCompilerClient(browserPackageFiles);
      const viewport = new ModelViewport(document.querySelector('main')!, {
        onSelect() {},
        onDrillDown() {},
        onNavigateSource() {},
        onPositionTool() {},
        onTopologySelection() {},
        sourceDecorationProviders: [
          elementSourceDecoration,
          relationSourceDecoration,
        ],
      });
      const source = `import {box, group, rectangle, line, point} from '@code3d/core';
const base = box(30, 4, 20).paint('#48a');
const part = box(10, 12, 8).paint('#f008').relate(self => self.on(/* target */ base.up).offset(0, 2, 0));
const result = group([base, part, rectangle(8, 9), line([0, 0, 0], [30, 20, 0]).paint('#0f08'), point([8, 18, 5]).paint('#f80')]);
export default result;`;
      const module = await client.compile(
        {files: [{path: '/model.ts', source}]},
        '/model.ts',
      );
      if (module.diagnostic) throw new Error(module.diagnostic.summary);
      const samples: {
        mode: string;
        auxiliary: number;
        bodies: {
          kind: string;
          color: string;
          opacity: number;
          expectedColor: string;
          expectedOpacity: number;
        }[];
        dimensions: number[];
      }[] = [];
      const pixels = async () => {
        const bitmap = await createImageBitmap(
          await viewport.captureImage(320, 240),
        );
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return {
          dimensions: [canvas.width, canvas.height],
          pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      };
      const measure = async (mode: 'modeling' | 'render') => {
        viewport.setRenderMode(mode);
        const bodies = new Map<
          string,
          {kind: string; color: string; opacity: number}
        >();
        for (const occurrence of [
          ...viewport['occurrences'].values(),
          ...viewport['contextOccurrences'].values(),
        ]) {
          if (occurrence.node.kind === 'group') continue;
          const paint =
            occurrence.node.color === undefined
              ? undefined
              : parseModelColor(occurrence.node.color);
          bodies.set(occurrence.object.children[0].uuid, {
            kind: occurrence.node.kind,
            color: paint?.rgb.slice(1) ?? 'dde0dc',
            opacity: paint?.alpha ?? 1,
          });
        }
        const sample: (typeof samples)[number] = {
          mode,
          auxiliary: 0,
          bodies: [],
          dimensions: [],
        };
        const restore: (() => void)[] = [];
        viewport['scene'].traverse(object => {
          if (!('material' in object)) return;
          const before = object.onBeforeRender;
          object.onBeforeRender = (...args) => {
            const body = bodies.get(object.uuid);
            if (!body) sample.auxiliary++;
            else {
              const material =
                object.material as import('three').MeshStandardMaterial;
              sample.bodies.push({
                kind: body.kind,
                color: material.color.getHexString(),
                opacity: material.opacity,
                expectedColor: body.color,
                expectedOpacity: body.opacity,
              });
            }
            before.apply(object, args);
          };
          restore.push(() => {
            object.onBeforeRender = before;
          });
        });
        try {
          viewport['rendering'].renderFrame();
          const image = await pixels();
          sample.dimensions = image.dimensions;
          samples.push(sample);
          return image.pixels;
        } finally {
          restore.forEach(restore => restore());
        }
      };
      try {
        viewport.renderModule(module);
        const before = await measure('modeling');
        const selected = viewport.getSelected();
        const camera = viewport['camera'].position.toArray();
        const rendered = await measure('render');
        const selectionRetained = viewport.getSelected() === selected;
        const cameraRetained = camera.every(
          (value, index) =>
            viewport['camera'].position.toArray()[index] === value,
        );
        const restored = await measure('modeling');
        // Rebuild the source view while already in Render, then return to its guides.
        viewport.setRenderMode('render');
        viewport.selectBySourceOffset(
          '/model.ts',
          source.indexOf('/* target */') + 1,
        );
        await measure('render');
        await measure('modeling');
        // Compilation and topology previews also keep the selected display mode.
        viewport.setRenderMode('render');
        viewport.renderModule(module);
        const solid = [...viewport['occurrences'].values()].find(
          occurrence => occurrence.node.kind === 'solid',
        )!;
        viewport.beginTopologySelection(
          solid.key,
          solid.node.nodeId,
          'surface',
          true,
          [1],
        );
        await measure('render');
        await measure('modeling');
        return {
          samples,
          selectionRetained,
          cameraRetained,
          imageChanged: rendered.some(
            (value, index) => value !== before[index],
          ),
          imageRestored: restored.every(
            (value, index) => value === before[index],
          ),
        };
      } finally {
        viewport['renderer'].dispose();
        viewport['controls'].dispose();
        client.dispose();
      }
    });
    assert.equal(result.selectionRetained, true);
    assert.equal(result.cameraRetained, true);
    assert.equal(result.imageChanged, true);
    assert.equal(result.imageRestored, true);
    for (const sample of result.samples) {
      assert.deepEqual(sample.dimensions, [320, 240]);
      assert.ok(sample.bodies.length > 0);
      if (sample.mode === 'render') {
        assert.equal(sample.auxiliary, 0);
        for (const body of sample.bodies) {
          assert.equal(body.color, body.expectedColor, body.kind);
          assert.equal(body.opacity, body.expectedOpacity, body.kind);
        }
      } else assert.ok(sample.auxiliary > 0);
    }
    assert.deepEqual(
      [...new Set(result.samples[1].bodies.map(body => body.kind))].sort(),
      ['edge', 'face', 'solid', 'vertex'],
    );
    assert.deepEqual(errors, []);
  },
);

async function setSource(page: Page, source: string) {
  await page.evaluate(source => {
    window.renderModeApp.previousModule =
      window.renderModeApp.viewport['module'];
    const editor = window.renderModeApp.codeEditor.editor;
    editor.getModel()!.setValue(source);
    editor.setPosition(editor.getModel()!.getPositionAt(source.length - 2));
    editor.focus();
  }, source);
  await page.waitForFunction(
    () =>
      window.renderModeApp.viewport['module'] !==
      window.renderModeApp.previousModule,
  );
  await page.getByText('Ready', {exact: true}).waitFor();
}

test(
  'viewport mode buttons support keyboard, camera navigation, recompilation and narrow layouts',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1400, height: 950},
      reducedMotion: 'reduce',
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(20_000);
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.renderModeApp = {codeEditor, viewport};\n',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 40_000});
    await setSource(
      page,
      "import {box} from '@code3d/core';\nconst body = box(24, 30, 20).paint('#49a');\nbody;",
    );
    const modeling = page.getByRole('button', {name: 'Modeling', exact: true});
    const render = page.getByRole('button', {name: 'Render', exact: true});
    assert.equal(await modeling.getAttribute('aria-pressed'), 'true');
    const modeBox = (await page.locator('.viewport-mode').boundingBox())!;
    const statusBox = (await page.locator('#viewport-status').boundingBox())!;
    assert.ok(modeBox.x + modeBox.width < statusBox.x);
    await render.focus();
    await page.keyboard.press('Enter');
    assert.equal(await render.getAttribute('aria-pressed'), 'true');
    assert.equal(await modeling.getAttribute('aria-pressed'), 'false');
    assert.equal(
      await page.locator('.viewport-coordinate-reference').isVisible(),
      false,
    );
    assert.equal(
      await page.locator('.viewport-dock-panels').isVisible(),
      false,
    );
    const before = await page.evaluate(() =>
      window.renderModeApp.viewport['camera'].position.toArray(),
    );
    const canvas = (await page.locator('.viewport-canvas').boundingBox())!;
    await page.mouse.move(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      canvas.x + canvas.width / 2 + 80,
      canvas.y + canvas.height / 2 + 40,
      {steps: 10},
    );
    await page.mouse.up();
    const after = await page.evaluate(() =>
      window.renderModeApp.viewport['camera'].position.toArray(),
    );
    assert.notDeepEqual(after, before);
    await setSource(
      page,
      "import {box} from '@code3d/core';\nconst changed = box(30, 20, 15).paint('#f008');\nchanged;",
    );
    assert.equal(await render.getAttribute('aria-pressed'), 'true');
    assert.equal(
      await page.locator('.viewport-coordinate-reference').isVisible(),
      false,
    );
    await page.setViewportSize({width: 960, height: 720});
    const layout = await page.evaluate(() => {
      const host = document
        .querySelector('#viewport-host')!
        .getBoundingClientRect();
      const header = document
        .querySelector('.viewport-header')!
        .getBoundingClientRect();
      return {
        hostRight: host.right,
        headerRight: header.right,
        scroll: document.documentElement.scrollWidth,
        width: innerWidth,
      };
    });
    assert.ok(layout.headerRight <= layout.hostRight);
    assert.ok(layout.scroll <= layout.width);
    await modeling.focus();
    await page.keyboard.press('Space');
    assert.equal(await modeling.getAttribute('aria-pressed'), 'true');
    assert.equal(
      await page.locator('.viewport-coordinate-reference').isVisible(),
      true,
    );
    assert.equal(await page.locator('.viewport-dock-panels').isVisible(), true);
    assert.deepEqual(errors, []);
  },
);
