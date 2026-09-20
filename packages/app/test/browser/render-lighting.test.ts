import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from './browser-connection.ts';
import {appIsolationHeaders} from '../../build/response-headers.ts';

test(
  'render lighting separates contacts, respects glass, scales with solids and matches PNG',
  {timeout: 90_000},
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
      if (message.type() === 'error' || /mobx/i.test(message.text()))
        errors.push(message.text());
    });
    const url = new URL(
      '/__render-lighting-test__',
      process.env.CODE3D_TEST_URL,
    ).href;
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
      const {createModelMaterial} =
        await import('/src/rendering/model-material.ts');
      const {createViewCamera} = await import('/src/rendering/view-camera.ts');
      const {BoxGeometry, Mesh, MeshPhysicalMaterial, Vector3} =
        await import('/test/browser/browser-dependencies.ts');
      const view = new ModelRenderer(document.querySelector('main')!);
      const material = createModelMaterial('#a8b6bc', 'solid');
      const base = new Mesh(new BoxGeometry(40, 2, 36), material);
      const block = new Mesh(new BoxGeometry(16, 16, 16), material);
      const glassMaterial = createModelMaterial('#f004', 'solid');
      const transmission = new MeshPhysicalMaterial({
        transmission: 1,
        thickness: 0,
        ior: 1,
        roughness: 0,
      });
      const glass = new Mesh(new BoxGeometry(5, 25, 6), glassMaterial);
      glass.visible = false;
      view.scene.add(base, block, glass);
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
      const read = () =>
        new Promise<Blob>(resolve =>
          view.renderer.domElement.toBlob(blob => resolve(blob!)),
        );
      const screen = async () => {
        view.renderFrame();
        return pixels(await read());
      };
      const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
        a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
      const place = (scale: number, translated = false) => {
        const origin = new Vector3(
          ...(translated
            ? ([10000, -5000, 8000] as const)
            : ([0, 0, 0] as const)),
        );
        for (const mesh of [base, block, glass]) mesh.scale.setScalar(scale);
        base.position.set(0, -1, 0).multiplyScalar(scale).add(origin);
        block.position.set(0, 8, 0).multiplyScalar(scale).add(origin);
        glass.position.set(13, 10, 12).multiplyScalar(scale).add(origin);
        view.camera.position.set(45, 36, 52).multiplyScalar(scale).add(origin);
        view.camera.lookAt(origin.add(new Vector3(0, 4 * scale, 0)));
        view.camera.near = scale * 0.1;
        view.camera.far = scale * 1000;
        view.camera.updateProjectionMatrix();
      };
      place(1);
      view.setMode('render');
      try {
        view.grid.visible = false;
        view.renderer.render(view.scene, view.camera);
        const flat = await pixels(await read());
        const lit = await screen();
        let darker = 0,
          unchangedBackground = true;
        for (let i = 0; i < flat.length; i += 4) {
          if (flat[i] - lit[i] > 12) darker++;
          if (
            flat[i] === flat[0] &&
            flat[i + 1] === flat[1] &&
            flat[i + 2] === flat[2]
          )
            unchangedBackground &&=
              lit[i] === flat[i] &&
              lit[i + 1] === flat[i + 1] &&
              lit[i + 2] === flat[i + 2];
        }
        const pngDifference = difference(
          lit,
          await pixels(await view.captureImage(320, 240)),
        );
        const scaled: number[] = [];
        for (const scale of [0.01, 100]) {
          place(scale);
          scaled.push(difference(lit, await screen()));
        }
        place(1, true);
        const translated = difference(lit, await screen());
        place(1);
        glass.visible = true;
        const flags = {
          transparent: glassMaterial.transparent,
          opacity: glassMaterial.opacity,
          depthWrite: glassMaterial.depthWrite,
        };
        let glassInNormalPass = 0;
        glass.onBeforeRender = (_renderer, scene) => {
          if (scene.overrideMaterial) glassInNormalPass++;
        };
        const withGlass = await screen();
        const glassPngDifference = difference(
          withGlass,
          await pixels(await view.captureImage(320, 240)),
        );
        const preservedFlags =
          JSON.stringify(flags) ===
          JSON.stringify({
            transparent: glassMaterial.transparent,
            opacity: glassMaterial.opacity,
            depthWrite: glassMaterial.depthWrite,
          });
        // An optically neutral transmission pane must still reveal the solids
        // behind it. This catches treating transmission as opaque, or removing
        // opaque objects from Three's internal transmission color pass.
        glass.visible = false;
        const behindGlass = await screen();
        glass.material = transmission;
        glass.scale.set(7, 1, 0.1);
        glass.position.set(0, 8, 18);
        glass.visible = true;
        const throughGlass = await screen();
        let transmissionDifference = 0,
          foreground = 0;
        for (let i = 0; i < behindGlass.length; i += 4) {
          if (behindGlass[i] === behindGlass[0]) continue;
          for (let c = 0; c < 3; c++)
            transmissionDifference += Math.abs(
              behindGlass[i + c] - throughGlass[i + c],
            );
          foreground += 3;
        }
        transmissionDifference /= foreground;
        view.camera = createViewCamera('orthographic', 4 / 3);
        if (view.camera.type === 'OrthographicCamera') {
          Object.assign(view.camera, {
            left: -32,
            right: 32,
            top: 24,
            bottom: -24,
          });
        }
        place(1);
        const orthographic = await screen();
        const orthographicPngDifference = difference(
          orthographic,
          await pixels(await view.captureImage(320, 240)),
        );
        view.setMode('modeling');
        const modeling = await screen();
        view.setMode('render');
        await screen();
        view.setMode('modeling');
        const modelingRestored = difference(modeling, await screen());
        const ao = view['renderLighting']['ao']!;
        let disposed = 0;
        const resources = [
          ao.gtaoMaterial,
          ao.blendMaterial,
          ao.normalMaterial,
          ao.pdMaterial,
          ao.copyMaterial,
          ao.depthRenderMaterial,
          ao.gtaoRenderTarget,
          ao.pdRenderTarget,
          ao.gtaoNoiseTexture,
          ao.pdNoiseTexture,
        ];
        for (const resource of resources)
          resource.addEventListener('dispose', () => disposed++);
        const displayMaterial =
          view['renderLighting']['materials'].get(material)!.material;
        let displayMaterialDisposals = 0;
        displayMaterial.addEventListener(
          'dispose',
          () => displayMaterialDisposals++,
        );
        material.dispose();
        view.dispose();
        return {
          darker,
          unchangedBackground,
          pngDifference,
          scaled,
          translated,
          glassInNormalPass,
          glassPngDifference,
          transmissionDifference,
          displayMaterialDisposals,
          preservedFlags,
          orthographicPngDifference,
          modelingRestored,
          disposed,
          resourceCount: resources.length,
          visible: [base.visible, block.visible, glass.visible],
          shadows: [
            base.castShadow,
            base.receiveShadow,
            view.renderer.shadowMap.enabled,
          ],
        };
      } finally {
        for (const mesh of [base, block, glass]) mesh.geometry.dispose();
        material.dispose();
        glassMaterial.dispose();
        transmission.dispose();
      }
    });
    assert.ok(result.darker > 150, JSON.stringify(result));
    assert.equal(result.unchangedBackground, true);
    assert.ok(result.pngDifference < 0.5, JSON.stringify(result));
    assert.ok(
      result.scaled.every(value => value < 1),
      JSON.stringify(result),
    );
    assert.ok(result.translated < 1, JSON.stringify(result));
    assert.equal(result.glassInNormalPass, 0);
    assert.equal(result.preservedFlags, true);
    assert.ok(result.glassPngDifference < 0.5, JSON.stringify(result));
    assert.ok(result.transmissionDifference < 2, JSON.stringify(result));
    assert.equal(result.displayMaterialDisposals, 1);
    assert.ok(result.orthographicPngDifference < 0.5, JSON.stringify(result));
    assert.equal(result.modelingRestored, 0);
    assert.equal(result.disposed, result.resourceCount);
    assert.deepEqual(result.visible, [true, true, true]);
    assert.deepEqual(result.shadows, [false, false, false]);
    assert.deepEqual(errors, []);
  },
);
