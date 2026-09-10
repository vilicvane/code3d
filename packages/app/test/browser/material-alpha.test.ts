import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';

test(
  'color alpha survives browser drawing and PNG export for every geometry kind',
  {timeout: 120_000},
  async t => {
    const appUrl = process.env.CODE3D_TEST_URL;
    assert.ok(appUrl, 'Set CODE3D_TEST_URL to the task development server');
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL('/__color-alpha-test__', appUrl).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main style="width:800px;height:600px"></main>',
      }),
    );
    await page.goto(url);
    const results = await page.evaluate(async () => {
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
      const samples = [];
      const pixels = async () => {
        const bitmap = await createImageBitmap(
          await viewport.captureImage(320, 240),
        );
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return context.getImageData(0, 0, 320, 240).data;
      };
      try {
        for (const [kind, geometry] of [
          ['solid', 'box(20, 30, 40)'],
          ['face', 'rectangle(20, 30)'],
          ['edge', 'line([0, 0, 0], [20, 30, 0])'],
          ['vertex', 'point()'],
        ] as const) {
          let reference: Uint8ClampedArray | undefined;
          for (const color of [
            '#f008',
            '#ff000088',
            `rgba(255, 0, 0, ${8 / 15})`,
            '#f000',
          ]) {
            const source = `import {box, rectangle, line, point} from '@code3d/core';
export default ${geometry}.material(${JSON.stringify(color)});`;
            const module = await client.compile(
              {files: [{path: '/model.ts', source}]},
              '/model.ts',
            );
            if (module.diagnostic) throw new Error(module.diagnostic.summary);
            viewport.renderModule(module);
            const drawn: {color: string; opacity: number}[] = [];
            const restore: (() => void)[] = [];
            for (const occurrence of viewport['occurrences'].values()) {
              if (occurrence.node.kind !== kind) continue;
              occurrence.object.traverse(object => {
                const mesh = object as import('three').Mesh<
                  import('three').BufferGeometry,
                  import('three').MeshStandardMaterial
                >;
                if (
                  !mesh.material ||
                  mesh.material.color.getHexString() !== 'ff0000'
                )
                  return;
                const original = mesh.onBeforeRender;
                mesh.onBeforeRender = (...args) => {
                  drawn.push({
                    color: mesh.material.color.getHexString(),
                    opacity: mesh.material.opacity,
                  });
                  original.apply(mesh, args);
                };
                restore.push(() => {
                  mesh.onBeforeRender = original;
                });
              });
            }
            try {
              viewport['rendering'].renderFrame();
              const frame = await pixels();
              let matches: boolean;
              if (color === '#f000') {
                viewport['root'].visible = false;
                const empty = await pixels();
                viewport['root'].visible = true;
                matches = frame.every((value, index) => value === empty[index]);
              } else {
                reference ??= frame;
                matches = frame.every(
                  (value, index) => value === reference![index],
                );
              }
              samples.push({kind, color, drawn, matches});
            } finally {
              restore.forEach(restore => restore());
            }
          }
        }
        return samples;
      } finally {
        viewport['renderer'].dispose();
        viewport['controls'].dispose();
        client.dispose();
      }
    });
    assert.equal(results.length, 16);
    for (const sample of results) {
      const label = `${sample.kind} ${sample.color}`;
      assert.ok(sample.drawn.length >= 2, label);
      for (const material of sample.drawn) {
        assert.equal(material.color, 'ff0000', label);
        assert.equal(
          material.opacity,
          sample.color === '#f000' ? 0 : 8 / 15,
          label,
        );
      }
      assert.equal(sample.matches, true, label);
    }
    assert.deepEqual(errors, []);
  },
);
