import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium, type Page} from './browser-connection.ts';

declare const window: Window & {
  parameterHighlightApp: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
    previewState: import('../../src/model/preview-state.ts').ModelPreviewState;
  };
};

const source = `import {box, rectangle, circle, extrude} from '@code3d/core';

const size = 24;
const body = box(size, size + 12, 18);
const rounded = body.fillet(2, [1, 3]);
const rebased = body.rotate(20, 30, 40).originVertex(3);
const profile = rectangle(20, 30).rotate(0, 0, 90).originOffset(4, 5, 6);
const pulled = extrude(profile, -12);
const round = extrude(circle(12), 20);
const missingX = box( /* missing x */ );
const missingY = box(24, /* missing y */ );
const missingZ = box(24, 36, /* missing z */ );
const defaulted = box(undefined, undefined, undefined);
`;

async function focus(page: Page, token: string, delta = 0) {
  await page.evaluate(
    ({source, token, delta}) => {
      const editor = window.parameterHighlightApp.codeEditor['editor'];
      editor.setPosition(
        editor.getModel()!.getPositionAt(source.indexOf(token) + delta),
      );
      editor.focus();
    },
    {source, token, delta},
  );
  await page.waitForFunction(
    () => !window.parameterHighlightApp.previewState.inspecting,
  );
}

async function measure(page: Page) {
  return page.evaluate(async () => {
    const {viewport} = window.parameterHighlightApp;
    const instances = [
      ...(viewport['decorationLayers'].get('inspection') ?? []).filter(
        instance => instance.measurement,
      ),
      ...(viewport['decorationLayers'].get(
        'source-context:parameter-geometry',
      ) ?? []),
    ];
    const guides = instances.map(instance => {
      const group = instance.object.children[0];
      const decoration = group.userData
        .decoration as import('../../src/viewport-decoration.ts').ViewportDecoration;
      return {
        object: instance.object,
        group,
        kind: decoration.kind,
        dimension:
          decoration.kind === 'measurement'
            ? {
                value: decoration.value,
                axisLabel: decoration.axisLabel,
                style: decoration.style,
                start: (
                  decoration as import('../../src/viewport-decoration.ts').ViewportMeasurementDecoration &
                    import('@code3d/core').DimensionSegment
                ).start,
                end: (
                  decoration as import('../../src/viewport-decoration.ts').ViewportMeasurementDecoration &
                    import('@code3d/core').DimensionSegment
                ).end,
              }
            : undefined,
        topologyKind:
          decoration.kind === 'topology' ? decoration.topologyKind : undefined,
        ids: decoration.kind === 'topology' ? decoration.ids : undefined,
      };
    });
    let draws = 0;
    let exportedDraws = 0;
    const widths: number[] = [];
    const lines: {color: string; dashed: boolean; opacity: number}[] = [];
    const restore: (() => void)[] = [];
    for (const {object} of guides)
      object.traverse(child => {
        if (!('material' in child)) return;
        const before = child.onBeforeRender;
        child.onBeforeRender = function (...args) {
          if (args[2] === viewport['camera']) draws++;
          else exportedDraws++;
          const material =
            child.material as import('three/addons/lines/LineMaterial.js').LineMaterial;
          if (material.linewidth !== undefined) widths.push(material.linewidth);
          if (child.name === 'distance-line')
            lines.push({
              color: material.color.getHexString(),
              dashed: material.dashed,
              opacity: material.opacity,
            });
          before.apply(this, args);
        };
        restore.push(() => {
          child.onBeforeRender = before;
        });
      });
    try {
      viewport['rendering'].renderFrame();
      const liveDraws = draws;
      const blob = await viewport.captureImage(800, 600);
      const bitmap = await createImageBitmap(blob);
      const pixels = document.createElement('canvas');
      pixels.width = bitmap.width;
      pixels.height = bitmap.height;
      const context = pixels.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const rgba = context.getImageData(0, 0, pixels.width, pixels.height).data;
      let greenPixels = 0;
      for (let i = 0; i < rgba.length; i += 4)
        if (rgba[i] > 140 && rgba[i + 1] > 200 && rgba[i + 2] < 120)
          greenPixels++;
      return {
        guides: guides.map(({object, group, ...guide}) => ({
          ...guide,
          uuid: group.uuid,
          visible: object.visible,
        })),
        liveDraws,
        exportedDraws,
        bytes: blob.size,
        greenPixels,
        widths,
        lines,
        camera: viewport['camera'].position.toArray(),
        selectedKey: viewport.getSelected()?.key,
        scene: viewport['activeScene']?.key,
      };
    } finally {
      restore.forEach(restore => restore());
    }
  });
}

