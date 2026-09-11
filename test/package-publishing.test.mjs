import assert from 'node:assert/strict';
import {test} from 'node:test';
import {releasePackages} from '../scripts/publish-packages.mjs';

test('a shared release tag selects only matching versions in dependency order', () => {
  const packages = [
    {name: 'cli', version: '0.1.0', dependencies: {agent: '0.1.0'}},
    {name: 'screws', version: '0.1.0', peerDependencies: {core: '^0.1.0'}},
    {name: 'native', version: '0.0.1'},
    {name: 'agent', version: '0.1.0'},
    {name: 'core', version: '0.1.0', dependencies: {native: '0.0.1'}},
  ];
  assert.deepEqual(
    releasePackages(packages, 'v0.1.0').map(pkg => pkg.name),
    ['agent', 'cli', 'core', 'screws'],
  );
  assert.throws(() => releasePackages(packages, 'v0.2.0'), /No public package/);
  assert.throws(() => releasePackages(packages, 'main'), /Release tag/);
});

test('prerelease tags match exactly and release cycles fail before publishing', () => {
  assert.equal(
    releasePackages(
      [{name: 'core', version: '0.1.0-alpha.2'}],
      'v0.1.0-alpha.2',
    ).length,
    1,
  );
  assert.throws(
    () =>
      releasePackages(
        [
          {name: 'a', version: '1.0.0', dependencies: {b: '1.0.0'}},
          {name: 'b', version: '1.0.0', dependencies: {a: '1.0.0'}},
        ],
        'v1.0.0',
      ),
    /cycle/,
  );
});
