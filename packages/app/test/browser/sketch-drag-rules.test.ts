import assert from 'node:assert/strict';
import {test} from 'node:test';
import {open, point, text} from './sketch-test.ts';
import {trimmedArcSketchArguments} from '../sketch-fixtures.ts';

const arc = `['point', 1, [0, 0]], ['point', 2, [10, 0]],
  ['point', 3, [0, 10]], ['arc', 4, [1, 10, 2, 3, 'ccw']]`;
const cases: {
  name: string;
  id: number;
  args: string;
  delta?: readonly [number, number];
  follow: number[][];
}[] = [
  ...[-60, 60].map(dy => ({
    name: `connected arc and concentric circle center ${dy < 0 ? 'up' : 'down'}`,
    id: 10,
    args: trimmedArcSketchArguments(10),
    delta: [0, dy] as const,
    follow: [
      [10, 1, 1],
      [13, 1, 1],
      [15, 1, 1],
      [4, 0, 1],
      [5, 0, 1],
      [2, 0, 0],
      [3, 0, 0],
    ],
  })),
  {
    name: 'arc center',
    id: 1,
    args: `[${arc}]`,
    follow: [
      [1, 1, 1],
      [2, 1, 1],
      [3, 1, 1],
    ],
  },
  {
    name: 'arc center shared with a line endpoint',
    id: 1,
    args: `[${arc}, ['point', 5, [-20, 0]], ['line', 6, [1, 5]]]`,
    follow: [
      [1, 1, 1],
      [2, 1, 1],
      [3, 1, 1],
      [5, 0, 0],
    ],
  },
  {
    name: 'centered rectangle',
    id: 1,
    args: `[
      ['point', 1, [0, 0]], ['point', 2, [-10, -5]],
      ['point', 3, [10, -5]], ['point', 4, [10, 5]], ['point', 5, [-10, 5]],
      ['line', 6, [2, 3]], ['line', 7, [3, 4]], ['line', 8, [4, 5]], ['line', 9, [5, 2]],
    ], {constraints: [['horizontal', 6], ['vertical', 7], ['horizontal', 8],
      ['vertical', 9], ['midpoint', [1, 2, 4]]]}`,
    follow: [
      [1, 1, 1],
      [2, 1, 1],
      [3, 1, 1],
      [4, 1, 1],
      [5, 1, 1],
    ],
  },
  {
    name: 'point 13 in both axes',
    id: 13,
    args: `[
      ['point', 12, [-7.5, -7]], ['point', 13, [8, -7]], ['point', 14, [8, 0]],
      ['point', 15, [-7.5, 0]], ['point', 21, [-5, 0]],
      ['line', 16, [12, 13]], ['line', 17, [13, 14]], ['line', 19, [15, 12]], ['line', 22, [21, 15]],
    ], {constraints: [['horizontal', 16], ['vertical', 17], ['vertical', 19], ['horizontal', 22]]}`,
    follow: [
      [13, 1, 1],
      [12, 0, 1],
      [14, 1, 0],
      [21, 0, 0],
    ],
  },
];

for (const scenario of cases)
  test(`${scenario.name}: preview, cancel, source replay and one-step undo`, async t => {
    const page = await open(
      t,
      `import {sketch} from '@code3d/core';
const value = sketch(${scenario.args});`,
    );
    await point(page, scenario.id).waitFor();
    await page.getByRole('button', {name: 'Snap', exact: true}).click();
    const before = await text(page);
    const original = new Map<number, {x: number; y: number}>();
    for (const [id] of scenario.follow) {
      const bounds = (await point(page, id).boundingBox())!;
      original.set(id, {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      });
    }
    const start = original.get(scenario.id)!;
    const dx = scenario.delta?.[0] ?? 38,
      dy = scenario.delta?.[1] ?? -24;
    const verify = async (moved: boolean) => {
      for (const [id, x, y] of scenario.follow) {
        const origin = original.get(id)!;
        await page.waitForFunction(
          ({id, x, y}) => {
            const bounds = document
              .querySelector(`.sketch-canvas circle.local[data-id="${id}"]`)
              ?.getBoundingClientRect();
            return (
              bounds &&
              Math.hypot(
                bounds.x + bounds.width / 2 - x,
                bounds.y + bounds.height / 2 - y,
              ) < 0.2
            );
          },
          {
            id,
            x: origin.x + (moved ? dx * x : 0),
            y: origin.y + (moved ? dy * y : 0),
          },
        );
      }
    };
    for (const cancel of [true, false]) {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + dx, start.y + dy, {steps: 4});
      await verify(true);
      assert.equal(await text(page), before, 'preview must not write source');
      assert.deepEqual(
        await page
          .locator('.sketch-canvas .entity')
          .evaluateAll(elements => [
            ...new Set(elements.map(e => getComputedStyle(e).strokeWidth)),
          ]),
        ['2px'],
      );
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
      if (cancel) {
        await verify(false);
        assert.equal(await text(page), before);
      }
    }
    await page.waitForFunction(
      before =>
        document
          .querySelector<HTMLElement>('.monaco-editor .view-lines')!
          .innerText.replaceAll('\u00a0', ' ') !== before,
      before,
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    await verify(true);
    assert.doesNotMatch(await text(page), /'fixed'/);
    await page.keyboard.press('Control+z');
    await verify(false);
    assert.equal(await text(page), before);
  });
