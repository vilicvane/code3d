import {spatialAxisColors} from '../../src/spatial-axis-colors.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';

test(
  'distance renders solved context, both operands and stable labels in frames and PNG exports',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1000, height: 800},
      deviceScaleFactor: 2,
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('[mobx]'))
        errors.push(msg.text());
    });
    const url = new URL('/__distance-test__', process.env.CODE3D_TEST_URL).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<style>canvas{display:block;width:100%;height:100%}</style><body style="margin:0;background:#202326"><main style="width:1000px;height:800px"></main></body>',
      }),
    );
    await page.goto(url);
    const initial = await page.evaluate(async () => {
      const path = '/test/browser/distance-fixture.ts';
      const fixture: typeof import('./distance-fixture.ts') = await import(
        path
      );
      return fixture.startDistanceFixture();
    });
    assert.equal(initial.text, '60 · X');
    assert.equal(initial.axisInk, spatialAxisColors.x);
    assert.equal(initial.marks.dashed, true);
    assert.equal(initial.marks.color, 'c4c4c4');
    assert.equal(initial.marks.dash, 6);
    assert.equal(initial.marks.gap, 4);
    assert.ok(initial.marks.ticks.every(value => Math.abs(value - 12) < 0.01));
    assert.ok(!initial.kinds.includes('anchor'));
    assert.ok(initial.surfaces.length >= 2);
    assert.ok(initial.surfaces.every(value => value <= 0.18));
    assert.equal(initial.kinds.filter(value => value === 'surface').length, 2);
    assert.equal(initial.lineLength, 60);
    assert.equal(initial.corners.length, 16);
    assert.ok(initial.corners.every(value => value <= 32.01));
    assert.equal(initial.tools, undefined);
    assert.ok(initial.position.some(position => position[0] === 68));
    assert.ok(Math.abs(initial.labelPixels - 24) < 0.01);
    await page.screenshot({path: '/tmp/code3d-distance-viewport.png'});
    for (const [token, operand, kind] of [
      ['left.right,right.left', 0, 'value'],
      ['right,right.left', 0, 'element'],
      ["right.left,'x'", 1, 'value'],
      ["left,'x'", 1, 'element'],
    ] as const) {
      const selected = await page.evaluate(async token => {
        const path = '/test/browser/distance-fixture.ts';
        const fixture: typeof import('./distance-fixture.ts') = await import(
          path
        );
        return fixture.selectDistance(token);
      }, token);
      assert.equal(selected.focusKind, kind, token);
      assert.equal(
        selected.kinds.filter(value => value === 'anchor').length,
        kind === 'element' ? 1 : 0,
      );
      assert.equal(selected.text, initial.text);
      assert.equal(selected.lineLength, initial.lineLength);
      assert.deepEqual(selected.focused, [selected.operands[operand]]);
      const surfaces = selected.highlights.filter(d => d.kind === 'surface');
      assert.equal(surfaces.length, 2);
      assert.ok(
        surfaces.every(
          d =>
            Math.abs(
              d.opacity -
                0.18 *
                  (kind === 'element' && d.nodeId === selected.operands[operand]
                    ? 1
                    : 0.7),
            ) < 1e-6,
        ),
      );
      if (kind === 'value')
        assert.ok(selected.surfaces.some(value => value > 0.18));
      else assert.ok(selected.surfaces.every(value => value <= 0.18));
      if (kind === 'element' && operand === 0)
        await page.screenshot({path: '/tmp/code3d-distance-element-focus.png'});
    }
    for (const [token, operand] of [
      ['distance(left, right)', undefined],
      ['left, right', 0],
      ['right);', 1],
      ['tubeA, tubeB', 0],
      ['tubeB);', 1],
    ] as const) {
      const selected = await page.evaluate(async token => {
        const path = '/test/browser/distance-fixture.ts';
        const fixture: typeof import('./distance-fixture.ts') = await import(
          path
        );
        return fixture.selectDistance(token, true);
      }, token);
      assert.equal(
        selected.focusKind,
        operand === undefined ? 'inspect' : 'value',
      );
      assert.deepEqual(
        selected.focused,
        operand === undefined ? undefined : [selected.operands[operand]],
      );
      assert.ok(selected.surfaces.some(value => value > 0.18));
      assert.equal(
        selected.highlights.filter(d => d.kind === 'mesh').length,
        0,
      );
      assert.equal(selected.modelFaces.length, 2);
      for (const face of selected.modelFaces) {
        const primary =
          operand === undefined || face.nodeId === selected.operands[operand];
        assert.equal(face.color, primary ? '708090' : '788078');
        assert.ok(primary ? face.opacity > 0.18 : face.opacity === 0.18);
      }
      await page.screenshot({
        path: `/tmp/code3d-distance-${token.startsWith('tube') ? 'hollow' : 'solid'}-focus-${operand}.png`,
      });
    }
    const sameOwner = await page.evaluate(async () => {
      const path = '/test/browser/distance-fixture.ts';
      const fixture: typeof import('./distance-fixture.ts') = await import(
        path
      );
      return fixture.selectDistance('left,left.right');
    });
    assert.deepEqual(
      sameOwner.highlights
        .filter(d => d.kind === 'surface')
        .map(d => d.opacity)
        .sort(),
      [0.18 * 0.7, 0.18],
    );
    await page.evaluate(async () => {
      const path = '/test/browser/distance-fixture.ts';
      const fixture: typeof import('./distance-fixture.ts') = await import(
        path
      );
      return fixture.selectDistance('distance(left.right');
    });
    const exported = await page.evaluate(async () => {
      const path = '/test/browser/distance-fixture.ts';
      const fixture: typeof import('./distance-fixture.ts') = await import(
        path
      );
      return fixture.zoomAndExportDistance();
    });
    assert.ok(Math.abs(exported.zoomed.labelPixels - 24) < 0.01);
    assert.ok(exported.exported.length > 0);
    assert.ok(
      exported.zoomed.marks.ticks.every(value => Math.abs(value - 12) < 0.01),
    );
    assert.ok(
      exported.exported.every(
        value =>
          Math.abs(value.label - 24) < 0.01 &&
          value.marks.ticks.every(tick => Math.abs(tick - 12) < 0.01),
      ),
    );
    assert.ok(exported.pngBytes > 1000);
    for (const [token, text, highlight] of [
      ['distance(a,b)', '5', 'vertex'],
      ['distance(a,a)', '0', 'vertex'],
      ['distance(edge,b)', '', 'edge'],
      ['distance(left.surface', '', 'mesh'],
      ['distance(cluster,probe)', '', 'vertex'],
      ["distance(left.up,left.up,'y')", '0 · Y', 'surface'],
    ]) {
      const sample = await page.evaluate(async token => {
        const path = '/test/browser/distance-fixture.ts';
        const fixture: typeof import('./distance-fixture.ts') = await import(
          path
        );
        return fixture.selectDistance(token);
      }, token);
      if (text) assert.equal(sample.text, text);
      assert.equal(
        sample.axisInk,
        text.endsWith('Y') ? spatialAxisColors.y : undefined,
      );
      assert.ok(sample.marks.ticks.every(value => Math.abs(value - 12) < 0.01));
      assert.equal(sample.marks.ticks.length, sample.expected === 0 ? 1 : 2);
      if (token.includes('left.up,left.up'))
        assert.equal(
          sample.kinds.filter(value => value === 'surface').length,
          1,
        );
      assert.ok(
        [...sample.kinds, ...sample.renderedKinds].includes(highlight),
        token,
      );
      assert.ok(Math.abs(sample.lineLength - sample.expected) < 1e-5);
    }
    const pointToFace = await page.evaluate(async () => {
      const path = '/test/browser/distance-fixture.ts';
      const fixture: typeof import('./distance-fixture.ts') = await import(
        path
      );
      return fixture.selectDistance('distance(corner,left.front', true);
    });
    assert.equal(pointToFace.text, '32 · Z');
    for (const [actual, expected] of [
      [pointToFace.start, [-4, -15, -16]],
      [pointToFace.end, [-4, -15, 16]],
    ])
      actual.forEach((value, i) =>
        assert.ok(Math.abs(value - expected[i]) < 1e-6),
      );
    await page.screenshot({path: '/tmp/code3d-distance-point-to-face.png'});
    const cleared = await page.evaluate(async () => {
      const path = '/test/browser/distance-fixture.ts';
      const fixture: typeof import('./distance-fixture.ts') = await import(
        path
      );
      const result = await fixture.clearDistance();
      const exposed = await fixture.clearDistance('expose({');
      fixture.finishDistanceFixture();
      return [result, exposed];
    });
    for (const view of cleared) {
      assert.equal(view.layers, false);
      assert.ok(view.textures < initial.textures);
      assert.deepEqual(view.contextNodes, []);
      assert.equal(view.models.length, 3);
      assert.equal(new Set(view.models).size, 3);
    }
    assert.deepEqual(errors, []);
  },
);
