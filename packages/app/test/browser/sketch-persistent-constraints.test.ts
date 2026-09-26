import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import type {Page} from './browser-connection.ts';
import {open, point} from './sketch-test.ts';

const toolbar = (page: Page) =>
  page.getByRole('toolbar', {name: 'Selection constraints'});
const source = (page: Page) =>
  page.evaluate(() => window.sketchTestEditor.getValue());

test('the public plate example keeps matching holes on its median and tangent guide', async t => {
  const example = await readFile(
    new URL(
      '../../examples/sketches/persistent-constraints.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const lines = example.split('\n');
  const line = lines.findIndex(value =>
    value.includes('export const profile ='),
  );
  const cursor = {line: line + 1, column: lines[line].indexOf('profile') + 3};
  for (const radius of [8, 6]) {
    const page = await open(
      t,
      example.replace('holeRadius = 8', `holeRadius = ${radius}`),
      cursor,
    );
    const solved = await entities(page);
    const circles = solved.filter(e => e.kind === 'circle');
    assert.deepEqual(
      circles.map(e => e.radius),
      [radius, radius],
    );
    for (const [id, y] of [
      [7, 4 + radius],
      [11, 30],
    ]) {
      const p = solved.find(e => e.kind === 'point' && e.id === id)!;
      assert.equal(p.kind, 'point');
      assert.ok(Math.abs(p.position[0] - 30) < 1e-7);
      assert.ok(Math.abs(p.position[1] - y) < 1e-7);
    }
    if (radius === 8)
      await page.screenshot({path: '/tmp/code3d-persistent-constraints.png'});
  }
});

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

async function entities(page: Page) {
  await settled(page);
  return page.evaluate(
    () =>
      [...window.sketchTestRuntime.previewState.module!.sketches.values()].at(
        -1,
      )!.entities,
  );
}

async function selectCurve(page: Page, id: number, add = false) {
  const curve = page.locator(`.sketch-canvas .local[data-id="${id}"]`).first();
  const position = await curve.evaluate(element => {
    const curve = element as SVGGeometryElement;
    const point = curve
      .getPointAtLength(curve.getTotalLength() * 0.3)
      .matrixTransform(curve.getScreenCTM()!);
    return {x: point.x, y: point.y};
  });
  if (add) await page.keyboard.down('Shift');
  await page.mouse.click(position.x, position.y);
  if (add) await page.keyboard.up('Shift');
}

async function addConstraint(page: Page, name: string) {
  await toolbar(page).getByRole('button', {name, exact: true}).click();
  await settled(page);
}

test('equal length persists through a parameter change and one-step undo/redo', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const width = 20;
const value = sketch([['point',1,[0,0]],['point',2,[20,0]],['point',3,[0,15]],['point',4,[20,15]],['line',5,[1,2]],['line',6,[3,4]]],{constraints:[['fixed',1],['fixed',3],['horizontal',5],['horizontal',6],['length',5,width]]});`,
  );
  const before = await source(page);
  await selectCurve(page, 5);
  await selectCurve(page, 6, true);
  await addConstraint(page, 'Equal length');
  const after = await source(page);
  assert.match(after, /'equalLength',\s*\[5,\s*6\]/);
  assert.equal(
    await page.locator('.constraint-badge[data-kind="equalLength"]').count(),
    2,
  );
  await page.keyboard.press('Control+z');
  await settled(page);
  assert.equal(await source(page), before);
  await page.keyboard.press('Control+y');
  await settled(page);
  assert.equal(await source(page), after);
  const replay = await open(t, after.replace('width = 20', 'width = 30'));
  const solved = await entities(replay);
  const position = (id: number) => {
    const p = solved.find(e => e.kind === 'point' && e.id === id)!;
    assert.equal(p.kind, 'point');
    return p.position;
  };
  for (const [a, b] of [
    [1, 2],
    [3, 4],
  ]) {
    const p = position(a),
      q = position(b);
    assert.ok(Math.abs(Math.hypot(p[0] - q[0], p[1] - q[1]) - 30) < 1e-7);
  }
});

for (const internal of [false, true])
  test(`${internal ? 'internal' : 'external'} tangent survives radius changes and has a removable marker`, async t => {
    const radius = internal ? 10 : 5;
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';
const radius = ${radius};
const value = sketch([['point',1,[0,0]],['circle',2,[1,${radius}]],['point',3,[${internal ? 5 : 10},0]],['circle',4,[3,5]]],{constraints:[['fixed',1],['radius',2,radius],['y',3,0]${internal ? ",['radius',4,5]" : ''}]});`,
    );
    await selectCurve(page, 2);
    await selectCurve(page, 4, true);
    if (!internal) await addConstraint(page, 'Equal radius');
    await addConstraint(
      page,
      internal ? 'Internal tangent' : 'External tangent',
    );
    const after = await source(page);
    assert.match(after, /'tangent',\s*\[2,\s*4\]/);
    if (internal) assert.match(after, /'internal'/);
    const marker = page
      .locator('.constraint-badge[data-kind="tangent"]')
      .first();
    await marker.click();
    const remove = toolbar(page).getByRole('button', {
      name: internal ? 'Internal tangent' : 'External tangent',
      exact: true,
    });
    assert.equal(await remove.getAttribute('aria-pressed'), 'true');
    await remove.click();
    await settled(page);
    assert.doesNotMatch(await source(page), /'tangent'/);
    await page.keyboard.press('Control+z');
    await settled(page);
    assert.equal(await source(page), after);
    const replay = await open(
      t,
      after.replace(`radius = ${radius}`, `radius = ${radius + 2}`),
    );
    const solved = await entities(replay);
    const circles = solved.filter(e => e.kind === 'circle');
    assert.equal(circles.length, 2);
    const positions = solved.filter(e => e.kind === 'point');
    const a = positions.find(p => p.id === 1)!.position;
    const b = positions.find(p => p.id === 3)!.position;
    const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const expected = internal
      ? Math.abs(circles[0].radius - circles[1].radius)
      : circles[0].radius + circles[1].radius;
    assert.ok(Math.abs(distance - expected) < 1e-7);
    if (!internal) assert.equal(circles[0].radius, circles[1].radius);
  });

