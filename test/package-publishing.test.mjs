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

test('a release cannot omit direct or transitive published consumers', () => {
  for (const field of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const packages = [
      {name: 'core', version: '1.1.0'},
      {
        name: 'tools',
        version: '1.0.0',
        [field]: {core: '^1.1.0'},
        peerDependenciesMeta: {core: {optional: true}},
      },
    ];
    assert.throws(
      () => releasePackages(packages, 'v1.1.0'),
      /tools must join release/,
    );
    packages[1].version = '1.1.0';
    packages.push({
      name: 'consumer',
      version: '1.0.0',
      dependencies: {tools: '~1.1.0'},
    });
    assert.throws(
      () => releasePackages(packages, 'v1.1.0'),
      /consumer must join release/,
    );
    packages[2].version = '1.1.0';
    assert.deepEqual(
      releasePackages(packages.reverse(), 'v1.1.0').map(pkg => pkg.name),
      ['core', 'tools', 'consumer'],
    );
  }
});

test('compatible old lower bounds and loose internal references fail before upload', () => {
  for (const field of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
  ])
    for (const range of [
      '^0.0.1-alpha.2',
      '~0.0.1-alpha.2',
      '*',
      'latest',
      'workspace:*',
      '>=0.0.1-alpha.2',
    ])
      assert.throws(
        () =>
          releasePackages(
            [
              {name: 'core', version: '0.0.1-alpha.3'},
              {
                name: 'screws',
                version: '0.0.1-alpha.3',
                [field]: {core: range},
              },
            ],
            'v0.0.1-alpha.3',
          ),
        /minimum version/,
      );
});

test('private workspaces and development edges do not trigger public releases', () => {
  assert.deepEqual(
    releasePackages(
      [
        {name: 'core', version: '1.1.0'},
        {
          name: 'app',
          version: '1.1.0',
          private: true,
          dependencies: {core: '*'},
        },
        {name: 'build-tool', version: '1.0.0', devDependencies: {core: '*'}},
        {name: 'unrelated', version: '1.0.0', dependencies: {external: '*'}},
      ],
      'v1.1.0',
    ).map(pkg => pkg.name),
    ['core'],
  );
});

test('duplicate peer and optional declarations are both validated', () => {
  assert.throws(
    () =>
      releasePackages(
        [
          {name: 'core', version: '1.1.0'},
          {
            name: 'consumer',
            version: '1.1.0',
            dependencies: {core: '1.1.0'},
            peerDependencies: {core: '^1.0.0'},
            peerDependenciesMeta: {core: {optional: true}},
          },
        ],
        'v1.1.0',
      ),
    /peerDependencies.core.*minimum version/,
  );
});
