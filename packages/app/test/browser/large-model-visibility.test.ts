import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'large models retain their color through close zooms and image exports',
  {timeout: 60_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 640, height: 480},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/large-model-test', route =>
      route.fulfill({
        contentType: 'text/html',
        body: `
    <style>html,body,#view{width:100%;height:100%;margin:0}</style><div id="view"></div>
    <script type="module">
    import {BoxGeometry, Mesh, MeshBasicMaterial, Vector3} from '/@id/three';
    import {ModelRenderer} from '/src/rendering/model-renderer.ts';
    import {createViewCamera} from '/src/rendering/view-camera.ts';
    const r = new ModelRenderer(document.querySelector('#view'));
    r.grid.visible = false;
    const model = new Mesh(new BoxGeometry(4000, 4000, 200), new MeshBasicMaterial({color:'#ff0000', toneMapped:false}));
    model.position.z = -3000;
    r.scene.add(model);
    const pixel = source => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d'); ctx.drawImage(source,0,0,640,480);
      return [...ctx.getImageData(320,240,1,1).data];
    };
    window.runVisibility = async () => {
      const samples = [];
      for (const projection of ['perspective','orthographic']) {
        r.camera = createViewCamera(projection,4/3);
        for (const mode of ['modeling','render']) {
          r.setMode(mode);
          for (const distance of [5000,500,100,10]) {
            r.camera.position.set(0,0,distance);
            r.camera.lookAt(0,0,0);
            r.updateCameraRange(new Vector3(),distance,model);
            r.renderFrame();
            const live = pixel(r.renderer.domElement);
            const blob = await r.captureImage(640,480);
            const bitmap = await createImageBitmap(blob);
            const exported = pixel(bitmap); bitmap.close();
            samples.push({projection,mode,distance,live,exported,far:r.camera.far});
          }
        }
      }
      return samples;
    };
    </script>`,
      }),
    );
    await page.goto(`${process.env.CODE3D_TEST_URL}/large-model-test`);
    await page.waitForFunction('window.runVisibility');
    const samples = (await page.evaluate('window.runVisibility()')) as {
      projection: string;
      mode: string;
      distance: number;
      live: number[];
      exported: number[];
      far: number;
    }[];
    for (const sample of samples) {
      assert.deepEqual(sample.live, [255, 0, 0, 255], JSON.stringify(sample));
      assert.deepEqual(sample.exported, sample.live, JSON.stringify(sample));
      assert.ok(sample.far > sample.distance + 3100);
    }
    await page.screenshot({path: '/tmp/code3d-large-model-visible.png'});
    assert.deepEqual(errors, []);
  },
);
