import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Page} from './browser-connection.ts';
import {clickSegment, open} from './sketch-test.ts';

const source = `import {sketch} from '@code3d/core';
const rightAngle = 90;
const value = sketch([
  ['point', 1, [0, 0]], ['circle', 2, [1, 8]],
  ['aux:line', 4, [1, 5]],
  ['point', 5, [-5.65685424949, 5.65685424949]],
  ['point', 6, [0, 8]], ['point', 7, [-7.5, 8]], ['line', 8, [6, 7]],
  ['point', 9, [-3.75, 8]], ['line', 10, [5, 9]],
], {constraints: [['fixed', 1], ['radius', 2, 8], ['angle', 4, 135], ['horizontal', 8]]});`;

async function selectLines(page: Page) {
  await clickSegment(
    page,
    page.locator('.sketch-canvas line.local[data-id="4"]'),
  );
  await page.keyboard.down('Shift');
  await clickSegment(
    page,
    page.locator('.sketch-canvas line.local[data-id="10"]'),
  );
  await page.keyboard.up('Shift');
}

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const {previewState, codeEditor, sketchEditor} = window.sketchTestRuntime;
    return (
      !sketchEditor.isStale &&
      previewState.sourceVersion === codeEditor.sourceVersion()
    );
  });
  await page.getByText('Ready', {exact: true}).waitFor();
}

async function assertContacts(page: Page) {
  const points = await page.evaluate(() => {
    const value = [
      ...window.sketchTestRuntime.previewState.module!.sketches.values(),
    ].at(-1)!;
    return value.entities
      .filter(e => e.kind === 'point')
      .map(e => [e.id, e.position] as const);
  });
  const positions = new Map(points);
  const p = positions.get(5)!,
    q = positions.get(9)!;
  assert.ok(Math.abs(Math.hypot(...p) - 8) < 1e-7);
  assert.ok(Math.abs(p[0] + p[1]) < 1e-7);
  assert.ok(Math.abs(p[0] * (q[0] - p[0]) + p[1] * (q[1] - p[1])) < 1e-6);
  assert.ok(Math.abs(q[1] - 8) < 1e-7);
  assert.ok(Math.abs(q[0] - (8 - 8 * Math.SQRT2)) < 1e-7);
  const renderedError = await page
    .locator('.sketch-canvas')
    .evaluate(canvas => {
      const shape = (id: number) =>
        canvas.querySelector(`circle.local[data-id="${id}"]`)!;
      const coordinate = (id: number, axis: 'cx' | 'cy') =>
        Number(shape(id).getAttribute(axis));
      return (
        Math.hypot(
          coordinate(5, 'cx') - coordinate(1, 'cx'),
          coordinate(5, 'cy') - coordinate(1, 'cy'),
        ) - Number(shape(2).getAttribute('r'))
      );
    });
  assert.ok(Math.abs(renderedError) < 0.05);
  assert.equal(
    await page.locator('.viewport-diagnostic[data-severity="warning"]').count(),
    0,
  );
}

for (const expression of [false, true])
  test(`${expression ? 'expression angle' : 'perpendicular'} editing keeps the circular junction and supports one-step undo, redo and fresh replay`, async t => {
    const page = await open(t, source);
    const before = await page.evaluate(() =>
      window.sketchTestEditor.getValue(),
    );
    await selectLines(page);
    await page
      .getByRole('toolbar', {name: 'Selection constraints'})
      .getByRole('button', {
        name: expression ? 'Angle between lines' : 'Perpendicular',
        exact: true,
      })
      .click();
    if (expression) {
      await page
        .getByRole('textbox', {name: 'Angle between lines', exact: true})
        .fill('-rightAngle');
      await page.keyboard.press('Enter');
    }
    await settled(page);
    await assertContacts(page);
    const after = await page.evaluate(() => window.sketchTestEditor.getValue());
    assert.match(
      after,
      expression
        ? /'angle',\s*\[4,\s*10\],\s*-rightAngle/
        : /'perpendicular',\s*\[4,\s*10\]/,
    );
    assert.match(after, /aux:line/);
    await page.keyboard.press('Control+z');
    await settled(page);
    assert.equal(
      await page.evaluate(() => window.sketchTestEditor.getValue()),
      before,
    );
    await page.keyboard.press('Control+y');
    await settled(page);
    await assertContacts(page);
    const fresh = await open(t, after);
    await settled(fresh);
    await assertContacts(fresh);
  });

test('editing a radius expression carries a point already on the circle', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const diameter = 40;
const value = sketch([['point', 1, [0, 0]], ['circle', 2, [1, 10]], ['point', 3, [10, 0]]], {constraints: [['fixed', 1], ['radius', 2, 10]]});`,
  );
  await page.locator('.constraint-badge[data-kind="radius"]').click();
  await page
    .getByRole('textbox', {name: 'Radius', exact: true})
    .fill('diameter / 2');
  await page.keyboard.press('Enter');
  await settled(page);
  const result = await page.evaluate(() => {
    const value = [
      ...window.sketchTestRuntime.previewState.module!.sketches.values(),
    ].at(-1)!;
    return {
      entities: value.entities,
      source: window.sketchTestEditor.getValue(),
    };
  });
  const curve = result.entities.find(e => e.kind === 'circle')!;
  const point = result.entities.find(e => e.kind === 'point' && e.id === 3)!;
  assert.equal(curve.kind, 'circle');
  assert.equal(point.kind, 'point');
  assert.equal(curve.radius, 20);
  assert.deepEqual(point.position, [20, 0]);
  assert.match(result.source, /'radius',\s*2,\s*diameter \/ 2/);
  assert.match(result.source, /'point',\s*3,\s*\[20,\s*0\]/);
  await page.keyboard.press('Control+z');
  await settled(page);
  assert.match(
    await page.evaluate(() => window.sketchTestEditor.getValue()),
    /'point',\s*3,\s*\[10,\s*0\]/,
  );
});

test('undo while connection repair is pending prevents a late coordinate write', async t => {
  const page = await open(t, source);
  const before = await page.evaluate(() => window.sketchTestEditor.getValue());
  await page.evaluate(() => {
    const host = window.sketchTestRuntime.sketchEditor['host'];
    const solve = host.solveConstraints;
    host.solveConstraints = async (layers, edit) => {
      const result = await solve(layers, edit);
      document.documentElement.dataset.connectionRepair = 'waiting';
      await new Promise<void>(resolve =>
        document.addEventListener(
          'release-connection-repair',
          () => resolve(),
          {once: true},
        ),
      );
      document.documentElement.dataset.connectionRepair = 'released';
      return result;
    };
  });
  await selectLines(page);
  await page.getByRole('button', {name: 'Perpendicular', exact: true}).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.connectionRepair === 'waiting',
  );
  await page.keyboard.press('Control+z');
  await settled(page);
  await page.evaluate(() =>
    document.dispatchEvent(new Event('release-connection-repair')),
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.connectionRepair === 'released',
  );
  await settled(page);
  assert.equal(
    await page.evaluate(() => window.sketchTestEditor.getValue()),
    before,
  );
  assert.equal(
    await page.locator('.constraint-badge[data-kind="perpendicular"]').count(),
    0,
  );
});
