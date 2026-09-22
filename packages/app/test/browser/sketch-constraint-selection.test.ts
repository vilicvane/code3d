import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SketchSnapshot} from '@code3d/core/tooling';
import type {Page} from './browser-connection.ts';
import {open, point, text, waitForSource} from './sketch-test.ts';

const cases = [
  {
    kind: 'x',
    name: 'X coordinate',
    entries: "['point',1,[5,8]]",
    target: 1,
    value: 5,
    next: 7,
    selected: 'circle',
  },
  {
    kind: 'y',
    name: 'Y coordinate',
    entries: "['point',1,[5,8]]",
    target: 1,
    value: 8,
    next: 12,
    selected: 'circle',
  },
  {
    kind: 'length',
    name: 'Length',
    entries: "['point',1,[0,0]],['point',2,[20,0]],['line',3,[1,2]]",
    target: 3,
    value: 20,
    next: 30,
    selected: 'line',
  },
  {
    kind: 'angle',
    name: 'Orientation',
    entries: "['point',1,[0,0]],['point',2,[20,0]],['line',3,[1,2]]",
    target: 3,
    value: 0,
    next: 45,
    selected: 'line',
  },
  {
    kind: 'radius',
    name: 'Radius',
    entries: "['point',1,[0,0]],['circle',2,[1,5]]",
    target: 2,
    value: 5,
    next: 8,
    selected: 'circle',
  },
  {
    kind: 'sweep',
    name: 'Sweep',
    entries:
      "['point',1,[0,0]],['point',2,[10,0]],['point',3,[0,10]],['arc',4,[1,10,2,3,'ccw']]",
    target: 4,
    value: 90,
    next: 120,
    selected: 'path',
  },
] as const;

