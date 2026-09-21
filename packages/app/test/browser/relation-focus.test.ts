import {appIsolationHeaders} from '../../build/response-headers.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from './browser-connection.ts';

test(
  'constraint function entries emphasize self on either side through parameter transitions and exports',
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
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/mobx/i.test(message.text())) errors.push(message.text());
    });
    const url = new URL(
      '/__constraint-entry-focus-test__',
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
      return fixture.measureConstraintEntryFocus();
    });
    assert.equal(samples.length, 16);
    for (const sample of samples) {
      const label = `${sample.expression}: ${sample.selection}`;
      const parameter = sample.selection === 'parameter';
      const primary = parameter ? 1 - sample.selfIndex : sample.selfIndex;
      assert.deepEqual(
        sample.models,
        [0, 1].map(side => !parameter && side === primary),
        label,
      );
      assert.deepEqual(
        sample.anchors,
        [0, 1].map(side => side === primary),
        label,
      );
      for (const drawn of [sample.onscreen, sample.exported]) {
        for (const side of [0, 1]) {
          const models = drawn.filter(
            item => item.side === side && item.kind === 'model',
          );
          assert.ok(models.length, label);
          assert.ok(
            models.every(
              item =>
                item.opacity === (!parameter && side === primary ? 0.68 : 0.4),
            ),
            label,
          );
          const markers = drawn.filter(
            item => item.side === side && item.kind !== 'model',
          );
          assert.ok(markers.length, label);
          const multiplier = side === primary ? 1 : 0.7;
          for (const marker of markers) {
            const base =
              marker.kind === 'surface'
                ? 0.18
                : sample.expression.startsWith('on(')
                  ? 0.85
                  : 0.98;
            assert.ok(
              Math.abs(marker.opacity - base * multiplier) < 1e-9,
              `${label}: ${JSON.stringify(marker)}`,
            );
          }
        }
      }
    }
    assert.deepEqual(errors, []);
  },
);

test(
  'ordinary expression previews retain authored opacity through inspection transitions and exports',
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
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL(
      '/__preview-material-test__',
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
      return fixture.measurePreviewMaterials();
    });
    assert.equal(samples.length, 10);
    for (const sample of samples) {
      const custom = sample.token.startsWith('custom(');
      assert.equal(sample.kind, custom ? 'inspect' : 'preview', sample.token);
      for (const drawn of [sample.onscreen, sample.exported]) {
        assert.ok(drawn.length, sample.token);
        for (const material of drawn) {
          const expected =
            sample.token === 'defaulted;'
              ? 0.68
              : material.color === '0000ff'
                ? 0.25
                : custom
                  ? 0.82
                  : 1;
          assert.equal(
            material.opacity,
            expected,
            `${sample.token}: ${JSON.stringify(drawn)}`,
          );
        }
      }
    }
    assert.deepEqual(errors, []);
  },
);

test(
  'inspection boundaries stay above their surfaces across camera rotations and image exports',
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
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL(
      '/__inspection-boundaries-test__',
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
      return fixture.measureInspectionBoundaries();
    });
    assert.equal(samples.length, 24);
    for (const sample of samples) {
      const label = `${sample.token} at ${sample.direction}`;
      for (const drawn of [sample.onscreen, sample.exported]) {
        for (const pair of sample.pairs) {
          assert.ok(
            drawn.indexOf(pair.surface) >= 0,
            `${label}: missing surface`,
          );
          assert.ok(
            drawn.indexOf(pair.edge) > drawn.indexOf(pair.surface),
            `${label}: edge precedes surface`,
          );
        }
        if (sample.foreground.length) {
          const lastSurface = Math.max(
            ...sample.pairs.map(pair => drawn.indexOf(pair.surface)),
          );
          assert.ok(
            sample.foreground.every(
              pair => drawn.indexOf(pair.edge) > lastSurface,
            ),
            `${label}: foreground edge covered by a surface`,
          );
        }
      }
      assert.ok(
        sample.changedPixels > 30,
        `${label}: boundaries must remain visible (${sample.changedPixels} pixels)`,
      );
    }
    assert.deepEqual(errors, []);
  },
);

test(
  'model array members remain visibly focused through every inspector, selection change and export',
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
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL(
      '/__collection-focus-test__',
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
      return fixture.measureCollectionFocus();
    });
    assert.equal(samples.length, 32);
    for (const sample of samples) {
      const label = `${sample.call} member ${sample.member}`;
      assert.equal(
        sample.items.filter(item => item.focused).length,
        sample.member < 0 ? 2 : 1,
        label,
      );
      const boolean = /intersect|cut/.test(sample.call);
      if (boolean) {
        assert.equal(
          sample.items.filter(item => !item.ambient && !item.focused).length,
          1,
          label,
        );
      }
      for (const drawn of [sample.onscreen, sample.exported]) {
        for (const [index, item] of sample.items.entries()) {
          assert.ok(drawn[index]?.length, `${label}: missing body ${index}`);
          const expected = item.ambient ? 0.18 : item.focused ? 0.68 : 0.4;
          assert.ok(
            drawn[index].every(value => value.opacity === expected),
            `${label}: ${JSON.stringify(drawn)}`,
          );
          if (boolean && !item.ambient && !item.focused) {
            const color = sample.call.startsWith('intersect')
              ? '66c9ff'
              : 'ffad4d';
            assert.ok(
              drawn[index].every(value => value.color === color),
              label,
            );
            assert.ok(
              drawn[index].every(
                value =>
                  value.order > 0 && !value.depthTest && !value.toneMapped,
              ),
              `${label}: region must composite over its inputs`,
            );
          }
        }
      }
    }
    assert.deepEqual(errors, []);
  },
);

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
      const expected = index === 0 ? [0.82, 0.4, 0.18] : [0.82, 0.82, 0.18];
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
      const relation = sample.token === 'on(' || sample.token === 'base.up';
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
