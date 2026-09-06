import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'direction heads keep their raster size through zoom, scale, resize and pixel ratio',
  {timeout: 60_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL('/__screen-arrow-test__', process.env.CODE3D_TEST_URL)
      .href;
    await page.route(url, route =>
      route.fulfill({contentType: 'text/html', body: '<main></main>'}),
    );
    await page.goto(url);
    const {samples, corners} = await page.evaluate(async () => {
      const {measureDirectionHeads, measureCornerFrames} =
        await import('/test/browser/screen-space-arrow-fixture.mjs');
      return {samples: measureDirectionHeads(), corners: measureCornerFrames()};
    });
    for (const {runs, expected} of corners) {
      assert.equal(runs.length, 2, JSON.stringify({runs, expected}));
      assert.ok(
        runs.every(length => Math.abs(length - expected) <= 2),
        JSON.stringify({runs, expected}),
      );
    }
    for (const sample of samples) {
      assert.ok(Math.abs(sample.width - 6) <= 1, JSON.stringify(sample));
      assert.ok(Math.abs(sample.height - 10) <= 1, JSON.stringify(sample));
      assert.ok(
        Math.abs(sample.tipX - sample.expectedTip[0]) <= 0.5,
        JSON.stringify(sample),
      );
      assert.ok(
        Math.abs(sample.tipY - sample.expectedTip[1]) <= 1,
        JSON.stringify(sample),
      );
    }
  },
);
