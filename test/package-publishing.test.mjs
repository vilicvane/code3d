import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  integrity,
  run,
  verifiedArtifacts,
} from '../scripts/package-artifacts.mjs';
import {releasePackages} from '../scripts/publish-packages.mjs';
import {ArtifactRegistry} from '../scripts/artifact-registry.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

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

test('example consumers and publication require the exact verified archive identity', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'code3d-artifact-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const manifest = {
    name: '@code3d/example',
    version: '1.2.3',
    dependencies: {external: '1.0.0'},
  };
  await mkdir(path.join(directory, 'package'));
  await writeFile(
    path.join(directory, 'package/package.json'),
    JSON.stringify(manifest),
  );
  run('tar', ['-czf', 'example.tgz', 'package'], directory);
  const filename = path.join(directory, 'example.tgz');
  const artifact = {
    ...manifest,
    filename: 'example.tgz',
    integrity: integrity(await readFile(filename)),
  };
  await writeFile(
    path.join(directory, 'manifest.json'),
    JSON.stringify([artifact]),
  );
  const [verified] = await verifiedArtifacts([manifest], directory);
  assert.deepEqual(verified.manifest, manifest);
  assert.equal(
    verified.tarball,
    'https://registry.npmjs.org/@code3d/example/-/example-1.2.3.tgz',
  );
  assert.equal(verified.filename, filename);
  await assert.rejects(
    verifiedArtifacts(
      [{...manifest, dependencies: {external: '2.0.0'}}],
      directory,
    ),
    /differs from release plan/,
  );
  await assert.rejects(
    verifiedArtifacts([{...manifest, version: '1.2.4'}], directory),
    /Missing verified artifact/,
  );
  await writeFile(
    path.join(directory, 'manifest.json'),
    JSON.stringify([{...artifact, version: '1.2.4'}]),
  );
  await assert.rejects(
    verifiedArtifacts([{...manifest, version: '1.2.4'}], directory),
    /identity mismatch/,
  );
  await writeFile(
    path.join(directory, 'manifest.json'),
    JSON.stringify([artifact]),
  );
  await writeFile(filename, 'modified');
  await assert.rejects(
    verifiedArtifacts([manifest], directory),
    /artifact was modified/,
  );
});

test('current artifacts install through npm with transitive dependencies before publication', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'code3d-registry-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const artifacts = [];
  for (const manifest of [
    {name: '@code3d/unpublished-dependency', version: '0.0.0-ci.1'},
    {
      name: '@code3d/unpublished-consumer',
      version: '0.0.0-ci.1',
      dependencies: {'@code3d/unpublished-dependency': '^0.0.0-ci.1'},
    },
  ]) {
    const source = path.join(directory, manifest.name.split('/')[1]);
    await mkdir(path.join(source, 'package'), {recursive: true});
    await writeFile(
      path.join(source, 'package/package.json'),
      JSON.stringify(manifest),
    );
    const filename = path.join(source, 'package.tgz');
    run('tar', ['-czf', filename, 'package'], source);
    artifacts.push({
      ...manifest,
      manifest,
      filename,
      integrity: integrity(await readFile(filename)),
      tarball: `https://registry.npmjs.org/${manifest.name}/-/package.tgz`,
    });
  }
  const registry = new ArtifactRegistry(artifacts);
  const server = await registry.listen();
  t.after(() => server.close());
  const missing = await registry.response(
    'https://registry.npmjs.org/@code3d/unpublished-consumer/9.9.9',
  );
  assert.equal(
    missing.status,
    404,
    'unavailable Code3D versions never fall back to public npm',
  );
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({
      private: true,
      dependencies: {'@code3d/unpublished-consumer': 'latest'},
    }),
  );
  await promisify(execFile)(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--@code3d:registry=' + server.url,
    ],
    {cwd: directory, timeout: 30_000, killSignal: 'SIGKILL'},
  );
  const installed = JSON.parse(
    await readFile(path.join(directory, 'package-lock.json'), 'utf8'),
  );
  for (const artifact of artifacts) {
    const pkg = installed.packages['node_modules/' + artifact.name];
    assert.equal(pkg.version, artifact.version);
    assert.equal(pkg.integrity, artifact.integrity);
    assert.ok(pkg.resolved.startsWith(server.url + '/'));
  }
});
