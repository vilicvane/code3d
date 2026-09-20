import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ArtifactRegistry} from '../../../scripts/artifact-registry.mjs';
import {prepareExampleArtifacts} from './example-artifacts.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const examples = join(app, 'examples');
const {artifacts, projects} = await prepareExampleArtifacts();
const registry = await new ArtifactRegistry(artifacts).listen();
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
try {
  for (const {directory: project, manifest, lock} of projects) {
    const source = join(examples, project);
    const directory = await mkdtemp(join(tmpdir(), 'code3d-example-package-'));
    try {
      await cp(source, directory, {
        recursive: true,
        filter: path =>
          !path.includes('/node_modules') && !path.includes('/.code3d'),
      });
      // Node and browser consume the same resolved versions and archive integrity.
      for (const name of Object.keys(manifest.dependencies)) {
        const locked = lock.packages[lock.resolutions.primary[name].installUrl];
        manifest.dependencies[name] = locked.version;
      }
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify(manifest),
      );
      await run(
        'npm',
        [
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--@code3d:registry=' + registry.url,
        ],
        directory,
      );
      const installed = JSON.parse(
        await readFile(join(directory, 'package-lock.json'), 'utf8'),
      );
      for (const [path, pkg] of Object.entries(installed.packages)) {
        const name = /node_modules\/(@code3d\/[^/]+)$/.exec(path)?.[1];
        if (!name) continue;
        const artifact = artifacts.find(item => item.name === name);
        assert.ok(artifact, name);
        assert.equal(pkg.version, artifact.version, name);
        assert.equal(pkg.integrity, artifact.integrity, name);
        assert.ok(pkg.resolved.startsWith(registry.url + '/'), name);
      }
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
      assert.equal(result.kind, ${JSON.stringify(project === 'npm' ? 'solid' : 'group')});
      const solids = result.kind === 'group' ? result.children : [result];
      assert.ok(solids.length >= ${project === 'npm' ? 1 : 2});
      for (const child of solids) assert.ok(child.mesh.triangles.length > 0);
    `,
      );
      await run(process.execPath, ['verify.mjs'], directory);
      console.log(
        'Verified clean npm example:',
        project,
        '(current packed artifacts)',
      );
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  }
} finally {
  await registry.close();
}
