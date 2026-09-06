import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'relation focus renders primary, secondary and outer context in frames and exports',
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
    assert.ok(samples.some(sample => sample.exported));
    for (const sample of samples) {
      const message = `${sample.label} at ${sample.token}, export=${sample.exported}`;
      const [base, self, other] = sample.participants;
      assert.equal(
        sample.source,
        sample.label === 'reverse bound' ? base : self,
        message,
      );
      assert.equal(
        sample.target,
        sample.label === 'reverse bound'
          ? self
          : sample.token.includes('other.front')
            ? other
            : base,
        message,
      );
      assert.equal(
        sample.primary,
        sample.label === 'reverse bound' ||
          sample.token === '/* target */' ||
          sample.token === 'other.front'
          ? 'target'
          : 'source',
        message,
      );
      assert.equal(
        sample.selected,
        sample.primary === 'source' ? sample.source : sample.target,
        message,
      );
      for (const side of ['source', 'target']) {
        const drawn = sample.drawn.filter(part => part.side === side);
        assert.ok(drawn.length > 0, message);
        for (const part of drawn)
          assert.equal(
            part.opacity,
            part.baseOpacity * (side === sample.primary ? 1 : 0.7),
            `${message}: ${side} ${part.kind}`,
          );
        if (sample.label.includes('bound')) {
          assert.equal(
            drawn.filter(part => part.kind === 'surface').length,
            1,
            message,
          );
          if (side === 'source') {
            assert.equal(
              drawn.filter(part => part.kind === 'bounds').length,
              1,
              message,
            );
            assert.equal(
              drawn.filter(part => part.kind === 'edges').length,
              0,
              message,
            );
          }
        }
      }
      if (sample.selectionBox !== undefined)
        assert.equal(sample.selectionBox, 0.85, message);
      assert.equal(sample.topologyHighlights, 0, message);
      for (const role of ['primary', 'secondary', 'context'] as const) {
        const bodies = sample.bodies.filter(body => body.role === role);
        assert.ok(bodies.length > 0, `${message}: ${role} bodies`);
        for (const body of bodies) {
          const surface = body.kind === 'surface';
          const expected = {
            primary: surface
              ? sample.label === 'painted bound'
                ? 0.82
                : 0.68
              : sample.label === 'point' || sample.label === 'curve'
                ? 1
                : 0.72,
            // The default surface is already more transparent than the cap.
            secondary: surface && sample.label !== 'painted bound' ? 0.68 : 0.7,
            context: surface ? 0.18 : 0.28,
          }[role];
          assert.equal(
            body.opacity,
            expected,
            `${message}: ${role} ${body.kind}`,
          );
          if (role === 'context')
            assert.equal(body.color, surface ? '788078' : 'a1aa9d', message);
          else if (sample.label === 'painted bound' && surface)
            assert.equal(body.color, 'ff4d81', message);
        }
      }
    }
  },
);
