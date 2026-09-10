import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

declare const window: Window & {
  gridRenderer: import('../../src/rendering/model-renderer.ts').ModelRenderer;
};

test(
  'drawn grids retain their spacing at extreme scales and pans; exports respect resolution, depth and render mode',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 640, height: 480},
      deviceScaleFactor: 2,
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/grid-test', route =>
      route.fulfill({
        contentType: 'text/html',
        body: `
    <style>html,body,#view{width:100%;height:100%;margin:0}canvas{display:block}</style><div id="view"></div>
    <script type="module">
      import {BoxGeometry, Mesh, MeshBasicMaterial} from '/@id/three';
      import {ModelRenderer} from '/src/rendering/model-renderer.ts';
      import {createViewCamera} from '/src/rendering/view-camera.ts';
      const renderer = new ModelRenderer(document.querySelector('#view'));
      renderer.camera = createViewCamera('orthographic', 4/3);
      const occluder = new Mesh(new BoxGeometry(8, 8, 2), new MeshBasicMaterial({color: '#ff0000', toneMapped: false}));
      occluder.name = 'occluder';
      occluder.position.z = 2;
      renderer.scene.add(occluder);
      window.gridRenderer = renderer;
    </script>`,
      }),
    );
    await page.goto(`${process.env.CODE3D_TEST_URL}/grid-test`);
    await page.waitForFunction(() => window.gridRenderer);
    const result = await page.evaluate(async () => {
      const r = window.gridRenderer;
      const camera = r.camera as import('three').OrthographicCamera;
      const focus = camera.position.clone();
      const pose = (span: number, x = 0, y = 0) => {
        focus.set(x, y, 0);
        camera.position.set(x, y, span * 2);
        camera.up.set(0, 1, 0);
        camera.lookAt(focus);
        camera.top = span / 2;
        camera.bottom = -span / 2;
        camera.left = (-span * 2) / 3;
        camera.right = (span * 2) / 3;
        camera.updateProjectionMatrix();
        r.updateCameraRange(focus, span * 2);
        r.renderFrame();
      };
      const read = (canvas: HTMLCanvasElement) => {
        const image = document.createElement('canvas');
        image.width = 640;
        image.height = 480;
        const context = image.getContext('2d')!;
        context.drawImage(canvas, 0, 0, 640, 480);
        return [...context.getImageData(0, 101, 640, 1).data].filter(
          (_, i) => i % 4 === 0,
        );
      };
      const rows: number[][] = [];
      for (const span of [60, 0.006, 600000]) {
        // An integral number of major-grid periods makes the distant image identical.
        pose(span, span * 1e5, span * 2e5);
        rows.push(read(r.renderer.domElement));
      }
      const subdivisions = [48, 96, 150, 480, 960, 1500].map(span => {
        pose(span, span * 100, span * 200);
        return {span, step: r.grid.step, row: read(r.renderer.domElement)};
      });
      pose(60, 6000, 12000);
      const snapshot = () => ({
        plane: r.grid.plane,
        step: r.grid.step,
        pixelRatio: r.grid.material.uniforms.pixelRatio.value,
      });
      const live = snapshot();
      const draws: ReturnType<typeof snapshot>[] = [];
      r.grid.onBeforeRender = () => {
        draws.push(snapshot());
      };
      const exported = await r.captureImage(1280, 960);
      const restored = snapshot();
      const decoded = await createImageBitmap(exported);
      const image = document.createElement('canvas');
      image.width = decoded.width;
      image.height = decoded.height;
      const ctx = image.getContext('2d')!;
      ctx.drawImage(decoded, 0, 0);
      decoded.close();
      const row = [...ctx.getImageData(0, 201, 1280, 1).data].filter(
        (_, i) => i % 4 === 0,
      );
      const colored = (values: number[]) => values.filter(v => v > 26).length;
      r.setMode('render');
      r.renderFrame();
      const rendered = read(r.renderer.domElement);
      const exportedRender = await r.captureImage(640, 480);
      const renderBitmap = await createImageBitmap(exportedRender);
      ctx.clearRect(0, 0, 1280, 960);
      ctx.drawImage(renderBitmap, 0, 0);
      renderBitmap.close();
      const renderPixel = [...ctx.getImageData(320, 240, 1, 1).data];
      r.setMode('modeling');
      r.renderFrame();
      const resumed = read(r.renderer.domElement);
      pose(60);
      const centerPixel = () => {
        ctx.clearRect(0, 0, 1280, 960);
        ctx.drawImage(r.renderer.domElement, 0, 0, 640, 480);
        return [...ctx.getImageData(320, 240, 1, 1).data];
      };
      const occluded = centerPixel();
      r.scene.getObjectByName('occluder')!.position.z = -2;
      r.renderFrame();
      const inFront = centerPixel();
      r.scene.getObjectByName('occluder')!.visible = false;
      const axisColors: {plane: string; axis: string; pixel: number[]}[] = [];
      for (const normal of ['x', 'y', 'z'] as const) {
        camera.position.set(0, 0, 0);
        camera.position[normal] = 120;
        camera.up.set(0, normal === 'y' ? 0 : 1, normal === 'y' ? -1 : 0);
        camera.lookAt(focus);
        r.updateCameraRange(focus, 120);
        r.renderFrame();
        ctx.clearRect(0, 0, 1280, 960);
        ctx.drawImage(r.renderer.domElement, 0, 0, 640, 480);
        for (const [channel, axis] of (['x', 'y', 'z'] as const).entries()) {
          if (axis === normal) continue;
          const point = focus.clone();
          point[axis] = 12;
          point.project(camera);
          const x = Math.round((point.x + 1) * 320);
          const y = Math.round((1 - point.y) * 240);
          const pixels = ctx.getImageData(x - 1, y - 1, 3, 3).data;
          let pixel = [0, 0, 0, 0];
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + channel] > pixel[channel]) {
              pixel = [...pixels.slice(i, i + 4)];
            }
          }
          axisColors.push({plane: r.grid.plane, axis, pixel});
        }
      }
      return {
        axisColors,
        occluded,
        inFront,
        rows,
        subdivisions,
        live,
        draws,
        restored,
        image: [image.width, image.height],
        exportedLines: colored(row),
        renderedLines: colored(rendered),
        renderPixel,
        resumedLines: colored(resumed),
      };
    });
    for (const row of result.rows) {
      assert.ok(
        row.some(value => value > 30),
        'Grid lines actually draw at every scale',
      );
      assert.ok(
        row.some(value => value === 23),
        'Cells retain the background',
      );
      const starts = row.flatMap((value, index) =>
        value > 26 && (index === 0 || row[index - 1] <= 26) ? [index] : [],
      );
      assert.ok(
        starts.length >= 75 && starts.length <= 81,
        `Expected 8px cells, got ${starts.length} lines`,
      );
    }
    for (const {span, step, row} of result.subdivisions) {
      const spacing = (step * 480) / span;
      const starts = row
        .flatMap((value, index) =>
          value > 26 && (index === 0 || row[index - 1] <= 26) ? [index] : [],
        )
        .filter(index => index > 1 && index < 638);
      assert.ok(starts.length >= Math.floor(640 / spacing) - 2);
      for (let i = 1; i < starts.length; i++) {
        assert.ok(
          Math.abs(starts[i] - starts[i - 1] - spacing) <= 1,
          `At span ${span}, displayed step ${step} should give ${spacing}px cells, got ${starts[i] - starts[i - 1]}px`,
        );
      }
    }
    result.rows[0].forEach((value, index) => {
      assert.ok(Math.abs(value - result.rows[1][index]) <= 1);
      assert.ok(Math.abs(value - result.rows[2][index]) <= 1);
    });
    assert.deepEqual(result.live, {plane: 'XY', step: 1, pixelRatio: 2});
    assert.deepEqual(result.restored, result.live);
    assert.deepEqual(result.draws[0], {plane: 'XY', step: 0.5, pixelRatio: 1});
    assert.deepEqual(result.image, [1280, 960]);
    assert.ok(result.exportedLines > 100);
    assert.equal(result.renderedLines, 0);
    assert.deepEqual(result.renderPixel, [23, 24, 21, 255]);
    assert.ok(result.resumedLines > 50);
    assert.deepEqual(
      result.occluded,
      [255, 0, 0, 255],
      'Opaque geometry hides the grid behind it',
    );
    assert.ok(
      result.inFront[1] > 10,
      'Grid in front of geometry uses the plane intersection depth',
    );
    for (const {plane, axis, pixel} of result.axisColors) {
      const channel = ['x', 'y', 'z'].indexOf(axis);
      for (let other = 0; other < 3; other++) {
        if (other === channel) continue;
        assert.ok(
          pixel[channel] > pixel[other] + 5,
          `${plane} grid's ${axis} center line has the corresponding axis color: ${pixel}`,
        );
      }
    }
    assert.deepEqual(errors, []);
  },
);
