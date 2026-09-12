import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';

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
