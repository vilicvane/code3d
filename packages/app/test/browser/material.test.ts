import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';

test(
  'native materials and image pixels cross the worker boundary and draw in Render and PNG',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const source =
      (
        await readFile(
          new URL('../fixtures/native-materials.ts', import.meta.url),
          'utf8',
        )
      ).replace('export const materialsExample', 'const materialsExample') +
      `
import {Texture, MeshBasicMaterial} from '@code3d/core/three';
const canvas = new OffscreenCanvas(2, 2);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#f080ff';
ctx.fillRect(0, 0, 2, 2);
const image = canvas.transferToImageBitmap();
const bitmapMaterial = new MeshBasicMaterial({map: new Texture(image), toneMapped: false});
const bitmapPart = box(6, 6, 6).originOffset(0, -18, 0).material(bitmapMaterial);
image.close();
export default group([materialsExample, bitmapPart]);
`;
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1000, height: 720},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const url = new URL('/__material-test__', process.env.CODE3D_TEST_URL).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main style="width:960px;height:680px"></main>',
      }),
    );
    await page.goto(url);
    const result = await page.evaluate(async source => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const {browserPackageFiles} =
        await import('/src/project/browser-packages.ts');
      const {ModelViewport} = await import('/src/viewport.ts');
      const {applySourceEmphasis} =
        await import('/src/rendering/source-appearance.ts');
      const client = new ModelCompilerClient(browserPackageFiles);
      const viewport = new ModelViewport(document.querySelector('main')!, {
        onSelect() {},
        onDrillDown() {},
        onNavigateSource() {},
        onPositionTool() {},
        onTopologySelection() {},
      });
      try {
        const module = await client.compile(
          {files: [{path: '/model.ts', source}]},
          '/model.ts',
        );
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        viewport.renderModule(module);
        const drawn: {
          type: string;
          color?: string;
          opacity: number;
          clearcoat?: number;
          hasUV: boolean;
          pixels?: number[];
          polygonOffset: boolean;
          size?: number;
          dashSize?: number;
        }[] = [];
        const bodies = [...viewport['occurrences'].values()].filter(
          value => value.node.kind !== 'group',
        );
        for (const occurrence of bodies) {
          applySourceEmphasis(occurrence.object, 'context');
          const body = occurrence.object.children[0] as import('three').Mesh<
            import('three').BufferGeometry,
            import('three').MeshPhysicalMaterial &
              import('three').PointsMaterial &
              import('three').LineDashedMaterial
          >;
          body.onBeforeRender = () => {
            const material = body.material;
            drawn.push({
              type: material.type,
              color: material.color?.getHexString(),
              opacity: material.opacity,
              clearcoat: material.clearcoat,
              polygonOffset: material.polygonOffset,
              hasUV: body.geometry.hasAttribute('uv'),
              size: material.size,
              dashSize: material.dashSize,
              pixels: material.map
                ? Array.from(
                    (material.map.image as {data: Uint8Array}).data,
                  ).slice(0, 16)
                : undefined,
            });
          };
        }
        viewport.setRenderMode('render');
        viewport['rendering'].renderFrame();
        const bitmap = await createImageBitmap(
          await viewport.captureImage(640, 480),
        );
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const pixels = ctx.getImageData(0, 0, 640, 480).data;
        let checkerPixels = 0,
          imagePixels = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (
            Math.abs(pixels[index] - 216) < 3 &&
            Math.abs(pixels[index + 1] - 255) < 3 &&
            Math.abs(pixels[index + 2] - 62) < 3
          )
            checkerPixels++;
          if (
            pixels[index] > 200 &&
            pixels[index + 1] < 210 &&
            pixels[index + 2] > 240
          )
            imagePixels++;
        }
        const previews = bodies.map(
          occurrence =>
            (
              occurrence.object.children[0] as import('three').Mesh<
                import('three').BufferGeometry,
                import('three').Material
              >
            ).material.opacity,
        );
        return {drawn, checkerPixels, imagePixels, previews};
      } finally {
        viewport['renderer'].dispose();
        viewport['controls'].dispose();
        client.dispose();
      }
    }, source);
    const physical = result.drawn.filter(
      value => value.type === 'MeshPhysicalMaterial',
    );
    assert.ok(physical.length >= 4, 'both surfaces draw on screen and in PNG');
    assert.deepEqual(
      new Set(physical.map(value => value.color)),
      new Set(['eb633e', '388eb5']),
    );
    assert.ok(
      physical.every(
        value =>
          value.clearcoat === 1 && value.opacity === 1 && !value.polygonOffset,
      ),
    );
    assert.ok(
      result.drawn.some(
        value => value.type === 'PointsMaterial' && value.size === 8,
      ),
    );
    assert.ok(
      result.drawn.some(
        value => value.type === 'LineDashedMaterial' && value.dashSize === 2,
      ),
    );
    assert.ok(
      result.drawn.filter(value => value.pixels).every(value => value.hasUV),
    );
    assert.ok(
      result.drawn.some(
        value => value.pixels?.[0] === 240 && value.pixels[1] === 128,
      ),
      'closed ImageBitmap was captured before leaving the worker',
    );
    assert.ok(
      result.checkerPixels > 200,
      'checker texture reaches exported pixels',
    );
    assert.ok(
      result.imagePixels > 50,
      'bitmap texture reaches exported pixels',
    );
    assert.ok(
      result.previews.every(value => value <= 0.28),
      'rendering restores the context preview copies',
    );
    assert.deepEqual(errors, []);
    if (process.env.CODE3D_MATERIAL_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_MATERIAL_SCREENSHOT});
  },
);
