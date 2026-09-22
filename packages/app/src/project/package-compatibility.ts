import {builtinPackageNames} from './builtin-packages';
import {decodeProjectFile, type ProjectFileReader} from './file-reader';
import {
  dependencyFields,
  findPackageScope,
  manifestDependencies,
  parsePackageManifest,
  parsePackageSpecifier,
  type PackageManifest,
} from './package-manifest';
import {normalizeProjectPath, projectDirectory} from './project';

export type PackageCompatibilityIssue = Readonly<{
  /** The first affected project scope; individual packages retain their owner. */
  directory: string;
  packages: readonly Readonly<{
    name: string;
    /** Selected installation, including aliases and nested dependency copies. */
    packagePath: string;
    /** The author's dependency name, which may be an npm alias. */
    specifier?: string;
    installed: string;
    expected: string;
    manifestPath: string;
    manual?:
      | Readonly<{reason: 'transitive'; dependency: string}>
      | Readonly<{reason: 'undeclared'}>;
  }>[];
  matchingVersions: Readonly<Record<string, string>>;
}>;

function modelingPackage(name: string, range: string): string | undefined {
  const actual = range.startsWith('npm:')
    ? parsePackageSpecifier(range.slice(4)).name
    : name;
  return builtinPackageNames.some(name => name === actual) ? actual : undefined;
}

async function readManifest(files: ProjectFileReader, path: string) {
  const bytes = await files.readFile(path);
  return bytes === undefined
    ? undefined
    : parsePackageManifest(decodeProjectFile(bytes), path);
}

export function resolvedPackageDirectory(path: string): string | undefined {
  return /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/.exec(path)?.[1];
}

async function matchingPackageVersions(files: ProjectFileReader) {
  return Object.fromEntries(
    (
      await Promise.all(
        builtinPackageNames.map(async name => {
          const manifest = await readManifest(
            files,
            '/node_modules/' + name + '/package.json',
          );
          return typeof manifest?.version === 'string'
            ? [[name, manifest.version] as const]
            : [];
        }),
      )
    ).flat(),
  );
}

async function installedManifest(
  files: ProjectFileReader,
  name: string,
  rootPath: string,
): Promise<{manifest: PackageManifest; packagePath: string} | undefined> {
  for (
    let directory = projectDirectory(rootPath);
    ;
    directory = projectDirectory(directory)
  ) {
    const path = normalizeProjectPath(
      directory + '/node_modules/' + name + '/package.json',
    );
    const manifest = await readManifest(files, path);
    if (manifest)
      return {
        manifest,
        packagePath: projectDirectory(
          (await files.stat(path))?.realPath ?? path,
        ),
      };
    if (directory === '/') return undefined;
  }
}

/** Check the selected package filesystem, before old Core exports are resolved. */
export async function findPackageCompatibility(
  files: ProjectFileReader,
  builtinFiles: ProjectFileReader,
  rootPath: string,
): Promise<PackageCompatibilityIssue | undefined> {
  const matchingVersions = await matchingPackageVersions(builtinFiles);
  const declared = new Set<string>();
  const packages: PackageCompatibilityIssue['packages'][number][] = [];
  for (
    let directory = projectDirectory(rootPath);
    ;
    directory = projectDirectory(directory)
  ) {
    const manifestPath = normalizeProjectPath(directory + '/package.json');
    const manifest = await readManifest(files, manifestPath);
    const dependencies = manifestDependencies(manifest ?? {});
    for (const [specifier, range] of Object.entries(dependencies)) {
      if (declared.has(specifier)) continue;
      declared.add(specifier);
      const name = modelingPackage(specifier, range);
      if (!name || !matchingVersions[name]) continue;
      const installed = await installedManifest(files, specifier, rootPath);
      // A missing installation retains the normal actionable resolution error.
      if (!installed) continue;
      const version =
        typeof installed.manifest.version === 'string'
          ? installed.manifest.version
          : 'unknown';
      const expected = matchingVersions[name];
      if (version !== expected)
        packages.push({
          name,
          packagePath: installed.packagePath,
          specifier,
          installed: version,
          expected,
          manifestPath,
        });
    }
    if (directory === '/') break;
  }
  return packages.length
    ? {
        directory: projectDirectory(packages[0].manifestPath),
        packages,
        matchingVersions,
      }
    : undefined;
}

/** Check only a package reached by real module resolution, including transitive aliases. */
export async function findResolvedPackageCompatibility(
  files: ProjectFileReader,
  builtinFiles: ProjectFileReader,
  path: string,
  importer: string,
): Promise<PackageCompatibilityIssue | undefined> {
  const resolved = resolvedPackageDirectory(path);
  if (!resolved) return undefined;
  const manifestPath = resolved + '/package.json';
  const directory = projectDirectory(
    (await files.stat(manifestPath))?.realPath ?? manifestPath,
  );
  const manifest = await readManifest(files, directory + '/package.json');
  if (
    !manifest?.name ||
    !builtinPackageNames.some(builtin => builtin === manifest.name)
  )
    return undefined;
  const name = manifest.name;
  const matchingVersions = await matchingPackageVersions(builtinFiles);
  const expected = matchingVersions[name];
  if (!expected || manifest.version === expected) return undefined;
  const installed =
    typeof manifest.version === 'string' ? manifest.version : 'unknown';
  const owner = resolvedPackageDirectory(importer);
  // A dependency can share the installation owned by an author declaration.
  // Match its physical path so a nested copy is never mistaken for that package.
  const authorPath = owner
    ? normalizeProjectPath(
        importer.slice(0, importer.indexOf('/node_modules/')) + '/__lookup.ts',
      )
    : importer;
  const declared = await findPackageCompatibility(
    files,
    builtinFiles,
    authorPath,
  );
  if (declared?.packages.some(pkg => pkg.packagePath === directory))
    return declared;
  const ownerManifest = owner
    ? await readManifest(files, owner + '/package.json')
    : undefined;
  const scope = await findPackageScope(files, authorPath);
  const manual: NonNullable<
    PackageCompatibilityIssue['packages'][number]['manual']
  > = owner
    ? {
        reason: 'transitive',
        dependency:
          ownerManifest?.name ??
          owner.slice(
            owner.lastIndexOf('/node_modules/') + '/node_modules/'.length,
          ),
      }
    : {reason: 'undeclared'};
  return {
    directory: scope.directory,
    packages: [
      {
        name,
        packagePath: directory,
        installed,
        expected,
        manifestPath: normalizeProjectPath(scope.directory + '/package.json'),
        manual,
      },
    ],
    matchingVersions,
  };
}

/** Keep latest declarations; update other Code3D versions without moving fields or aliases. */
export function upgradeCode3dDependencies(
  manifest: PackageManifest,
  matchingVersions: Readonly<Record<string, string>>,
): PackageManifest {
  const updated = {...manifest};
  for (const field of dependencyFields) {
    const dependencies = manifest[field];
    if (!dependencies) continue;
    updated[field] = Object.fromEntries(
      Object.entries(dependencies).map(([specifier, range]) => {
        const name = modelingPackage(specifier, range);
        const expected = name && matchingVersions[name];
        const requested = range.startsWith('npm:')
          ? parsePackageSpecifier(range.slice(4)).range
          : range;
        if (!expected || requested.trim() === 'latest')
          return [specifier, range];
        return [
          specifier,
          range.startsWith('npm:') ? `npm:${name}@${expected}` : expected,
        ];
      }),
    );
  }
  return updated;
}
