import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import * as authoring from '@code3d/core';
import * as replicadInterop from '@code3d/core/replicad';
import {authoringApi} from '@code3d/core/tooling';
import * as browserAuthoring from '../bld/library/index.js';
import * as browserReplicadInterop from '../bld/library/replicad.js';

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

test('Node initialization preserves the browser authoring and interop exports', () => {
  assert.deepEqual(authoring, browserAuthoring);
  assert.deepEqual(replicadInterop, browserReplicadInterop);
});

test('rejects package imports that bypass the public entries', async () => {
  for (const specifier of [
    '@code3d/core/bld/library/index.js',
    '@code3d/core/bld/library/runtime.js',
    '@code3d/core/bld/tooling/index.js',
  ]) {
    await assert.rejects(import(specifier), {
      code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    });
  }
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
