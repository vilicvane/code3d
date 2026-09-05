import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import * as authoring from '../bld/library/index.js';
import * as replicadInterop from '../bld/library/replicad.js';
import {authoringApi} from '../bld/tooling/index.js';

const authoringValues = [
  'arc',
  'bezier',
  'box',
  'circle',
  'coil',
  'cut',
  'cylinder',
  'ellipse',
  'frustum',
  'group',
  'intersect',
  'line',
  'loft',
  'point',
  'rectangle',
  'regularPolygon',
  'regularPrism',
  'sketch',
  'sphere',
  'spline',
  'tube',
  'union',
].sort();

test('exports exactly the authoring value whitelist', () => {
  assert.deepEqual(Object.keys(authoring).sort(), authoringValues);
  assert.deepEqual(Object.keys(authoringApi).sort(), authoringValues);
});

test('keeps Replicad behind its explicit author interop entry', () => {
  assert.deepEqual(Object.keys(replicadInterop).sort(), [
    'definePrimitive',
    'replicad',
  ]);
  assert.equal('getOC' in replicadInterop.replicad, false);
  assert.equal('setOC' in replicadInterop.replicad, false);
  assert.equal(Object.isFrozen(replicadInterop.replicad), true);
});

test('exposes only the root, Replicad, and tooling package entries', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(Object.keys(packageJson.exports).sort(), [
    '.',
    './replicad',
    './tooling',
  ]);
});

test('keeps the concrete model class out of the root declaration', async () => {
  const declaration = await readFile(
    new URL('../bld/library/index.d.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(declaration, /\bModelObject\b/);
  assert.match(declaration, /\bGroupModel\b/);
});
