import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appIsolationHeaders} from '../../build/response-headers.ts';
import {chromium} from './browser-connection.ts';

test(
  'construction curves have continuous pixel dashes in 3D and image export',
  {timeout: 60_000},
  async t => {
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1000, height: 660},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const url = new URL(
      '/__sketch-construction-render__',
      process.env.CODE3D_TEST_URL,
    ).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<body style="background:#10120f"><main style="width:960px;height:600px"></main></body>',
      }),
    );
    await page.goto(url);
    const {samples, exported} = await page.evaluate(async () => {
      const {measureConstruction} =
        await import('/test/browser/sketch-construction-render-fixture.ts');
      return measureConstruction();
    });
    for (const sample of samples) {
      assert.equal(sample.solid.length, 1, JSON.stringify(sample));
      assert.ok(sample.dashed.length >= 8, JSON.stringify(sample));
      assert.ok(
        sample.dashed.slice(1, -1).every(run => run >= 5 && run <= 9),
        JSON.stringify(sample),
      );
      assert.ok(
        sample.circleFraction > 0.4 && sample.circleFraction < 0.92,
        JSON.stringify(sample),
      );
    }
    assert.ok(exported.length > 15, JSON.stringify(exported));
    assert.ok(
      exported.slice(1, -1).every(run => run >= 5 && run <= 7),
      JSON.stringify(exported),
    );
    assert.deepEqual(errors, []);
    await page.screenshot({path: '/tmp/code3d-244-construction-render.png'});
  },
);
