import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from './browser-connection.ts';
import {appIsolationHeaders} from '../../build/response-headers.ts';

test(
  'render scenes update screen and PNG, preserve modeling and release cached environments',
  {timeout: 60_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({deviceScaleFactor: 1});
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/mobx/i.test(message.text())) errors.push(message.text());
    });
    const url = new URL('/__scene-test__', process.env.CODE3D_TEST_URL).href;
    await page.route(url, route =>
      route.fulfill({
        headers: appIsolationHeaders,
        contentType: 'text/html',
        body: '<main style="width:320px;height:240px"></main>',
      }),
    );
    await page.goto(url);
    const result = await page.evaluate(async () => {
      const {ModelRenderer} = await import('/src/rendering/model-renderer.ts');
      const {renderScenePresets} =
        await import('/src/rendering/render-scene.ts');
      const {BoxGeometry, Mesh} =
        await import('/test/browser/browser-dependencies.ts');
      const {createModelMaterial} =
        await import('/src/rendering/model-material.ts');
      let redraws = 0;
      const view = new ModelRenderer(
        document.querySelector('main')!,
        () => redraws++,
      );
      const geometry = new BoxGeometry(22, 30, 18);
      const material = createModelMaterial('#88a5c1', 'solid');
      view.scene.add(new Mesh(geometry, material));
      view.camera.position.set(45, 35, 50);
      view.camera.lookAt(0, 0, 0);
      const pixels = async (blob: Blob) => {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const screen = async () => {
        view.renderFrame();
        return pixels(
          await new Promise<Blob>(resolve =>
            view.renderer.domElement.toBlob(blob => resolve(blob!)),
          ),
        );
      };
      const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
        a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
      const surfaceDifference = (
        a: Uint8ClampedArray,
        b: Uint8ClampedArray,
      ) => {
        let total = 0,
          channels = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (a[i] === a[0] && a[i + 1] === a[1] && a[i + 2] === a[2]) continue;
          for (let c = 0; c < 3; c++) total += Math.abs(a[i + c] - b[i + c]);
          channels += 3;
        }
        return total / channels;
      };
      const modeling = await screen();
      view.setScenePreset('soft');
      const modelingUnaffected = difference(modeling, await screen());
      view.setMode('render');
      const frames: Uint8ClampedArray[] = [];
      const pngDifferences: number[] = [];
      const environments = new Set<import('three').Texture>();
      const presets = Object.keys(
        renderScenePresets,
      ) as (keyof typeof renderScenePresets)[];
      const disposal = {count: 0};
      try {
        for (const preset of presets) {
          view.setScenePreset(preset);
          const frame = await screen();
          frames.push(frame);
          pngDifferences.push(
            difference(frame, await pixels(await view.captureImage(320, 240))),
          );
          const environment = view.scene.environment!;
          environment.addEventListener('dispose', () => disposal.count++);
          environments.add(environment);
        }
        const textures = view.renderer.info.memory.textures;
        for (let i = 0; i < 12; i++) {
          view.setScenePreset(presets[i % presets.length]);
          view.renderFrame();
        }
        const texturesAfterSwitches = view.renderer.info.memory.textures;
        view.setMode('modeling');
        const modelingRestored = difference(modeling, await screen());
        view.setMode('render');
        const selected = view.scenePreset;
        const softRestored = difference(frames[2], await screen());
        return {
          modelingUnaffected,
          modelingRestored,
          selected,
          softRestored,
          backgrounds: frames.map(frame => Array.from(frame.slice(0, 4))),
          presetDifferences: [
            surfaceDifference(frames[0], frames[1]),
            surfaceDifference(frames[0], frames[2]),
          ],
          pngDifferences,
          textures,
          texturesAfterSwitches,
          environments: environments.size,
          disposal,
          redraws,
        };
      } finally {
        view.dispose();
        geometry.dispose();
        material.dispose();
      }
    });
    assert.equal(result.modelingUnaffected, 0);
    assert.equal(result.modelingRestored, 0);
    assert.equal(result.selected, 'soft');
    assert.equal(result.softRestored, 0);
    for (const background of result.backgrounds)
      assert.deepEqual(background, result.backgrounds[0]);
    assert.ok(
      result.presetDifferences.every(value => value > 2),
      JSON.stringify(result),
    );
    assert.ok(
      result.pngDifferences.every(value => value < 0.5),
      JSON.stringify(result),
    );
    assert.equal(result.texturesAfterSwitches, result.textures);
    assert.equal(result.environments, 3);
    assert.equal(result.disposal.count, 3);
    assert.ok(result.redraws >= 12);
    assert.deepEqual(errors, []);
  },
);

test(
  'neutral metal stays lit from three directions in the viewport and PNG',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL('/__lighting-test__', process.env.CODE3D_TEST_URL).href;
    await page.route(url, route =>
      route.fulfill({
        headers: appIsolationHeaders,
        contentType: 'text/html',
        body: '<main style="width:640px;height:480px"></main>',
      }),
    );
    await page.goto(url);
    const samples = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
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
      });
      try {
        const source = `import {box} from '@code3d/core';
import {MeshStandardMaterial} from '@code3d/core/three';
export default box(20, 20, 20).material(new MeshStandardMaterial({color: '#c0c0c0', metalness: 1, roughness: 0.3}));`;
        const module = await client.compile(
          {files: [{path: '/model.ts', source}]},
          '/model.ts',
        );
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        viewport.renderModule(module);
        viewport.setRenderMode('render');
        const result: number[][] = [];
        const sample = async (image: Blob) => {
          const bitmap = await createImageBitmap(image);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          const pixels = ctx.getImageData(
            canvas.width / 2 - 8,
            canvas.height / 2 - 8,
            16,
            16,
          ).data;
          const mean = [0, 0, 0];
          for (let i = 0; i < pixels.length; i += 4)
            for (let c = 0; c < 3; c++) mean[c] += pixels[i + c] / 256;
          result.push(mean);
        };
        for (const direction of [
          [1, 0.6, 1],
          [-1, 0.6, -1],
          [1, -0.6, -1],
        ] as const) {
          const view = {direction, up: [0, 1, 0] as const};
          viewport.setView(view);
          viewport['rendering'].renderFrame();
          const canvas = viewport['renderer'].domElement;
          const screen = await new Promise<Blob>(resolve =>
            canvas.toBlob(blob => resolve(blob!)),
          );
          await sample(screen);
          await sample(await viewport.captureImage(640, 480, view));
        }
        return result;
      } finally {
        viewport['controls'].dispose();
        viewport['renderer'].dispose();
        client.dispose();
      }
    });
    assert.equal(samples.length, 6);
    for (const channels of samples) {
      assert.ok(Math.min(...channels) > 60, `Metal remains lit: ${channels}`);
      assert.ok(
        Math.max(...channels) - Math.min(...channels) < 6,
        `No colored lighting cast: ${channels}`,
      );
    }
    assert.deepEqual(errors, []);
  },
);
