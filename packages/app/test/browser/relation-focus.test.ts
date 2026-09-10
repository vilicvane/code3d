import {appIsolationHeaders} from '../../build/isolation.ts';
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

test(
  'completed relate calls render all current references at secondary emphasis',
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
    assert.equal(samples.length, 10);
    assert.equal(samples.filter(sample => sample.exported).length, 2);
    for (const sample of samples) {
      const message = `${sample.token}, reverse=${sample.reverse}, export=${sample.exported}`;
      const whole = !['base.on(', 'self.on(base'].includes(sample.token);
      assert.equal(sample.constraintCount, whole ? 2 : 1, message);
      assert.equal(sample.selected, sample.expectedSelected, message);
      assert.deepEqual(
        new Set(sample.markers.map(marker => marker.nodeId)),
        new Set(sample.participantIds),
        message,
      );
      for (const marker of sample.markers) {
        assert.equal(
          marker.opacity,
          (marker.kind === 'surface' ? 0.18 : 0.85) *
            (marker.primary ? 1 : 0.7),
          `${message}: ${marker.kind}`,
        );
      }
      assert.equal(
        new Set(sample.bodies.map(body => body.nodeId)).size,
        5,
        message,
      );
      for (const role of ['primary', 'secondary', 'context']) {
        const bodies = sample.bodies.filter(body => body.role === role);
        assert.ok(bodies.length > 0, `${message}: ${role}`);
        for (const body of bodies) {
          assert.equal(
            body.opacity,
            role === 'primary'
              ? body.surface
                ? 0.82
                : 0.72
              : role === 'secondary'
                ? 0.7
                : body.surface
                  ? 0.18
                  : 0.28,
            `${message}: ${role}, surface=${body.surface}`,
          );
          if (role === 'context' || body.surface)
            assert.equal(
              body.color,
              role === 'context'
                ? body.surface
                  ? '788078'
                  : 'a1aa9d'
                : 'ff4d81',
              message,
            );
        }
      }
    }
  },
);
