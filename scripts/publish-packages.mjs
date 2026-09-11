import {readFile, appendFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  artifactsDirectory,
  integrity,
  publicPackages,
  runNpm,
} from './package-artifacts.mjs';

export function releasePackages(packages, tag) {
  const version = /^v(\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?)$/.exec(tag)?.[1];
  if (!version)
    throw new Error(
      'Release tag must be v<package version>, for example v0.0.1-alpha.2.',
    );
  const selected = packages.filter(pkg => pkg.version === version);
  if (!selected.length)
    throw new Error(
      `No public package has version ${version}. Update package.json before tagging.`,
    );
  const ordered = new Map();
  const visiting = new Set();
  function visit(pkg) {
    if (ordered.has(pkg.name)) return;
    if (visiting.has(pkg.name))
      throw new Error(`Release dependency cycle involving ${pkg.name}`);
    visiting.add(pkg.name);
    const dependencies = {...pkg.dependencies, ...pkg.peerDependencies};
    for (const dependency of selected)
      if (Object.hasOwn(dependencies, dependency.name)) visit(dependency);
    visiting.delete(pkg.name);
    ordered.set(pkg.name, pkg);
  }
  selected.forEach(visit);
  return [...ordered.values()];
}

async function main() {
  const tag = process.env.CODE3D_RELEASE_TAG;
  const args = process.argv.slice(2);
  const stage = args.includes('--stage');
  if (
    args.length > 1 ||
    args.some(arg => !['--plan', '--stage', '--dry-run'].includes(arg))
  )
    throw new Error('Use --plan, --dry-run or --stage.');
  const packages = releasePackages(await publicPackages(), tag);
  if (args.includes('--plan')) {
    for (const pkg of packages) console.log(`${pkg.name}@${pkg.version}`);
    return;
  }
  const artifacts = JSON.parse(
    await readFile(path.join(artifactsDirectory, 'manifest.json'), 'utf8'),
  );
  const prepared = [];
  // Validate the whole batch before performing any registry mutation.
  for (const pkg of packages) {
    const artifact = artifacts.find(
      item => item.name === pkg.name && item.version === pkg.version,
    );
    if (!artifact)
      throw new Error(
        `Missing verified artifact for ${pkg.name}@${pkg.version}`,
      );
    const filename = path.join(artifactsDirectory, artifact.filename);
    if (integrity(await readFile(filename)) !== artifact.integrity)
      throw new Error(`Verified artifact was modified: ${pkg.name}`);
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`,
      {signal: AbortSignal.timeout(30_000)},
    );
    if (!response.ok && response.status !== 404)
      throw new Error(
        `Registry lookup failed for ${pkg.name}: HTTP ${response.status}`,
      );
    prepared.push({pkg, filename, published: response.ok});
    await response.body?.cancel();
    if (response.status === 404) {
      const packageResponse = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`,
        {signal: AbortSignal.timeout(30_000)},
      );
      await packageResponse.body?.cancel();
      if (packageResponse.status === 404)
        throw new Error(
          `${pkg.name} does not exist on npm. Create the initial package and configure its trusted publisher before staged publishing.`,
        );
      if (!packageResponse.ok)
        throw new Error(
          `Registry lookup failed for ${pkg.name}: HTTP ${packageResponse.status}`,
        );
    }
  }
  for (const {pkg, filename, published} of prepared) {
    const label = `${pkg.name}@${pkg.version}`;
    let status;
    if (published) status = 'Already published; skipped';
    else if (!stage) status = 'Would stage';
    else {
      // Stage does not support workspaces. Publish the exact tested tarball.
      process.stdout.write(
        runNpm([
          'stage',
          'publish',
          filename,
          '--access=public',
          '--tag=' + (pkg.publishConfig?.tag ?? 'latest'),
          '--ignore-scripts',
          '--registry=https://registry.npmjs.org',
        ]),
      );
      status = 'Staged; awaiting approval on npm';
    }
    console.log(`${label}: ${status}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `- \`${label}\`: ${status}\n`,
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
