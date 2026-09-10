import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomAgentColor} from '../src/agent/colors.ts';

test('agent colors exhaust the palette before repeating and stay evenly distributed', () => {
  const colors: number[] = [];
  const counts = Array<number>(6).fill(0);
  for (let i = 0; i < 16; i++) {
    const color = randomAgentColor(colors);
    assert.ok(Number.isInteger(color) && color >= 0 && color < 6);
    if (i < 6) assert.ok(!colors.includes(color));
    colors.push(color);
    counts[color] = counts[color]! + 1;
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  }
});

test('agent colors reuse freed slots and favor underused colors in existing projects', () => {
  assert.equal(randomAgentColor([0, 1, 2, 4, 5]), 3);
  assert.equal(randomAgentColor([0, 1, 2, 3, 4, 5, 0, 1, 3, 4, 5]), 2);
});