for (const curve of ['line', 'circle', 'arc'] as const)
  test(`point on ${curve} is written to source and remains on the finite curve after a dimension change`, async t => {
    const shape =
      curve === 'line'
        ? "['point',2,[size,0]],['line',4,[1,2]],['point',5,[4,0]]"
        : curve === 'circle'
          ? "['circle',4,[1,size]],['point',5,[0,10]]"
          : "['point',2,[size,0]],['point',3,[0,size]],['arc',4,[1,size,2,3,'ccw']],['point',5,[6,8]]";
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';
const size = 10;
const value = sketch([['point',1,[0,0]],${shape}],{constraints:[['fixed',1]${curve === 'line' ? ",['fixed',2]" : ",['radius',4,size]"}]});`,
    );
    await point(page, 5).click();
    await selectCurve(page, 4, true);
    await addConstraint(page, 'Point on curve');
    const after = await source(page);
    assert.match(after, /'pointOn',\s*\[5,\s*4\]/);
    const replay = await open(t, after.replace('size = 10', 'size = 2'));
    const solved = await entities(replay);
    const p = solved.find(e => e.kind === 'point' && e.id === 5)!;
    assert.equal(p.kind, 'point');
    if (curve === 'line') {
      assert.ok(Math.abs(p.position[1]) < 1e-7);
      assert.ok(p.position[0] >= -1e-7 && p.position[0] <= 2 + 1e-7);
    } else {
      assert.ok(Math.abs(Math.hypot(...p.position) - 2) < 1e-7);
      if (curve === 'arc') assert.ok(p.position.every(v => v >= -1e-7));
    }
    await replay.screenshot({
      path: `/tmp/code3d-persistent-point-on-${curve}.png`,
    });
  });