test(
  'editor argument focus draws stable dimension edges and transformed topology in modeling only',
  {timeout: 180_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1440, height: 1000},
      reducedMotion: 'reduce',
    });
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' || message.text().includes('[mobx]'))
        errors.push(message.text());
    });
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.parameterHighlightApp = {viewport, codeEditor, previewState};',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await page.evaluate(source => {
      const editor = window.parameterHighlightApp.codeEditor['editor'];
      editor.getModel()!.setValue(source);
      editor.setPosition(
        editor.getModel()!.getPositionAt(source.indexOf('size,') + 3),
      );
      editor.focus();
    }, source);
    await page.waitForFunction(
      () =>
        window.parameterHighlightApp.viewport['sourceParameter']?.parameter
          .name === 'x' &&
        window.parameterHighlightApp.viewport['module']?.diagnostic ===
          undefined,
    );
    const x = await measure(page);
    assert.equal(x.guides.length, 1);
    assert.equal(x.guides[0].dimension?.value, 24);
    assert.equal(x.guides[0].dimension?.axisLabel, 'X');
    assert.equal(x.guides[0].dimension?.style, 'edge');
    assert.ok(x.lines.length > 0);
    assert.ok(
      x.lines.every(
        line => line.color === 'd8ff3e' && !line.dashed && line.opacity === 1,
      ),
    );
    assert.ok(x.guides[0].dimension?.start);
    assert.ok(x.liveDraws > 0);
    assert.ok(x.exportedDraws > 0);
    assert.ok(x.greenPixels > 10);
    assert.ok(x.widths.every(width => width === 1));
    if (process.env.CODE3D_SCREENSHOT_PATH)
      await page.screenshot({path: process.env.CODE3D_SCREENSHOT_PATH});

    await focus(page, 'size,', 4);
    const same = await measure(page);
    assert.deepEqual(same.guides[0].dimension, x.guides[0].dimension);
    const beforeOrbit = same.guides[0].dimension;
    const canvas = (await page.locator('.viewport-canvas').boundingBox())!;
    await page.mouse.move(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      canvas.x + canvas.width / 2 + 100,
      canvas.y + canvas.height / 2 + 40,
      {steps: 6},
    );
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        window.parameterHighlightApp.viewport['controls']['_animationId'] ===
        -1,
    );
    const orbited = await measure(page);
    assert.deepEqual(orbited.guides[0].dimension, beforeOrbit);
    assert.notDeepEqual(orbited.camera, same.camera);

    await focus(page, 'size + 12', 5);
    const y = await measure(page);
    assert.equal(y.guides[0].dimension?.value, 36);
    assert.ok(
      y.camera.every(
        (value, index) => Math.abs(value - orbited.camera[index]) < 1e-9,
      ),
    );
    assert.equal(y.scene, orbited.scene);
    assert.equal(y.selectedKey, orbited.selectedKey);
    await page.getByRole('button', {name: 'Render', exact: true}).click();
    const render = await measure(page);
    assert.equal(render.liveDraws, 0);
    assert.equal(render.exportedDraws, 0);
    await page.getByRole('button', {name: 'Modeling', exact: true}).click();
    assert.ok((await measure(page)).liveDraws > 0);

    for (const [token, axis] of [
      ['/* missing x */', 'X'],
      ['/* missing y */', 'Y'],
      ['/* missing z */', 'Z'],
      ['undefined, undefined, undefined', 'X'],
      ['undefined, undefined)', 'Y'],
      ['undefined)', 'Z'],
    ] as const) {
      await focus(page, token, 2);
      const omitted = await measure(page);
      assert.equal(omitted.guides.length, 1, token);
      assert.equal(omitted.guides[0].dimension?.value, 10, token);
      assert.equal(omitted.guides[0].dimension?.axisLabel, axis, token);
      assert.ok(
        omitted.lines.every(
          line => line.color === 'd8ff3e' && !line.dashed && line.opacity === 1,
        ),
      );
      assert.ok(omitted.liveDraws > 0, token);
      assert.ok(omitted.exportedDraws > 0, token);
      assert.ok(omitted.greenPixels > 10, token);
    }

    await focus(page, '[1, 3]', 3);
    const fillet = await measure(page);
    assert.equal(fillet.guides[0].topologyKind, 'edge');
    assert.deepEqual(fillet.guides[0].ids, [1, 3]);
    // The interactive selector owns this same highlight while active.
    assert.equal(fillet.guides[0].visible, false);
    await page.evaluate(() =>
      window.parameterHighlightApp.viewport.endTopologySelection(),
    );
    assert.ok((await measure(page)).liveDraws > 0);
    await focus(page, '2, [');
    assert.deepEqual((await measure(page)).guides, []);

    await focus(page, 'originVertex(3)', 'originVertex('.length);
    const vertex = await measure(page);
    assert.equal(vertex.guides[0].topologyKind, 'vertex');
    assert.deepEqual(vertex.guides[0].ids, [3]);
    const vertexPosition = await page.evaluate(() => {
      const {viewport} = window.parameterHighlightApp;
      const group = viewport['decorationLayers'].get(
        'source-context:parameter-geometry',
      )![0].object.children[0];
      const points = group.children[0] as import('three').Points;
      const position = points.geometry.getAttribute('position');
      return [
        position.getX(0) + group.position.x,
        position.getY(0) + group.position.y,
        position.getZ(0) + group.position.z,
      ];
    });
    assert.ok(Math.hypot(...vertexPosition) < 1e-5);

    await focus(page, '-12', 2);
    const extrusion = await measure(page);
    assert.equal(extrusion.guides[0].dimension?.value, -12);
    assert.ok(extrusion.liveDraws > 0);
    await focus(page, '20);');
    const round = await measure(page);
    assert.equal(round.guides[0].dimension?.value, 20);
    assert.ok(round.liveDraws > 0);
    await focus(page, 'const size');
    assert.deepEqual((await measure(page)).guides, []);
    assert.equal(await page.locator('.viewport-canvas').count(), 1);
    assert.deepEqual(errors, []);
  },
);
