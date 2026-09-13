import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const artifactsDirectory = path.join(root, 'dist/packages');

export async function publicPackages() {
  const workspace = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  );
  const packages = [];
  for (const directory of workspace.workspaces) {
    const manifest = JSON.parse(
      await readFile(path.join(root, directory, 'package.json'), 'utf8'),
    );
    if (!manifest.private) packages.push({directory, ...manifest});
  }
  return packages;
}

export function run(command, args, cwd = root) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {...process.env, npm_config_update_notifier: 'false'},
  });
}

export function runNpm(args, cwd = root) {
  const cli =
    process.env.npm_execpath ??
    (process.platform === 'win32'
      ? path.join(
          path.dirname(process.execPath),
          'node_modules/npm/bin/npm-cli.js',
        )
      : undefined);
  return cli
    ? run(process.execPath, [cli, ...args], cwd)
    : run('npm', args, cwd);
}

export const integrity = bytes =>
  'sha512-' + createHash('sha512').update(bytes).digest('base64');

/** Read the verified archive bytes; consumers and publication share one identity. */
export async function verifiedArtifacts(
  packages,
  directory = artifactsDirectory,
) {
  const artifacts = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), 'utf8'),
  );
  return Promise.all(
    packages.map(async pkg => {
      const artifact = artifacts.find(
        item => item.name === pkg.name && item.version === pkg.version,
      );
      if (!artifact)
        throw new Error(
          `Missing verified artifact for ${pkg.name}@${pkg.version}`,
        );
      const filename = path.join(directory, artifact.filename);
      if (integrity(await readFile(filename)) !== artifact.integrity)
        throw new Error(`Verified artifact was modified: ${pkg.name}`);
      const manifest = JSON.parse(
        run('tar', ['-xOf', filename, 'package/package.json']),
      );
      if (manifest.name !== pkg.name || manifest.version !== pkg.version)
        throw new Error(`Verified artifact identity mismatch: ${pkg.name}`);
      for (const field of [
        'dependencies',
        'peerDependencies',
        'optionalDependencies',
        'peerDependenciesMeta',
      ]) {
        if (!isDeepStrictEqual(manifest[field], pkg[field]))
          throw new Error(
            `Verified artifact ${field} differs from release plan: ${pkg.name}`,
          );
      }
      const tarball = `https://registry.npmjs.org/${pkg.name}/-/${pkg.name.split('/').at(-1)}-${pkg.version}.tgz`;
      return {...artifact, filename, manifest, tarball};
    }),
  );
}

/** Pack the already-built output once; verification and publishing share these bytes. */
export async function packPackages() {
  await mkdir(artifactsDirectory, {recursive: true});
  await rm(path.join(artifactsDirectory, 'manifest.json'), {force: true});
  const artifacts = [];
  for (const pkg of await publicPackages()) {
    const [packed] = JSON.parse(
      runNpm(
        [
          'pack',
          '--json',
          '--ignore-scripts',
          '--pack-destination',
          artifactsDirectory,
        ],
        path.join(root, pkg.directory),
      ),
    );
    const bytes = await readFile(
      path.join(artifactsDirectory, packed.filename),
    );
    if (integrity(bytes) !== packed.integrity)
      throw new Error(`Tarball integrity mismatch: ${pkg.name}`);
    artifacts.push({...packed, directory: pkg.directory});
    console.log(
      `${packed.id}: ${packed.files.filter(file => /\.m?js$/.test(file.path)).length} JS files, ${packed.entryCount} files, ${packed.size} packed bytes`,
    );
  }
  await writeFile(
    path.join(artifactsDirectory, 'manifest.json'),
    JSON.stringify(artifacts, null, 2) + '\n',
  );
  return artifacts;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await packPackages();
