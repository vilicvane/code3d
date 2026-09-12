import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  rm,
  stat,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  artifactsDirectory,
  runNpm,
  packPackages,
  publicPackages,
  root,
  run,
} from './package-artifacts.mjs';
import {
  releasePackages,
  validatePackageDependencies,
} from './publish-packages.mjs';

const workspaceManifests = new Map(
  (await publicPackages()).map(pkg => [pkg.name, pkg]),
);
const artifacts = await packPackages();
const consumer = await mkdtemp(path.join(tmpdir(), 'code3d-packages-'));
try {
  const typeImports = [];
  const installedManifests = [];
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({private: true, type: 'module'}),
  );
  process.stdout.write(
    runNpm(
      [
        'install',
        '--ignore-scripts',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        ...artifacts.map(pkg => path.join(artifactsDirectory, pkg.filename)),
      ],
      consumer,
    ),
  );
  for (const pkg of artifacts) {
    const directory = path.join(consumer, 'node_modules', pkg.name);
    const manifest = JSON.parse(
      await readFile(path.join(directory, 'package.json'), 'utf8'),
    );
    assert.equal(manifest.version, pkg.version);
    installedManifests.push(manifest);
    for (const field of [
      'dependencies',
      'peerDependencies',
      'optionalDependencies',
      'peerDependenciesMeta',
    ])
      assert.deepEqual(
        manifest[field],
        workspaceManifests.get(pkg.name)[field],
        `${pkg.name} tarball ${field} matches its release manifest`,
      );
    for (const [entry, target] of Object.entries(manifest.exports ?? {})) {
      if (typeof target !== 'object' || !target.types) continue;
      const specifier = pkg.name + (entry === '.' ? '' : entry.slice(1));
      typeImports.push(`import type {} from ${JSON.stringify(specifier)};`);
    }
    assert.equal(
      manifest.repository.url,
      'git+https://github.com/vilicvane/code3d.git',
    );
    for (const file of pkg.files) {
      if (!file.path.endsWith('.d.ts.map')) continue;
      const filename = path.join(directory, file.path);
      const map = JSON.parse(await readFile(filename, 'utf8'));
      for (const source of map.sources)
        assert.ok(
          (
            await stat(
              path.resolve(
                path.dirname(filename),
                map.sourceRoot ?? '',
                source,
              ),
            )
          ).isFile(),
          `${pkg.name} declaration navigation source exists`,
        );
    }
  }
  validatePackageDependencies(installedManifests);
  for (const name of ['flo-boolean', '@ctrl/tinycolor', 'commander'])
    await assert.rejects(stat(path.join(consumer, 'node_modules', name)), {
      code: 'ENOENT',
    });
  const core = artifacts.find(pkg => pkg.name === '@code3d/core');
  assert.ok(core.files.filter(file => file.path.endsWith('.js')).length <= 12);
  const notices = await readFile(
    path.join(
      consumer,
      'node_modules/@code3d/core/bld/THIRD_PARTY_NOTICES.txt',
    ),
    'utf8',
  );
  for (const name of [
    'flo-boolean',
    'squares-rng',
    'big-float-ts',
    '@ctrl/tinycolor',
  ])
    assert.ok(notices.includes(name));
  assert.ok(notices.includes('Copyright 2013 Bartek Szopka'));
  await copyFile(
    path.join(root, 'packages/core/test/fonts/DejaVuSans.ttf'),
    path.join(consumer, 'font.ttf'),
  );
  await copyFile(
    path.join(root, 'test/package-consumer.mjs'),
    path.join(consumer, 'test.mjs'),
  );
  process.stdout.write(run(process.execPath, ['test.mjs'], consumer));
  const help = run(
    process.execPath,
    ['node_modules/@code3d/cli/bld/main.js', '--help'],
    consumer,
  );
  assert.match(help, /Usage: c3d/);
  // Compile the real authoring type contract against installed declarations.
  await copyFile(
    path.join(root, 'packages/core/test/public-api.ts'),
    path.join(consumer, 'public-api.ts'),
  );
  await copyFile(
    path.join(root, 'packages/screws/test/public-api.ts'),
    path.join(consumer, 'screws-public-api.ts'),
  );
  await writeFile(
    path.join(consumer, 'public-entries.ts'),
    typeImports.join('\n'),
  );
  await writeFile(
    path.join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ESNext', 'DOM'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        types: [],
      },
      files: ['public-api.ts', 'screws-public-api.ts', 'public-entries.ts'],
    }),
  );
  process.stdout.write(
    run(
      process.execPath,
      [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', consumer],
      consumer,
    ),
  );
  if (process.env.CODE3D_RELEASE_TAG) {
    const selected = releasePackages(
      installedManifests,
      process.env.CODE3D_RELEASE_TAG,
    ).map(pkg => artifacts.find(artifact => artifact.name === pkg.name));
    const releaseConsumer = await mkdtemp(
      path.join(tmpdir(), 'code3d-release-'),
    );
    try {
      await writeFile(
        path.join(releaseConsumer, 'package.json'),
        JSON.stringify({private: true, type: 'module'}),
      );
      process.stdout.write(
        runNpm(
          [
            'install',
            '--ignore-scripts',
            '--omit=dev',
            '--no-audit',
            '--no-fund',
            ...selected.map(pkg => path.join(artifactsDirectory, pkg.filename)),
          ],
          releaseConsumer,
        ),
      );
      await copyFile(
        path.join(root, 'test/release-consumer.mjs'),
        path.join(releaseConsumer, 'test.mjs'),
      );
      await copyFile(
        path.join(consumer, 'font.ttf'),
        path.join(releaseConsumer, 'font.ttf'),
      );
      process.stdout.write(
        run(
          process.execPath,
          ['test.mjs', JSON.stringify(selected.map(pkg => pkg.name))],
          releaseConsumer,
        ),
      );
      console.log(
        'Release batch also passed with unselected dependencies from npm.',
      );
    } finally {
      await rm(releaseConsumer, {recursive: true, force: true});
    }
  }
  await writeFile(
    path.join(artifactsDirectory, 'manifest.json'),
    JSON.stringify(artifacts, null, 2) + '\n',
  );
  console.log(
    `All ${artifacts.length} installed tarballs, public entries, declaration maps, cache identity, text, native resources and CLI passed.`,
  );
} finally {
  await rm(consumer, {recursive: true, force: true});
}
