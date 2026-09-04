import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import * as authoring from '../bld/library/index.js';
import {authoringApi} from '../bld/tooling/index.js';

const authoringValues = [
  'arc',
  'bezier',
  'box',
  'circle',
  'cut',
  'cylinder',
  'ellipse',
  'frustum',
  'group',
  'helicalThread',
  'intersect',
  'line',
  'loft',
  'point',
  'rectangle',
  'regularPolygon',
  'regularPrism',
  'sphere',
  'spline',
  'union',
].sort();

test('exports exactly the authoring value whitelist', () => {
  assert.deepEqual(Object.keys(authoring).sort(), authoringValues);
  assert.deepEqual(Object.keys(authoringApi).sort(), authoringValues);
});

test('exposes only the root and tooling package entries', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(Object.keys(packageJson.exports).sort(), ['.', './tooling']);
});
