import {appIsolationHeaders} from '../../build/isolation.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'inspect target focus, target and ambient tiers agree between frames and exported images',
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
    const url = new URL('/__relation-focus-test__', process.env.CODE3D_TEST_URL)
      .href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main style="width:900px;height:700px"></main>',
      }),
    );
    await page.goto(url);
    const samples = await page.evaluate(async () => {
      const path = '/test/browser/relation-focus-fixture.ts';
      const fixture: typeof import('./relation-focus-fixture.ts') =
        await import(path);
      return fixture.measureRelationFocus();
    });
    assert.deepEqual(
      samples.map(sample => sample.focused),
      [
        [true, false],
        [true, true],
      ],
    );
    for (const [index, sample] of samples.entries()) {
      const expected = index === 0 ? [0.82, 0.7, 0.18] : [0.82, 0.82, 0.18];
      for (const drawn of [sample.onscreen, sample.exported]) {
        for (let i = 0; i < 3; i++) {
          assert.ok(drawn[i]?.length, `Missing rendered body ${i}`);
          assert.ok(
            drawn[i].every(value => value === expected[i]),
            JSON.stringify(drawn),
          );
        }
      }
    }
  },
);

test(
  'completed relate calls retain participants without unselected relation markers',
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
    const url = new URL(
      '/__completed-relation-focus-test__',
      process.env.CODE3D_TEST_URL,
    ).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main style="width:900px;height:700px"></main>',
      }),
    );
    await page.goto(url);
    const samples = await page.evaluate(async () => {
      const path = '/test/browser/relation-focus-fixture.ts';
      const fixture: typeof import('./relation-focus-fixture.ts') =
        await import(path);
      return fixture.measureCompletedRelationFocus();
    });
    assert.equal(samples.length, 4);
    for (const sample of samples) {
      assert.equal(sample.extraVisible, false, sample.token);
      const relation = sample.token === '.on(' || sample.token === 'base.up';
      assert.equal(sample.ambient, relation ? 0 : 1, sample.token);
      assert.equal(
        sample.targets.filter(kind => kind === 'anchor').length,
        relation ? 2 : 0,
        sample.token,
      );
      assert.equal(sample.markers > 0, relation, sample.token);
      if (sample.token === 'base.up')
        assert.deepEqual(sample.focused, ['anchor']);
    }
  },
);