async function assertGeometry(
  page: Page,
  c: (typeof cases)[number],
  expected: number,
): Promise<void> {
  await page.waitForFunction(() => {
    const {codeEditor, previewState} = window.sketchTestRuntime;
    return previewState.sourceVersion === codeEditor.sourceVersion();
  });
  assert.equal(
    await page.locator('.viewport-diagnostic[data-severity="warning"]').count(),
    0,
  );
  const geometry = await page.evaluate(({kind, target}) => {
    const {previewState, sketchEditor} = window.sketchTestRuntime;
    const snapshot = [...previewState.module!.sketches.values()].at(-1)!;
    const canvas = document.querySelector<SVGSVGElement>('.sketch-canvas')!;
    const {center, scale} = sketchEditor.navigation.pose;
    const rendered: SketchSnapshot = {
      ...snapshot,
      entities: snapshot.entities.map(entity => {
        if (entity.kind !== 'point' && entity.kind !== 'circle') return entity;
        const shape = canvas.querySelector<SVGCircleElement>(
          `circle.local[data-id="${entity.id}"]`,
        )!;
        return entity.kind === 'circle'
          ? {...entity, radius: Number(shape.getAttribute('r')) / scale}
          : {
              ...entity,
              position: [
                center[0] +
                  (Number(shape.getAttribute('cx')) - canvas.clientWidth / 2) /
                    scale,
                center[1] -
                  (Number(shape.getAttribute('cy')) - canvas.clientHeight / 2) /
                    scale,
              ] as const,
            };
      }),
    };
    const measure = (sketch: SketchSnapshot): number => {
      const entity = sketch.entities.find(entity => entity.id === target)!;
      const position = (id: number) =>
        sketch.entities
          .filter(entity => entity.kind === 'point')
          .find(entity => entity.id === id)!.position;
      if (entity.kind === 'point') return entity.position[kind === 'x' ? 0 : 1];
      if (entity.kind === 'circle') return entity.radius;
      const [a, b] = entity.points.map(point => position(point.id));
      if (entity.kind === 'line')
        return kind === 'length'
          ? Math.hypot(b[0] - a[0], b[1] - a[1])
          : (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      const origin = position(entity.center.id);
      const angles = [a, b].map(point =>
        Math.atan2(point[1] - origin[1], point[0] - origin[0]),
      );
      const direction = entity.direction === 'ccw' ? 1 : -1;
      const sweep = (direction * (angles[1] - angles[0]) * 180) / Math.PI;
      return ((sweep % 360) + 360) % 360;
    };
    return {compiled: measure(snapshot), rendered: measure(rendered)};
  }, c);
  for (const [source, actual] of Object.entries(geometry))
    assert.ok(
      Math.abs(actual - expected) < 1e-5,
      `${c.name} ${source} geometry: expected ${expected}, received ${actual}`,
    );
}

for (const c of cases)
  test(`${c.name} marker selects its geometry and solves edits, undo and redo`, async t => {
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';
const value = sketch([${c.entries}], {constraints: [/* keep */ ['${c.kind}',${c.target},${c.value}]]});`,
    );
    const before = await text(page);
    await assertGeometry(page, c, c.value);
    await page.getByRole('button', {name: 'Trim', exact: true}).click();
    const badge = page.locator(`.constraint-badge[data-kind="${c.kind}"]`);
    assert.equal(await badge.getAttribute('role'), 'button');
    await badge.click();
    const input = page.getByRole('textbox', {name: c.name, exact: true});
    assert.equal(
      await input.evaluate(el => document.activeElement === el),
      true,
    );
    assert.equal(await input.inputValue(), String(c.value));
    assert.deepEqual(
      await input.evaluate((el: HTMLInputElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
      [0, String(c.value).length],
    );
    assert.equal(
      await page
        .locator(`.sketch-canvas ${c.selected}.selected[data-id="${c.target}"]`)
        .count(),
      1,
    );
    assert.equal(await text(page), before);
    assert.equal(
      await page
        .getByRole('button', {name: 'Select', exact: true})
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.keyboard.insertText(String(c.next));
    await page.keyboard.press('Enter');
    const expected = new RegExp(`'${c.kind}',\\s*${c.target},\\s*${c.next}\\]`);
    await waitForSource(page, expected);
    await page.getByText('Ready', {exact: true}).waitFor();
    await assertGeometry(page, c, c.next);
    assert.equal(await input.count(), 0);
    assert.match(await text(page), /\/\* keep \*\//);
    assert.equal(
      await page.locator(`.constraint-badge[data-kind="${c.kind}"]`).count(),
      1,
    );
    await badge.click();
    assert.equal(await input.inputValue(), String(c.next));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await waitForSource(
      page,
      new RegExp(`'${c.kind}',\\s*${c.target},\\s*${c.value}\\]`),
    );
    assert.equal(await text(page), before);
    await assertGeometry(page, c, c.value);
    await page.keyboard.press('Control+y');
    await waitForSource(page, expected);
    await assertGeometry(page, c, c.next);
  });

test('a midpoint marker selects all three points and its active relation can be removed', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['point',2,[-10,-5]],['point',3,[10,5]]], {constraints:[['midpoint',[1,2,3]]]});`,
  );
  const before = await text(page);
  const badge = page.locator('.constraint-badge[data-kind="midpoint"]');
  await badge.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.sketch-canvas circle.selected').count(), 3);
  assert.equal(
    await page.getByRole('form', {name: 'Constraint value'}).count(),
    0,
  );
  assert.equal(await text(page), before);
  const action = page
    .getByRole('toolbar', {name: 'Selection constraints'})
    .getByRole('button', {name: 'Midpoint', exact: true});
  assert.equal(await action.getAttribute('aria-pressed'), 'true');
  await action.click();
  await badge.waitFor({state: 'detached'});
  assert.doesNotMatch(await text(page), /'midpoint'/);
  await page.keyboard.press('Control+z');
  await badge.waitFor();
  assert.equal(await text(page), before);
});

