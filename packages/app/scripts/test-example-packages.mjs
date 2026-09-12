import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {releaseArtifacts} from '../../../scripts/publish-packages.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const examples = join(app, 'examples');
const artifacts = await releaseArtifacts();
const manifests = (await readdir(examples, {recursive: true})).filter(
  path => path.endsWith('/package.json') && !path.includes('node_modules/'),
);
async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      timeout: 180_000,
      killSignal: 'SIGKILL',
    });
    child.once('error', reject);
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
for (const manifestPath of manifests) {
  const source = join(examples, manifestPath.slice(0, -'/package.json'.length));
  const directory = await mkdtemp(join(tmpdir(), 'code3d-example-package-'));
  try {
    await cp(source, directory, {
      recursive: true,
      filter: path =>
        !path.includes('/node_modules') && !path.includes('/.code3d'),
    });
    const manifest = JSON.parse(
      await readFile(join(directory, 'package.json'), 'utf8'),
    );
    const lock = JSON.parse(
      await readFile(join(directory, 'code3d-lock.json'), 'utf8'),
    );
    assert.deepEqual(lock.dependencies, manifest.dependencies);
    assert.equal(
      lock.workspace,
      undefined,
      'Checked-in example locks must use public npm artifacts',
    );
    // Node and browser consume the same locked bytes. Before publication only
    // the selected release archives replace registry downloads, without hoisting.
    for (const name of Object.keys(manifest.dependencies)) {
      const locked = lock.packages[lock.resolutions.primary[name].installUrl];
      const artifact = artifacts.find(artifact => artifact.name === name);
      if (artifact) {
        assert.equal(locked.version, artifact.version, name);
        assert.equal(locked.integrity, artifact.integrity, name);
      }
      manifest.dependencies[name] = artifact
        ? 'file:' + artifact.filename
        : locked.version;
    }
    await writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
    await run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      directory,
    );
    await run(
      process.execPath,
      [
        join(app, '../../node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--skipLibCheck',
        '--allowImportingTsExtensions',
        '--module',
        'nodenext',
        '--target',
        'es2022',
        join(directory, 'model.ts'),
      ],
      directory,
    );
    await writeFile(
      join(directory, 'verify.mjs'),
      `
      import assert from 'node:assert/strict';
      import model from './model.ts';
      import {createModelSnapshotter} from '@code3d/core/tooling';
      const result = createModelSnapshotter()(model);
      assert.equal(result.kind, 'group');
      assert.ok(result.children.length >= 2);
      for (const child of result.children) assert.ok(child.mesh.triangles.length > 0);
    `,
    );
    await run(process.execPath, ['verify.mjs'], directory);
    console.log(
      'Verified clean npm example:',
      manifestPath,
      artifacts.length ? '(release archives)' : '(public registry)',
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}
