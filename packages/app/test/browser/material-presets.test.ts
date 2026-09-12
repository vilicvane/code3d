import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

declare const window: Window & {
  materialPresetsApp: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
  };
};

test(
  'built-in material presets have editor types and render all ten surfaces in the App and PNG',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const source = await readFile(
      new URL('../fixtures/material-presets.ts', import.meta.url),
      'utf8',
    );
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1500, height: 960},
      reducedMotion: 'reduce',
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export const defaultProject = ${JSON.stringify({files: [{path: '/model.ts', source}]})};`,
      }),
    );
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.materialPresetsApp = {viewport, codeEditor};',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    const language = await page.evaluate(async () => {
      const {codeEditor} = window.materialPresetsApp;
      const {projectTypeScriptWorker} =
        await import('/src/monaco/typescript-worker-client.ts');
      const model = codeEditor.editor.getModel()!;
      const worker = await projectTypeScriptWorker('typescript', model.uri);
      return {
        diagnostics: await worker.getSemanticDiagnostics(model.uri.toString()),
        completions: await worker.getProjectCompletions(
          model.uri.toString(),
          model.getValue().indexOf('polished') + 1,
        ),
      };
    });
    assert.deepEqual(language.diagnostics, []);
    const finishes = language.completions!.entries.map(entry =>
      entry.name.replace(/['"]/g, ''),
    );
    assert.ok(finishes.includes('polished'));
    assert.ok(finishes.includes('satin'));

    await page.locator('#viewport-mode-render').click();
    const result = await page.evaluate(async () => {
      const {viewport} = window.materialPresetsApp;
      const drawn = new Set<string>();
      const physical: Record<
        string,
        {transmission: number; thickness: number; clearcoat: number}
      > = {};
      for (const occurrence of viewport['occurrences'].values()) {
        if (occurrence.node.kind === 'group') continue;
        const mesh = occurrence.object.children[0] as import('three').Mesh<
          import('three').BufferGeometry,
          import('three').MeshPhysicalMaterial
        >;
        mesh.onBeforeRender = () => {
          drawn.add(mesh.material.name);
          if (mesh.material.isMeshPhysicalMaterial)
            physical[mesh.material.name] = {
              transmission: mesh.material.transmission,
              thickness: mesh.material.thickness,
              clearcoat: mesh.material.clearcoat,
            };
        };
      }
      viewport['rendering'].renderFrame();
      const viewportNames = [...drawn];
      drawn.clear();
      const bitmap = await createImageBitmap(
        await viewport.captureImage(720, 540),
      );
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let renderedPixels = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          Math.abs(pixels[i] - pixels[0]) +
            Math.abs(pixels[i + 1] - pixels[1]) +
            Math.abs(pixels[i + 2] - pixels[2]) >
          30
        )
          renderedPixels++;
      return {viewportNames, pngNames: [...drawn], physical, renderedPixels};
    });
    const names = [
      'plastic',
      'rubber',
      'aluminum',
      'steel',
      'brass',
      'copper',
      'glass',
      'acrylic',
      'ceramic',
      'paint',
    ];
    assert.deepEqual(new Set(result.viewportNames), new Set(names));
    assert.deepEqual(new Set(result.pngNames), new Set(names));
    assert.equal(result.physical.glass.transmission, 1);
    assert.equal(result.physical.glass.thickness, 12);
    assert.equal(result.physical.acrylic.transmission, 1);
    assert.equal(result.physical.paint.clearcoat, 1);
    assert.ok(result.renderedPixels > 5000);
    assert.deepEqual(errors, []);
    if (process.env.CODE3D_MATERIAL_PRESETS_SCREENSHOT)
      await page.screenshot({
        path: process.env.CODE3D_MATERIAL_PRESETS_SCREENSHOT,
      });
  },
);