test('point, angle and perpendicular badges at one vertex remain individually clickable through zoom', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([
  ['point', 1, [0, 0]], ['point', 2, [30, 0]],
  ['point', 3, [0, 30]], ['point', 4, [20, 20]],
  ['line', 5, [1, 2]], ['line', 6, [1, 3]], ['line', 7, [1, 4]],
], {constraints: [
  ['x', 1, 0], ['y', 1, 0],
  ['perpendicular', [5, 6]], ['angle', [5, 7], 45],
]});`,
  );
  const before = await text(page);
  const badges = page.locator('.constraint-badge');
  await badges.nth(3).waitFor();
  const checkRow = async () => {
    const bounds = await badges.evaluateAll(nodes =>
      nodes.map(node => {
        const rect = node.querySelector('rect')!.getBoundingClientRect();
        return {x: rect.x, y: rect.y, width: rect.width};
      }),
    );
    assert.equal(bounds.length, 4);
    for (let i = 1; i < bounds.length; i++) {
      assert.ok(Math.abs(bounds[i].y - bounds[0].y) < 0.01);
      // SVG getBoundingClientRect excludes the 1px border shared by both edges.
      assert.ok(
        Math.abs(bounds[i].x - bounds[i - 1].x - bounds[i - 1].width - 5) <
          0.01,
      );
    }
    for (const [kind, name] of [
      ['x', 'X coordinate'],
      ['y', 'Y coordinate'],
      ['perpendicular', undefined],
      ['angle', 'Angle between lines'],
    ] as const) {
      const badge = page.locator(`.constraint-badge[data-kind="${kind}"]`);
      await badge.hover();
      assert.match(
        (await badge.getAttribute('class')) ?? '',
        /constraint-active/,
      );
      await badge.click();
      if (name) {
        const input = page.getByRole('textbox', {name, exact: true});
        assert.equal(
          await input.evaluate(el => document.activeElement === el),
          true,
        );
        await page.keyboard.press('Escape');
      } else {
        assert.equal(
          await page.locator('.sketch-canvas line.selected').count(),
          2,
        );
      }
    }
  };
  await checkRow();
  const vertex = await point(page, 1).boundingBox();
  assert.ok(vertex);
  await page.mouse.move(
    vertex.x + vertex.width / 2,
    vertex.y + vertex.height / 2,
  );
  const beforeLine = await point(page, 2).getAttribute('cx');
  await page.mouse.wheel(0, -180);
  await page.waitForFunction(
    before =>
      document
        .querySelector('.sketch-canvas circle.local[data-id="2"]')
        ?.getAttribute('cx') !== before,
    beforeLine,
  );
  await checkRow();
  assert.equal(await text(page), before);
});

test('radius and sweep badges sharing a curve position form a clickable row', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([
  ['point', 1, [0, 0]], ['point', 2, [10, 0]], ['point', 3, [0, 10]],
  ['arc', 4, [1, 10, 2, 3, 'ccw']],
], {constraints: [['radius', 4, 10], ['sweep', 4, 90]]});`,
  );
  const before = await text(page);
  const radius = page.locator('.constraint-badge[data-kind="radius"]');
  const sweep = page.locator('.constraint-badge[data-kind="sweep"]');
  await sweep.waitFor();
  const a = await radius.locator('rect').boundingBox();
  const b = await sweep.locator('rect').boundingBox();
  assert.ok(a && b);
  assert.ok(Math.abs(a.y - b.y) < 0.01);
  // Playwright's SVG bounds include the stroke: measure the visible 4px gap.
  assert.ok(Math.abs(b.x - a.x - a.width - 4) < 0.01);
  for (const [badge, name] of [
    [radius, 'Radius'],
    [sweep, 'Sweep'],
  ] as const) {
    await badge.click();
    const input = page.getByRole('textbox', {name, exact: true});
    assert.equal(
      await input.evaluate(el => document.activeElement === el),
      true,
    );
    await page.keyboard.press('Escape');
  }
  assert.equal(await text(page), before);
});

