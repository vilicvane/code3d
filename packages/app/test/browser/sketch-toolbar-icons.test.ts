import assert from 'node:assert/strict';
import {test} from 'node:test';
import {open, text} from './sketch-test.ts';

const source = `import {sketch} from '@code3d/core';
const value = sketch([
  ['point',1,[0,0]],['point',2,[20,0]],['line',3,[1,2]],
],{constraints:[['horizontal',3],['length',3,20],['angle',3,0]]});`;

test('drawing icons retain their point roles in the toolbar and rectangle variant menu', async t => {
  const page = await open(t, source);
  const before = await text(page);
  const toolbar = page.getByRole('toolbar', {name: 'Sketch tools'});
  for (const [name, count] of [
    ['Line', 2],
    ['Rectangle', 4],
    ['Circle', 1],
    ['Arc', 3],
  ] as const) {
    const icon = toolbar
      .getByRole('button', {name, exact: true})
      .locator('svg');
    assert.equal(await icon.locator('circle[r="2"]').count(), count);
    assert.equal(await icon.getAttribute('stroke-width'), '1.75');
    assert.equal(await icon.getAttribute('aria-hidden'), 'true');
  }
  await toolbar
    .getByRole('button', {name: 'Rectangle tools', exact: true})
    .click();
  const center = page.getByRole('menuitemradio', {
    name: 'Center rectangle',
    exact: true,
  });
  assert.equal(await center.locator('circle[r="2"]').count(), 5);
  await center.click();
  assert.equal(
    await toolbar
      .getByRole('button', {name: 'Center rectangle', exact: true})
      .locator('circle[r="2"]')
      .count(),
    5,
  );
  await page.keyboard.press('Escape');
  assert.equal(await text(page), before);

  const badge = page.locator('.constraint-badge[data-kind="length"]');
  await badge.click();
  const constraints = page.getByRole('toolbar', {
    name: 'Selection constraints',
  });
  for (const [kind, name] of [
    ['horizontal', 'Horizontal'],
    ['length', 'Length'],
    ['angle', 'Orientation'],
  ] as const) {
    const tool = constraints
      .getByRole('button', {name, exact: true})
      .locator('svg');
    const marker = page.locator(`.constraint-badge[data-kind="${kind}"] svg`);
    assert.equal(await tool.innerHTML(), await marker.innerHTML());
  }
  for (const name of ['Horizontal', 'Vertical']) {
    const styles = await constraints
      .getByRole('button', {name, exact: true})
      .locator('svg path')
      .evaluateAll(paths =>
        paths.map(path => {
          const style = getComputedStyle(path);
          return [style.stroke, style.strokeWidth, style.opacity];
        }),
      );
    assert.deepEqual(styles[0], styles[1]);
  }
  const input = page.getByRole('textbox', {name: 'Length', exact: true});
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  assert.equal(await input.inputValue(), '20');
  await page.keyboard.press('Escape');
  assert.equal(await text(page), before);
});

test('toolbar dividers reach both inner edges and leave the same icon inset on either side', async t => {
  const page = await open(t, source);
  const toolbar = page.getByRole('toolbar', {name: 'Sketch tools'});
  for (const width of [1400, 1000, 680]) {
    await page.setViewportSize({width, height: 900});
    const spacing = await toolbar.evaluate(root => {
      const bar = root.getBoundingClientRect();
      const border = parseFloat(getComputedStyle(root).borderTopWidth);
      const groups = [
        ...root.querySelectorAll<HTMLElement>(':scope > .tool-group'),
      ];
      const icon = (group: HTMLElement, last = false) => {
        const buttons =
          group.querySelectorAll<HTMLButtonElement>(':scope > button');
        return buttons[last ? buttons.length - 1 : 0]
          .querySelector('svg')!
          .getBoundingClientRect();
      };
      const first = icon(groups[0]);
      const inset = first.top - bar.top - border;
      return {
        inset,
        outside: [
          first.left - bar.left - border,
          bar.bottom - first.bottom - border,
          bar.right - icon(groups.at(-1)!, true).right - border,
        ],
        separators: groups.slice(1).map((group, index) => {
          const bounds = group.getBoundingClientRect();
          const separator = parseFloat(getComputedStyle(group).borderLeftWidth);
          return {
            width: separator,
            top: bounds.top - bar.top,
            bottom: bar.bottom - bounds.bottom,
            before: bounds.left - icon(groups[index], true).right,
            after: icon(group).left - bounds.left - separator,
          };
        }),
        border,
      };
    });
    assert.ok(spacing.inset > 0);
    for (const inset of spacing.outside) assert.equal(inset, spacing.inset);
    for (const separator of spacing.separators) {
      assert.equal(separator.width, 1);
      assert.equal(separator.top, spacing.border);
      assert.equal(separator.bottom, spacing.border);
      assert.equal(separator.before, spacing.inset);
      assert.equal(separator.after, spacing.inset);
    }
  }
});
