import {appendFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  verifiedArtifacts,
  publicPackages,
  runNpm,
} from './package-artifacts.mjs';

const dependencyFields = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
];

/** Published edges retain the current dependency as their minimum supported version. */
export function validatePackageDependencies(packages) {
  const publicByName = new Map(
    packages.filter(pkg => !pkg.private).map(pkg => [pkg.name, pkg]),
  );
  for (const pkg of publicByName.values())
    for (const field of dependencyFields)
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        const dependency = publicByName.get(name);
        if (!dependency) continue;
        if (
          ![
            dependency.version,
            '^' + dependency.version,
            '~' + dependency.version,
          ].includes(range)
        )
          throw new Error(
            `${pkg.name} ${field}.${name} must use ${dependency.version} as its minimum version (exact, ^ or ~); found ${range}.`,
          );
      }
}

export function releasePackages(packages, tag) {
  const version = /^v(\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?)$/.exec(tag)?.[1];
  if (!version)
    throw new Error(
      'Release tag must be v<package version>, for example v0.0.1-alpha.2.',
    );
  const publicList = packages.filter(pkg => !pkg.private);
  const selected = publicList.filter(pkg => pkg.version === version);
  if (!selected.length)
    throw new Error(
      `No public package has version ${version}. Update package.json before tagging.`,
    );
  validatePackageDependencies(publicList);
  const selectedNames = new Set(selected.map(pkg => pkg.name));
  for (const pkg of publicList)
    for (const field of dependencyFields)
      for (const name of Object.keys(pkg[field] ?? {}))
        if (selectedNames.has(name) && !selectedNames.has(pkg.name))
          throw new Error(
            `${pkg.name} must join release ${version}: ${field} references released package ${name}.`,
          );
  const ordered = new Map();
  const visiting = new Set();
  function visit(pkg) {
    if (ordered.has(pkg.name)) return;
    if (visiting.has(pkg.name))
      throw new Error(`Release dependency cycle involving ${pkg.name}`);
    visiting.add(pkg.name);
    const dependencies = {
      ...pkg.dependencies,
      ...pkg.peerDependencies,
      ...pkg.optionalDependencies,
    };
    for (const dependency of selected)
      if (Object.hasOwn(dependencies, dependency.name)) visit(dependency);
    visiting.delete(pkg.name);
    ordered.set(pkg.name, pkg);
  }
  selected.forEach(visit);
  return [...ordered.values()];
}

/** An explicit release tag selects archives, never workspace aliases or old npm versions. */
export async function releaseArtifacts() {
  return process.env.CODE3D_RELEASE_TAG
    ? verifiedArtifacts(
        releasePackages(await publicPackages(), process.env.CODE3D_RELEASE_TAG),
      )
    : [];
}

async function main() {
  const tag = process.env.CODE3D_RELEASE_TAG;
  const args = process.argv.slice(2);
  const publish = args.includes('--publish');
  if (
    args.length > 1 ||
    args.some(arg => !['--plan', '--publish', '--dry-run'].includes(arg))
  )
    throw new Error('Use --plan, --dry-run or --publish.');
  const packages = releasePackages(await publicPackages(), tag);
  if (args.includes('--plan')) {
    for (const pkg of packages) console.log(`${pkg.name}@${pkg.version}`);
    return;
  }
  const artifacts = await verifiedArtifacts(packages);
  const prepared = [];
  // Validate the whole batch before performing any registry mutation.
  for (const artifact of artifacts) {
    const pkg = packages.find(pkg => pkg.name === artifact.name);
    const {filename} = artifact;
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`,
      {signal: AbortSignal.timeout(30_000)},
    );
    if (!response.ok && response.status !== 404)
      throw new Error(
        `Registry lookup failed for ${pkg.name}: HTTP ${response.status}`,
      );
    if (response.ok) {
      const published = await response.json();
      if (published.dist?.integrity !== artifact.integrity)
        throw new Error(
          `Published artifact differs from the verified archive: ${pkg.name}@${pkg.version}`,
        );
    } else {
      await response.body?.cancel();
    }
    prepared.push({pkg, filename, published: response.ok});
    if (response.status === 404) {
      const packageResponse = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`,
        {signal: AbortSignal.timeout(30_000)},
      );
      await packageResponse.body?.cancel();
      if (packageResponse.status === 404)
        throw new Error(
          `${pkg.name} does not exist on npm. Create the initial package and configure its trusted publisher before trusted publishing.`,
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
    else if (!publish) status = 'Would publish';
    else {
      // Publish the exact tested tarball without running workspace lifecycle hooks.
      process.stdout.write(
        runNpm([
          'publish',
          filename,
          '--access=public',
          '--tag=' + (pkg.publishConfig?.tag ?? 'latest'),
          '--ignore-scripts',
          '--registry=https://registry.npmjs.org',
        ]),
      );
      status = 'Published';
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