test('keyboard activation, invalid input, cancellation and leaving the sketch never write unfinished values', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value = sketch([['point',1,[0,0]],['circle',2,[1,5]]], {constraints:[['radius',2,5]]});`,
  );
  const before = await text(page);
  const badge = page.locator('.constraint-badge[data-kind="radius"]');
  await badge.focus();
  await page.keyboard.press('Space');
  const input = page.getByRole('textbox', {name: 'Radius', exact: true});
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await input.fill('-1');
  await page.keyboard.press('Enter');
  assert.match(
    await page.locator('.sketch-constraint-tools [role="alert"]').innerText(),
    /greater than zero/,
  );
  assert.equal(await text(page), before);
  await page.keyboard.press('Escape');
  assert.equal(await input.count(), 0);
  assert.equal(await text(page), before);
  await badge.click();
  await input.fill('9');
  await point(page, 1).click();
  assert.equal(await input.count(), 0);
  assert.equal(await text(page), before);
  await badge.click();
  await input.fill('9');
  await page.locator('.monaco-editor .view-lines').click();
  assert.equal(await input.count(), 0);
  assert.equal(await text(page), before);
});

test('local expression values open their exact source while upstream dimensions stay read-only', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const width=20;
const base=sketch([['point',1,[0,0]],['circle',2,[1,5]]],{constraints:[['radius',2,5]]});
const value=base.derive([['point',1,[width,0]]],{constraints:[['x',1,width]]});`,
  );
  const before = await text(page);
  await page.locator('.constraint-badge[data-kind="x"]').click();
  assert.equal(
    await page.locator('.sketch-canvas circle.local.selected').count(),
    1,
  );
  assert.equal(
    await page.getByRole('form', {name: 'Constraint value'}).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole('textbox', {name: 'X coordinate', exact: true})
      .inputValue(),
    'width',
  );
  await page.keyboard.press('Escape');
  await page.locator('.constraint-badge[data-kind="radius"]').click();
  assert.equal(
    await page.locator('.sketch-canvas circle.upstream.selected').count(),
    1,
  );
  assert.equal(
    await page.getByRole('form', {name: 'Constraint value'}).count(),
    0,
  );
  assert.equal(await text(page), before);
});

test('clicking one of two dimensions edits only its own tuple and retains the other value', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const value=sketch([['point',1,[-10,0]],['circle',2,[1,5]],['point',3,[10,0]],['circle',4,[3,5]]],{constraints:[['radius',2,5],/* second */['radius',4,5]]});`,
  );
  const badges = page.locator('.constraint-badge[data-kind="radius"]');
  const input = page.getByRole('textbox', {name: 'Radius', exact: true});
  await badges.nth(0).click();
  await input.fill('11');
  await badges.nth(1).click();
  assert.equal(await input.inputValue(), '5');
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await input.fill('7');
  await page.keyboard.press('Enter');
  await waitForSource(page, /'radius',\s*4,\s*7/);
  assert.match(await text(page), /'radius',\s*2,\s*5/);
  assert.match(await text(page), /\/\* second \*\//);
});

test('a local coordinate relation on an upstream-only selection can be removed but has no writable input', async t => {
  const page = await open(
    t,
    `import {sketch} from '@code3d/core';
const base = sketch([['point',1,[0,0]]]);
const value = base.derive([], {constraints:[['x',base.point(1),0]]});`,
  );
  const before = await text(page);
  await page.locator('.constraint-badge[data-kind="x"]').click();
  assert.equal(
    await point(page, 1, 'upstream')
      .getAttribute('class')
      .then(c => c?.includes('selected')),
    true,
  );
  assert.equal(
    await page
      .getByRole('form', {name: 'Constraint value', includeHidden: true})
      .count(),
    0,
  );
  assert.equal(await text(page), before);
  await page.getByRole('button', {name: 'X coordinate', exact: true}).click();
  await waitForSource(page, /constraints:\s*\[\]/);
  assert.match(await text(page), /\['point',\s*1,\s*\[0,\s*0\]\]/);
});
